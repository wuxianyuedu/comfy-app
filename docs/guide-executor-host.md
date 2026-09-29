# ComfyUI 执行器独立宿主（COMFY_EXECUTOR）使用指南

> 一句话：把「驱动 ComfyUI 跑生成任务」的那条执行链从 Next 进程里搬出来，放进一个
> 由启动编排器（`scripts/dev-launcher.mjs`）管理的独立 Node 进程（executor-host）。
> 设计依据与分阶段状态见
> [P3 §5 ADR](superpowers/specs/2026-09-26-p3-phase2-executor-host-design.md)（§13 实施增补）。

## 它解决什么

内联（inline）模式下执行器活在 Next 进程里，与 web server **同生共死**：

- dev 热重启 / 手动重启 → 在跑的生成任务中断（内存队列没了、comfy-cli 变孤儿、
  DB 行卡 RUNNING），界面显示「生成中」但实际无人推进；
- 执行链的长任务与请求处理抢同一个事件循环。

host 模式下任务状态全部经 SQLite 交换（进度 / 日志 / 终态由执行方写库，界面走
≤3s 短轮询读库），于是：

1. **重启 Next 不打断生成**——任务在 host 进程里继续跑；
2. **崩溃可恢复**——host 挂了，下次启动按 Q2 语义扫表对账收孤儿（不永久卡「生成中」）；
3. 为后续把 film 等长流程编排也搬出 Next（Phase 5）打好地基。

## 怎么开（dev）

1. 设开关（二选一，两种给法都生效）：
   - shell：`$env:COMFY_EXECUTOR = "host"`（POSIX 用 `export`）；
   - `.env`：追加一行 `COMFY_EXECUTOR=host`。

   > 三处读同一个 key、同一套归一化（大小写与首尾空白宽容；**进程 env 优先于
   > `.env`**，显式写 `COMFY_EXECUTOR=` 就是关掉）：Next 侧
   > `src/lib/comfyui/executor-mode.ts`，launcher 与 host 脚本共用
   > `scripts/launcher-core/executor-mode.mjs`。同层两份、跨层一份，两份之间由
   > `tests/executor-mode-consistency.test.ts` 逐值比对（ADR §14 D5）——
   > 在此之前 host 那份漏了 trim 与 `.env` 回读，写 `" host "` 或只改 `.env`
   > 手工起 host 都会静默跑成骨架。

2. **必须走 launcher 入口**：`node scripts/dev-launcher.mjs`，或双击
   `tools/start/start-web.ps1` / `start-tauri.ps1`。

> ⚠️ **`pnpm dev` 不会拉起 host。** 它是裸 Next 链路（只解析端口 + 起 dev
> server），没有编排步骤——这种起法下任务行会被标成 host 归属，但没有任何进程
> 来领。ISSUE #1204 之后这类行**不再被回收器判失败**，而是留在队列里等一个会领它
> 的宿主：现象从「30s 后报『请重新执行』」变成「一直不动、排队数一直涨」，行上只有
> 一句「⏳ 等待…」。**别把它当成卡死去重启应用**，判据是 launcher 控制台有没有
> 「executor-host 已启动」、`log/services/executor-host.log` 有没有 `mode=runtime`。
> 这是灰度期最容易踩的坑。

3. 确认起来了（两处证据）：
   - launcher 控制台：`executor-host 已启动（PID …，COMFY_EXECUTOR=host 灰度中…）`；
   - `log/services/executor-host.log` 尾部：`mode=runtime` →
     `runtime inject-ok seams=…` → `runtime q2-scan hostShardQueued=…`。
4. 正常用工坊 / 工作流库点「运行」即可；界面观感与 inline 一致（进度 / 日志 /
   产物经 DB 短轮询送达，粒度 ≤3s）。

**回退**：把 `COMFY_EXECUTOR` 删掉或改回 `inline`，重启 launcher——行为与灰度前
逐字相同。

## 桌面包（app.exe / 预构建壳）：宿主件已随包，standalone 入口也会起它

3-E1（ISSUE #1169 的第一半）已经解决「产物里跑不起来」：`pnpm build` 收尾会把宿主的
运行时图**预编译**成 `scripts/executor-host.runtime.mjs`（连一份构建清单
`executor-host.build.json`，记 inputs/externals 供门禁复算）落进产物，然后
**真起一次宿主进程**做冒烟（`scripts/smoke-executor-host-standalone.mjs`，它是
`pnpm build` 的收尾一步；桌包构建的 1/4 步就是 `pnpm build`，所以组装 static 之前
一定已经冒过烟）。宿主入口按**内容**决定加载
哪份图：预编译件在 → 用它；不在（dev 检出）→ 装 tsx 的 ESM 钩子加载 `src/lib/**` 的
TS 源。于是「产物里没有 tsx、没有 TS 源」不再是障碍，也**不再依赖**「Turbopack 全项目
追踪恰好把 `src/**` 带进产物」那条噪声（规范 §7.2）——两条通道互不依赖，缺预编译件
会以 `boot FAILED` 大声失败而不是静默退化。

**桌包里设 `COMFY_EXECUTOR=host` 从 3-E2b 起真的会执行任务**（ISSUE #1216 收口）。
中间那一层是 3-E2a 接通的 standalone 运行入口：`tauri.conf.json` 声明
`bundle.resources: ["static/"]`，壳经 Node sidecar 起的不是 `server.js` 而是
`scripts/standalone-runtime.mjs`（装配运行期 env、首启建表、带起 server，再按开关带起
宿主；八层断点与实测见规范 §7.6）。宿主与 server 因此是**同父兄弟**——都是壳的孙子，
不是 Next 进程 fork 出来的（那正是 Phase 4-B3 才卸掉的耦合：宿主与 server 同生死）。

桌包侧与 dev 的三点差别：

1. **开关的常规来源是壳进程继承的环境变量**。分发产物里**没有** `.env`（硬规则 17 剥掉
   了），所以桌包的正常路径就是：系统环境变量，或
   `$env:COMFY_EXECUTOR="host"; & "<安装目录>\ComfyAPP.exe"`。判据不另写一份：入口调的
   还是 `resolveExecutorMode()`（ADR §14 D5 的唯一定义），`" host "` 这类值同样被归一化成
   host。它保留的那一层「进程 env 里没有再看 `.env`」在桌包里也仍然生效——只是那份文件
   得用户自己往安装目录放；**别把它当常规入口**，载荷里根本没有它，写进文档会让人以为
   桌包与 dev 的给法完全同形。
2. **看的是入口日志，不是 launcher 控制台**（桌包没有 launcher）。壳日志里三行按顺序：
   `executor mode=host` → `host pid=… out=… err=…` → 之后 `log/services/` 里宿主的
   `boot pid=` / `mode=runtime` / `runtime inject-ok`。
3. **宿主退出不会带走应用**：入口打一行 `host exited code=…`，server 继续跑，任务留在
   队列（#1204 之后的既定语义）。**既不降级回 inline、也不自动重启**——降级会让已经写成
   host 归属的行变成没人领的孤儿，重启会把「起不来的宿主」掩盖成「慢」。
4. **真出图需要一个 comfy-cli 的 Python 解释器**（桌包不随包 Python，实测）：载荷里既没有
   Python 也没有 comfy-cli（那是百 MB 级的环境，不该随包）。落法与 ComfyUI 本体同一条形态
   ——**用户自备 + 设置页指路径**：「设置 → 创作后端 → comfy-cli 解释器」填一个装好
   comfy-cli 的 Python 绝对路径即可（ISSUE #1239 的签字口径）。留空则退回
   `<cwd>/python-venv/comfy-cli/…`（开发检出的默认落点），而 `COMFY_CLI_PYTHON` 是**这一项的
   默认值**（与 `COMFYUI_PATH → comfyuiPath` 同形），老用法照旧生效。
   找不到解释器时任务被**大声判失败**，行上是中文错误 + 「建议」两条出口，建议那句会指向
   设置页那一项（不会给桌包用户看 `pip install`）。填完**保存即可点「重试」，不用重启宿主**：
   设置是内嵌 server 写盘、宿主取值，两个进程各一份缓存，所以宿主的缓存按**文件指纹**
   （`mtimeMs` + `size`）失效，磁盘上一变就重读（#1239 端到端里现出来的：旧实现把宿主
   第一次读到的空值钉死，照提示填完仍是同一个 FAILED）。
   **两条出口都过过真出图**：3-E2b 当时给壳进程设 `COMFY_CLI_PYTHON` 拿到桌包库里的
   `SUCCEEDED` + 1.27 MB 的 `img_0.png`；#1239 这轮换成设置页那条（在桌包里点「创作后端 →
   comfy-cli 解释器」填路径 → 保存 → 同一行改回 QUEUED 重试），宿主**没重启**就跑出了
   同一个 1,265,859 字节的 PNG，仍由桌包 server 经 `/api/generated/...` 发出来。

**没起宿主时的三种定性**（都从壳日志读，不用猜）：

| 现象                                  | 判据                                        | 含义                                                                                      |
| ------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 连 `executor mode=` 都没有            | 壳起的还是 `server.js`（旧载荷 / 没重编壳） | 重跑 `node scripts/build-desktop.mjs` 并 `pnpm tauri build`                               |
| `executor mode=inline`                | 开关没传到壳进程                            | 用系统环境变量或上面那条命令式起法（载荷里没有 `.env`，那一层回读要用户自己放文件才成立） |
| `host SKIPPED: no …executor-host.mjs` | 设了 host 而载荷缺宿主件                    | 装配被跳过或被剪枝误删（§7.4 / §7.6 的必备件判据）                                        |

分发口径：桌包与 dev 一样仍是**灰度**——不写这个开关 = inline，行为与灰度前逐字相同。

## 日志与状态去哪看

| 通道           | 位置                                                          | 内容                                                                        |
| -------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| host 编排日志  | `log/services/executor-host.log`                              | boot / 心跳 / `claim-dispatched` / `cancel-reaped` / boot FAILED            |
| host pino 通道 | `log/services/executor-host-{stdout,stderr}-<启动时间戳>.log` | 执行链内部日志（含 reaper / 进度回写）                                      |
| 执行 trace     | `log/comfyui/comfyui-trace-host.log`                          | cli 事件 / WS 事件 / history 对账（与 inline 的 trace 分文件，不互串）      |
| 任务真相       | `db.sqlite` 的 `task` 行                                      | `claimedBy`（归属）、`status/progress/progressNode`、`logs`、`resultImages` |

## 行为语义速查

- **归属分片**：`task.claimedBy='host'` 的行只被 host 领取与回收；inline（含历史
  NULL 行）只被 Next 侧处理——两进程并存不会互抢、不会互误杀（判据单一定义在
  `repository-task-impl.ts` 的 `ownedBy()`）。
- **取消**（Phase 4-A3 起的语义，ADR §14 D2）：界面点取消走执行侧那份统一出口
  `enqueue.cancelTask` —— 落一行「用户取消任务」进执行日志、把行标成 `CANCELLED`、
  清理本进程记账与并发槽。**中断（`POST /api/interrupt`）只由握着该任务在飞子进程的
  那一侧发**：inline 在 `cancelTask` 里发，host 在自己的 tick kill 之后发
  （`reconcileCancelled`，日志 `cancel-reaped … interrupt=sent`）。跨进程之所以这样分：
  `/api/interrupt` 是**全局停**、不带 prompt 参数，而 ComfyUI 实例两宿主共享，
  谁都能发就等于谁都能误停对方的在飞任务。
  为什么判据不是「问 ComfyUI 谁在跑」：实测 comfy-cli 提交的 prompt 在整轮执行期间
  **不出现在** `/queue` 的 `queue_running`，用它当依据会退化成「永远不中断」
  （详见 ISSUE #1184）。
- **进度 / 日志**：执行方（host 或 inline）写库，界面统一走 SSE→DB 短轮询
  （≤3s + 200ms 落库防抖）。曾经「host 任务实时日志静默」的空窗已由 Phase 3-C
  收口，两模式同一契约。
- **一条派发路径**（Phase 4-B3 起，ADR §14 D1 的第二刀）：提交方只往库里写一行
  `QUEUED`（带 `claimedBy`），**谁执行由领取决定**——Next 与 host 各自跑同一个
  `executor-dispatch.ts`，按自己的归属片 `claimNextQueued` 领行再交 comfy-cli。
  三点可见后果：
  1. `RUNNING` 只剩一个意思（真的在跑）。此前 host 那条领取循环把行翻成 `RUNNING`
     之后，它还可能在进程内存队列里等槽，那段窗口里状态栏的「排队数」数出来是 0
     （inline 侧等待的行仍是 `QUEUED`，计数没错）；现在那条队列没了。
  2. **就绪前不领行**：ComfyUI 没起来 / WS 没连上时行留在 `QUEUED`，等就绪的下一拍
     才被领走（提交后那一次即时 kick 通常就够，撞上空窗最多等 2s）。等待期间任务
     日志里会有一行「⏳ 等待 ComfyUI WebSocket 连接就绪…」，并且这一行在该任务开
     跑之后仍然留在日志里（4-B5 / ISSUE #1206：领取重开缓冲时，会把本轮排队期写下的行
     接回去）。
  3. 冷启动遗留在 `QUEUED` 的行**两宿主都会领**（inline 那条以前看不见库，只能等
     回收器判失败）。回收器**不再按 30s 判死本片的排队行**（ISSUE #1204）：宿主在跑
     就最迟下一拍（1.5~2s）领走；宿主没起来就一直等，起来那刻接着跑，不白判失败。
     循环的启动点与 reaper 同形态：**两处显式调用**——Next 侧
     `src/instrumentation.ts` 的 nodejs 分支、host 侧 `scripts/executor-host.mjs`
     注入链之后（host 自己的 tick 驱动同一个 `claimAndDispatchOnce`，不再起第二条循环）。
     判据在 `tests/dispatch-startup-points.test.ts`，行为判据在
     `src/lib/comfyui/executor-dispatch.test.ts`。
- **对外只有一条通道 = 数据库那一行**（Phase 4-B1 起）：执行链原先另有一套进程内
  `EventEmitter`（`done` / `error` / `progress` / `log` 帧），它只能在写它的那个进程里
  响，跨宿主必然漏。SSE 单源化之后它已只剩写入、没有读者，因此整体退役；服务端里
  最后一个读者「文生视频的首帧那一跳」也改成读库等终态（`comfyui/firstframe.ts`，
  ADR §14 D1）——它此前是 host 模式下**必坏**的功能：订阅永远等不到 `done`，挂满
  5 分钟超时后整条失败。回归由 `tests/in-process-event-channel-retired.test.ts` 钉住。
- **底部状态栏那一格与「查看完整输出」**（Phase 4-B2 起同形，ADR §14 D1）：这两处
  此前读的是 Next 进程的内存，host 执行时分别是「排队 0、在跑 null」和空态。现在
  四个字段全部来自库里那行——排队数 = `status='QUEUED'` 的计数（跨归属，这一格答的
  是「本应用堵了几个」）、「已运行」= 新增的 `claimedAt` 列（领取时、或第一次转
  RUNNING 的那条进度帧 / `markRunning` 时定格，后续不刷新）、「当前节点」=
  `progressNode.classType`（与画布用的中文 `label` 一起存；comfy-cli 那条事件源拿不到
  类名时为空，与内存版旧行为一致）、「主模型」= 从 `execPayload` 现认（库里只有它是
  执行侧一定会写的，`workflowSnapshot` 要到成功收口才落）。comfy-cli 完整原文由执行侧
  在收口时整包写一次进 `rawCli` 列，所以 host 的任务也点得开。
- **崩溃恢复**：host 被杀 → 在飞 comfy-cli 随进程组整树回收（launcher 语义）；
  遗留 RUNNING 行由 reaper 对账收口。reaper 的启动点是**两处显式调用**（Phase 4-A2
  起，不再靠模块加载自启）：Next 侧 = `src/instrumentation.ts` 的 nodejs 分支，
  host 侧 = `scripts/executor-host.mjs` 注入链之后的 `startReaper()`；起表即首扫
  就是 Q2 对账，之后两进程各自按 30s 常驻——**RUNNING** 那条按片对账（分片判据见上），
  **QUEUED** 那条只判无主行（见下）。
  **`QUEUED` 遗留行不再被判死（ISSUE #1204 收口）**：boot 顺序没变——首扫仍在
  领取循环第一拍之前发起——变的是**判据本身**：回收器只判「没有任何宿主片会领」的行
  （`claimedBy` 既不是 inline 也不是 host 的畸形值），本片内 aged 的排队行是健康的
  等待态，交给领取循环。改动前的实测形态留档，说明为什么要改：一行 aged 48s 的 host
  遗留行在新宿主 `inject-ok` 后 1.4s 被 `marked 1 stale QUEUED task(s) as FAILED`，
  而同批 boot 诊断数出的正是 `hostShardQueued=1`。改动后同一份脚本（同机、同两行
  载荷、间隔拉到 48s）：新宿主 `boot 08:48:38.612` → `q2-scan hostShardQueued=1` →
  首扫跑过、整份宿主日志里**零条** QUEUED 判死 → `claimedAt 00:48:43.773Z`（距
  `inject-ok` 3.8s）领回 → `SUCCEEDED`，用时 7.7s、`rawCli` 17 行、`taskImage` 1 行。
  代价也要写清：没有活宿主时排队行不再有失败判决，可解释性只剩状态栏的排队数与行上
  那句「⏳ 等待 ComfyUI WebSocket 连接就绪…」。这一句**留得住**（4-B5 / ISSUE #1206）：
  领取仍然重开日志缓冲（重跑不混上一轮的尾巴），但排队期写的行会先单独登记
  （`logWhileQueued`）、在领取那一刻接回去（`takeQueuedEntries`）。**没有**改成「收口时删
  缓冲」——落库是整包 `replaceLogs`，而 `complete()` 在落库之后还要打「✓ 全部完成」那一
  行，先删缓冲会让它把整列覆盖成一行（第一版就是这么坏的，实测 38 行现场只剩 1 行）。
  跨宿主的残留限制照旧：上一个宿主写的行由新宿主整包替换，重启后的现场看不到的那部分
  是设计使然，不是这次改动引入的。
  同批确认 RUNNING 侧没被带坏：
  宿主 A 崩溃留下的 `RUNNING` 行
  由 B 连续两轮对账（`reaper(running): checked 1 stale RUNNING task(s)`）在 117s 收口。
  dev 下 Turbopack 会**懒编译** instrumentation，实测 `✓ Ready` 之后约 40s 才跑完
  首扫——冷启动后短暂看到遗留行还在 `QUEUED`/`RUNNING` 属正常，不是没接上。
  「已被领取、但 `prompt_id` 还没回传」的 `RUNNING` 行同样在回收范围内
  （ISSUE #1184）：这类行连续两轮（≈30~60s）都无人认领才判失败——单轮判定会误杀
  刚领取、还没 spawn comfy-cli 的正常任务。前提是**同一 shard 只跑一个宿主**
  （由 launcher 保证），这也是「本进程没有足迹 ⇒ 真孤儿」成立的依据。

## 已知观察项（灰度期）

1. **ComfyUI 懒拉起**：Phase 4-B3 起，「谁去连 / 谁去拉起 ComfyUI」收在领取循环里
   （就绪门控不过时 `void connect()`，拉起动作在 `lifecycle` 里单飞），提交方不再
   直接驱动它。剩下的观察点变成：host 与 Next 两侧各自都会为自己的那片去探测端口
   ——同机同实例下 `ensureComfyUiReady` 有单飞闩锁，灰度继续观察。
2. **`[comfy-cli 原始]` 行内 prompt 字段乱码**：python stdout 管道编码问题，
   先于 host 线存在，独立 ISSUE #1164 治理（修向 `PYTHONIOENCODING=utf-8`）。
3. host 模式下的产物下载 / 封面链路复用 Next 的 `/api/generated` 静态映射，
   桌面包立项（ISSUE #1169）时需一并核对壳内静态目录的可写性。
