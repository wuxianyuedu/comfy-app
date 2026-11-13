# 2026-11-13 前后端启动是否该分开：评估（#3575）

> 产出方式：业主在 #3575 下全托管处置本题（"评估一下，前后端启动是否应该分开。现在都是一起启动的。"）。
> 本文只做评估与建议，**不改任何运行行为**；落地任何拆分需要单独立项签字。
> 证据基线：`master` @ `b7e499d7f`（#3703 之后）；`pnpm dev` 实跑日志（本机，
> 2026-11-13）＋ 启动链源码（`scripts/dev.mjs` / `scripts/start.mjs` /
> `scripts/dev-launcher.mjs` / `src-tauri/src/shell_launch.rs` / `scripts/launcher-core/executor-host-spawn.mjs`）
> ＋产品定位（`docs/product/overview.md` §1.4，本机单用户桌面应用）
> ＋ `docs/superpowers/specs/2026-09-26-p3-phase2-executor-host-design.md`。

## 一句话结论

**不该分开，也不需要分。** 现在「一次启动把应用服务起来、用时才拉起生成引擎」是
对的取舍。真正该分、值得分的那一格（ComfyUI 执行编排迁出 Next 进程）**已经分了** ——
它是 `COMFY_EXECUTOR=host`，现在的 dev 与桌包两条链路都拉得起，只是默认 inline
（灰度，见下文「该分的那一格」）。把「前端/后端」整体拆成两个服务进程没有任何
用户可见收益，反而会复制一套壳、打包与运维成本。

## 现状：`pnpm dev` / 双击壳时到底起了几个进程

| # | 进程 | 谁起的 | 形态 | 职责 | 失败了怎么样 |
| --- | --- | --- | --- | --- | --- |
| 1 | 编排器（`dev-launcher.mjs` / `pnpm dev` → `dev.mjs` → `start.mjs`） | 壳（双击）/ 人 / Playwright | 前台 | 预检、端口解析、日志、进程树回收 | 弹窗 + 落 `run/launch-status.json` |
| 2 | `env` 预检 | 编排器，同步内联 | 前置格 | 环境不就绪就不给你起 Next | 人类可见出口（硬规则 4） |
| 3 | `db-restore` 兜底 | 编排器 / `dev.mjs`，一次性同步 | 前置格（必须先于 Next：运行期有多进程持库） | 待恢复的备份换库 | 停启动并说清楚为什么 |
| 4 | `db-sync.mjs`（drizzle） | 编排器或 `dev.mjs`，**后台子进程** | 15~30s、指纹跳过、与页面内容准备并发 | 拉了含 schema 变更的代码不必记得 `pnpm db:push` | 页面照常加载，状态栏说「正在同步」；不阻塞交互 |
| 5 | `executor-host.mjs` | `maybeSpawnExecutorHost()`，**仅当 `COMFY_EXECUTOR=host`** | 后台受管子进程 | ComfyUI 任务编排（Phase 2~5 迁出 Next 的那半个「后端」） | 行上会自描述；inline 那一侧刻意不跨片误杀（#1204） |
| 6 | `next dev`（Turbopack） | 同进程进程树里的唯一常驻服务 | 前台服务 | **UI + API routes + tRPC**，客户端用 `process.env.COMFYAPP_PORT` 连它自己 | 壳回收整棵树；app-service-exit 子线解释「断开约 20 秒自恢复」 |
| 7 | ComfyUI（Python） | **用时才拉起**（`/api/comfy/ensure`，上传前 fire-and-forget 预热 + 客户端轮询） | 按需子进程 | 出图 / 出视频的实际生成引擎 | ensure 自带重试与人类可读原因 |
| 8 | `pnpm mcp:http` | 手工入口 | 独立 | Workshop / AI 客户端 MCP | 不启就不影响人用界面 |

桌包（standalone）：`app.exe`（Tauri）→ 编排器 → **装配进 exe 的 Next standalone**
（一个进程承载 UI+API，壳用 `pick_free_port()` 自持端口）→ 同上第 4/5/7 行。

**注意第 6 行：前后端**在本产品里**共享同一个 Next 进程**。这不是偷懒，而是 Next 的
默认形态——「后端」= `src/app/api/**` + `src/trpc/**`，它与页面直接共享
`src/lib` 的域逻辑、`env`、better-auth 会话、数据库连接。

## 产品层面：为什么「分开」在这里不是一个通用最优解

产品定位是**本机单用户桌面工作台**（`docs/product/overview.md` §1.4）：

- "不是云端服务 —— 默认本机单用户，数据落本机 SQLite 与本机产物目录"；
- 两个操作者（人走界面 / AI 走 run 与 MCP）共用同一份真值，不存在
  「多租户 API 网关 / 水平扩容」的诉求。

拆分服务的经典理由（独立扩缩容、灰度发布、多实例高可用、跨团队独立部署）
在这个产品里全部没有落点。唯一剩下的合理内核是「**故障隔离**」与「**别让重活拖死
请求路径**」，而这两条已经各有答案（见下节）。

## 「分开的理由」逐条过

| 理由 | 成立吗 | 现实 |
| --- | --- | --- |
| 启动更快 | 否 | 瓶颈是 Next 首编译（本机 2026-11-13 实测 `/settings` 首次 **18.8s**，其中 application-code 仅 603ms；`Ready in 8.8s` 是温缓存读数，冷启动更久），不在「一起起」。把 API 拆进第二个进程只会**多一个**要等的健康检查点（壳要等两台都 ready 才交换 splash），净效果是更慢或更脆弱。况且 schema 同步早就后台化了、带指纹跳过、且不阻塞页面。 |
| 故障隔离 | 部分成立，已实现 | schema 同步失败 → 页面带「正在同步」降级加载（`/api/schema` + 状态栏）；ComfyUI 失败 → ensure 重试 + 人类可读原因；**宿主的存在本身就是为这个理由**（见下「该分的那一格」）；Next 服务自己的 20 秒级假死有事件循环阻塞观测（`event-loop-watch.server.ts`，ISSUE #3369 的现场正是「断开约 20 秒自恢复」）。拆成两个进程并不会让假死消失——半数故障源（同步重活、GC、系统调度）在两边都存在。 |
| 独立部署 / 更新 | 否 | 桌面包是单一 exe，内嵌 standalone；Web 端本来就不是一个对外发行的东西。 |
| 独立扩容 | 否 | 单用户。数据库还只有一个（WAL，单写者），拆了也还是同一把锁。 |
| 前端 HMR 被后端阻塞 | 否 | Next dev 的 HMR 不依赖「后端是不是另一个进程」；实测多次页面/样式秒级热更，日志里 `application-code` 一律 < 1s。 |
| 权限面 / 安全 | 否 | 本机 127.0.0.1；壳与 dev server 同端口族，鉴权（better-auth）长在同一条请求链里——拆了反而要在两条链上各写一遍中间件（漏一半就是新事故）。 |
| 测试 / CI 更简单 | 相反 | Playwright 的 `webServer` 现在只有一份 `pnpm dev|start`；拆开要管两个进程的就绪顺序、端口、崩溃重启和清理，`.cnb.yml` 与 GA 两路都要改。 |
| 终端 / 日志更清楚 | 相反 | `log/` 已按分区（`launcher/ → nextjs/ → services/ → tools/`）分轴记，跨进程拓扑一目了然；拆成两份 dev server 会让「谁卡住了」更难归因。 |

## "分开的成本"清单（让账面对称）

如果按「Next(UI) + 独立 Node API 服务」拆：

1. **SQLite 单写者边界不变** —— 两边还是 `db.sqlite` + WAL，拆分对并发毫无改善；
   恢复（pending restore）仍必须在所有服务之前跑（`applyPendingRestoreAtBoot`）。
2. **鉴权中间件双写** —— better-auth 目前一处定义；拆了要么复制要么抽包，
   两份必然漂移（本仓 `executor-mode` 曾因三处各写一份漏了 `trim()` 就是前车之鉴）。
3. **壳的编排多一条 sidecar** —— 进程树回收（Job Object / `taskkill /T` /
   kill-process-tree）、崩溃重启、端口族分配、桌包签名与体积全部 ×2；
   `check-standalone-contents` 的「两层必须含」口径也要 ×2。
4. **零用户可见收益** —— 用户得到的只是「启动页等两台而不是一台」。

## 该分的那一格：`executor-host`（已做，灰度中）

这是 P3 阶段做的、且**真的**把「后端职能」从 Next 进程里搬出来的那一半：

- 目标（`docs/superpowers/specs/2026-09-26-p3-phase2-executor-host-design.md` §1）：
  状态所有权唯一化（queue / WS / per-task 进度只活在宿主）、**崩溃隔离**
  （Next 重启不再打断在跑的生成任务）。
- 现状：`COMFY_EXECUTOR=host|inline`，**默认 inline**；dev 与桌包 standalone
  两条链路都会按 `maybeSpawnExecutorHost()` 拉宿主（`start.mjs` / `dev.mjs` /
  `dev-launcher.mjs` 6.5 步三处共用一份实现，`tests/executor-host-spawn.test.ts` 钉住）。
  宿主是灰度：默认不设 = inline，与现状一致。
- 事件循环证据：Next 服务里有一颗常驻心跳（1s）漂移观测
  （`event-loop-watch.server.ts`，ISSUE #3369）——「应用服务断开约 20 秒自恢复」
  这个事故现场正是「一段同步重活把整个请求面停了」。**这就是 inline 编排的代价
  本体**，也是 host 存在的理由。

**给"要不要拆"拍板的人：这里已经有一个分开的实现，就在你项目里，可以今天开用。**
要不要把默认切成 `host` 是**另一个决策**，前置条件大致是：

1. `COMFY_EXECUTOR=host` 下至少一条真实生成链路全链路验证（排队 → 领取 →
   进度 → 完成/失败/超时 → 取消），含桌包 standalone 两条链路；
2. 领取/回收/`claimedBy` 归属，与 inline 行为逐项对照（host 崩溃后多久扫表恢复、
   `⏳ 等待` 卡死的出口，参照宿主回收器与「行自己说原因」的机制）；
3. MCP（`pnpm mcp:http`）与 host 共存时的客户端行为（MCP 目前单独拉起，不在本次讨论范围）；
4. 回滚口径确认：删掉 env 即回到 inline，无数据迁移、无产物改动；
5. 灰度指标：inline 下事件循环阻塞读数（`[event-loop]` 日志）与 host 下的对比窗口。

**本次不建议直接切默认**（那是生产行为变更，需要它自己的验证与发布通道）；
若要推进，单独立项、用灰度读数拍板。

## 结论与建议动作

1. **不拆** —— 维持 `pnpm dev` / 壳一条编排不动；不做 `dev:api` / `dev:web` 双入口
   （第二个事实源，ISSUE #821 的教训）；不做「UI / API 双服务」。
2. **维持现状的边界**：任何一格想"顺手再分"，先按本文对照检验——拆之前先证明
   有用户可见收益或现存事故，否则不拆。
3. **推进已分的那一格**：`COMFY_EXECUTOR=host` 继续灰度；转默认单独立项（清单如上）。
4. **MCP 常驻服务**如果要做（Workshop 侧诉求），是**第三个进程、另一个题**——
   入口已存在（`pnpm mcp:http`），届时按它自己的产品决策推进，不与本次混。
5. **观测继续加**：`[event-loop]` 读数若长期出现 ≥3s 阻塞，优先走 host，不是走拆分。

## 作罢清单（考虑过，明确否决）

- ❌ 独立 Node API 服务 + Nginx/网关 —— 单用户本机，零收益，双倍打包与鉴权成本。
- ❌ `dev:web` / `dev:api` 双入口 —— 没有独立可起的 backend，两个入口 = 两个事实源。
- ❌ 把 schema 同步挪进请求路径 —— 反向加延迟，且首屏阻塞风险更高（现在是指纹跳过 + 后台）。
- ❌ 把 MCP 直接并进 Next 服务 —— AI 客户端面与人用界面同权限，违背
  「 Workshop MCP HTTP 入口放到局域网 / 任意网页面前」那条 P0（#1783 已修）的处置，
  保持它独立、可单独鉴权与收紧监听地址。

## 附：证据取自哪里

- `scripts/dev.mjs`、`scripts/start.mjs`、`scripts/dev-launcher.mjs`、
  `scripts/launcher-core/executor-host-spawn.mjs`、`scripts/launcher-core/executor-mode.mjs`
  （执行者拆分与归一化口径）；
- `scripts/db-schema-state.mjs`（schema 同步的指纹跳过与"正在同步"降级出口）；
- `src/lib/log/event-loop-watch.server.ts` + `src/instrumentation.ts`（ISSUE #3369）；
- `src/lib/comfyui/lifecycle.ts`（ComfyUI 按需拉起、`autoStartFailed` /
  `manualStop` 语义）；
- 今天（2026-11-13）的 `pnpm dev` 日志：`Next.js 16.4.3 (Turbopack)` →
  `✓ Ready in 8.8s`，`/settings` 首编译 18.8s（application-code 603ms）；
- `docs/superpowers/specs/2026-09-26-p3-phase2-executor-host-design.md`
  （executor-host 的立项目标与落地签字链）；
- `docs/product/overview.md` §1.4（本机单用户、本 SQLite、本机产物目录）。
