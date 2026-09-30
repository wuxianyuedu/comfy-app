# 生产级缺口清单(Production Gaps)

> 2026-08-30 全库审查(结构/类型/测试/安全/规范)沉淀的未竟事项。
> 每项含优先级与建议路径。完成一项划掉一项。
>
> **巡检约定**：本清单每季度按 [docs/README.md §7](../../README.md) 的季度巡检流程逐条复核，
> 已完成项勾掉、过时项改写成现状或删除、仍开放项保留并指向承接它的 Issue。
> 上次巡检：2026-09-27（本轮新增七维审计台账，见下方「2026-09-27 全库商业级差距审计」；原 2026-08-30 台账条目均已闭环或流程化保留）。

## P0 — 安全/正确性

- ~~`task.cancel` 越权(任意用户可取消他人任务)~~ **已修复**(08669df,含回归测试)。
- ~~`scripts/parse_custom_nodes.py` 与 `src/generated/` 不在仓库~~ **已解决**:
  - 解析器本身在仓库:`scripts/parse_custom_nodes.py`(`git ls-files` 可见);
  - `src/generated/` 是**构建产物**(`.gitignore:82` 明确忽略),由构建期生成,
    不需要入库——原条目把「产物不入库」误判成缺口。custom-nodes 路由的
    spawn 路径与优雅降级保留现状。
- ~~LLM `provider` 字段:garbage 值静默回退 local 并覆盖 DB 的 remote 配置~~
  **已解决**(ISSUE #309 P0 批次):`src/server/api/routers/llm.ts:34,75` 收紧为
  `z.enum(["local", "remote"])`,垃圾值在校验层被拒;历史遗留的默认值由
  `schema.ts` 的 `provider` 列默认 `"local"` 承接,不再有静默改写。

## P1 — 测试覆盖爬坡(商业级下限)

- [x] ReactFlow Provider 包装方案落地(tests/helpers/react-flow.tsx)+
      CanvasNode/FlowNode 渲染冒烟与折叠交互(7 用例)。表单/生成链路的深度
      行为测试(fetch/poll 生命周期)仍开放。
- [x] `CustomNodesSettings` 主组件拆分后行为测试:组件已按四层范式拆为容器 73 +
      视图 379 + hook 503 + 纯函数模块,并补齐逻辑层行为测试
      (`hooks/use-custom-nodes-settings.test.ts`,17 用例:失败路径必须有可见出口、
      打开才请求、解析收尾时序、派生分组计数)。
- [x] Playwright 框架 + 冒烟 E2E(`e2e/smoke.spec.ts`:login 渲染/Tab 切换、
      `/` 重定向 workspace)与核心链路 E2E(`e2e/critical-flows.spec.ts`,
      进 `@critical` 门禁)。命令:`pnpm test:e2e`(原记录写作 npm 形式,
      违反 AGENTS 硬规则 1「包管理只用 pnpm」,已于 2026-09-10 巡检修正)。
- [x] 覆盖率棘轮抬升:`src/lib/comfyui/**` 两批模块相继入榜,判断规则与
      调度判决被逐条断言: - `lifecycle.ts` 的判决表抽到纯函数模块 `lifecycle-derive.ts`(90% 硬门槛),
      `lifecycle.ts` 本体按实测值设门槛(45/60/45 + 分支 30); - 两条 sweeper(`reaper.ts` 70/60)与调度器(`executor-scheduler.ts` 70/50)
      的判决矩阵测试落地后按实测值设门槛。
      新增 `comfyui/**` 模块的测试后,按同样方式把各自门槛加进 §11.7 棘轮表。

## P2 — 架构路线图(见 reviews/2026-08-30-canvasnode-review.md)

- [x] `canvas-types.ts` 收窄 `CanvasNodeData` 索引签名(ISSUE #320):拆成
      `StrictCanvasNodeData`(业务代码用,拼错字段名编译报错) +
      `CanvasNodeData = Strict & Record<string, unknown>`(仅 ReactFlow 类型参数
      位置)+ `asCanvasNodeData()` 单点收口;画布链路 `as unknown as` / `as never`
      清零;两处 Prisma Json 边界改为 Zod 校验。
- [x] `errorSuggestion` 正则规则表外置为数据(**已过时项,已改判为完成**)。
      规则表**已外置**到数据模块
      `src/components/studio/project-canvas/CanvasNode/error-suggestions.ts`
      (`ERROR_SUGGESTION_RULES` 数组 + `pattern` / `suggestion` 数据项),
      `ErrorPanel.tsx` 只消费 `suggestForError()`。原条目按「未做」记录,
      复核后改判为已完成。
- [ ] 注册表触发式采纳(仍开放):下次新增节点 kind 时按
      reviews/2026-08-30-canvasnode-review.md 第二节执行顺序走。
      **性质**:流程性约定(触发条件是「下次新增节点 kind」),无完成态,
      长期保留作为执行提醒;不需要新开 Issue 承接。

## P3 — 卫生/规范执行

- [x] 文件级 `no-explicit-any` 头 59 → 0(895f99c 等)。
- [x] 未使用/单规则可修的 eslint-disable 头清理(5355a2b)。
- [x] lint warning 清零:全库 `eslint . --max-warnings 0` 退出码 0(零错误
      零警告)。**本地 pre-commit 此前只判「无 error」而 CI 判零警告,口径不一致
      ——warning 能在本地进历史、到 CI 才被拦下(复核返工)。**已把 pre-commit
      对齐为零警告口径(ISSUE #322);剩余行内 disable 全部带可核验理由
      (exhaustive-deps 按三分类法逐条判定,prefer-nullish 属「伪建议」类:
      空串在服务端反序列化产物里表示「没有值」,`??` 会改语义)。
- [x] `CustomNodesSettings` 主组件进一步拆分(见 P1 对应条目,容器 73 行)。
- [x] `DynamicWorkflowForm` 已拆为四层(容器 44 + 视图 249 + hook 261 + 纯函数
      105),并补齐逻辑层行为测试(30 用例:行归属、多模式可见性、拖拽重排、
      图片上传、默认值刷新口径,见 ISSUE #319)。`CustomNodesSettings` 同批拆分
      与测试见 ISSUE #318。
- [x] `components/model/model-library.tsx` 与 `studio/ModelLibrary.tsx`
      语义撞车的处置(原条目「确认两者职责或合并」)。
      **结论:确认职责,不合并**——两者服务不同路由、各自独立握手: - `components/model/ModelLibrary.tsx` 服务 `/models` 独立页
      (`app/(main)/models/page.tsx` 唯一消费方),面向「模型卡片库」浏览; - `components/studio/ModelLibrary.tsx` 服务 `/workspace` 工作室内页签
      (`app/workspace/page.tsx` 经 `studio/index.ts` 动态导入),面向
      「本机 ComfyUI 可用模型按扫描目录分类」。
      两者已各自按规范 §17 四层范式拆分,逻辑分别落在各自的
      `hooks/use-model-library.ts`,消费方互不交叉,无需合并。
      治理记录见 `docs/standards/17-UI与逻辑分离.md` §17.6.2。

## 2026-09-27 全库商业级差距审计（新增台账）

> 七维审计（安全 / 供应链 / 发布运维 / 可观测 / 测试工程 / 产品化 / 桌面壳）沉淀的未竟事项。
> 与上方 2026-08-30 台账相互独立、并列勾销；原 P0 三项已闭环，本轮 P0 为新增阻塞项。
> 每条含优先级、证据路径与建议路径；完成一项划掉一项。上轮巡检：2026-09-27；
> A 系列逐条复算：2026-09-30（见 P1 段首）。

### P0 — 缺了就不算「已发布产品」（阻塞发布）

- [ ] **P0-1 CI 流水线**：缺口不是「没写配置」，而是**免费额度用不起**（#623 实测：`cpus: 8` 下一次 PR 近 1 核时，160 核时/月几十次 PR 就见底）。`76275841` 曾补回一份缩水版 `.cnb.yml` 充当「第二执行者」，但它**匹配不到任何事件**（顶层缺分支键与事件键，CNB 的形态是 `分支: { 事件: [流水线] }`）——构建历史里 `push` / `pull_request` 一条都没有，比删除前更彻底地静默失效，已按 ISSUE #1229 删除。出路不是把配置贴回去，而是 13.5.4 的**按需召唤**：在 PR / Issue 里 `@` 评审 NPC 跑一轮全量单测 / 产物护栏 / E2E，不 `@` 就不花核时。「补回一份看起来在守门的配置」这件事此前只有文档口径、没有判据（加回文件不会让任何现有门禁变红），现由 `tests/no-platform-ci-config.test.ts` 守住三头一致：仓库根没有自动触发型 CI 配置 + 规范确实这么写着 + `doc-facts` 不把它登记成 path 类事实；该用例登记在提交前的固定守护清单里，每次提交都跑。证据：`changelog.d/1229-remove-dead-cnb-yml.md`；规范 13.5.3 / 13.5.4；`tests/no-platform-ci-config.test.ts`。
- [ ] **P0-2 自动更新未接通**：`tauri.conf.json` `updater.endpoints:[]` / `pubkey:""` / 未开 `createUpdaterArtifacts`；能力已开校验全无（填端点即变未验签更新）。需：生成 keypair、配端点、开产物。证据：`src-tauri/tauri.conf.json:34-41,43-67`；`src-tauri/capabilities/remote.json:19`。
- [ ] **P0-3 客户端崩溃零上报**：缺 `src/sentry.client.config.ts`，`instrumentation.ts` 仅 nodejs/edge 分支；ErrorBoundary 仅 `console.error`。证据：`src/instrumentation.ts:8-24`；`src/components/ui/error-boundary.tsx:31-35`。
- [ ] **P0-4 无 release / source map 关联**：`next.config.js` 无 `withSentryConfig` / sourceMap 上传，堆栈无法符号化。证据：`next.config.js`（grep sentry/Sentry/sourceMap = 0）。
- [ ] **P0-5 无版本化 DB 迁移**：`drizzle/` 不存在，主推 `db:push`（无 TTY 可「报错 + exit 0 + 留 0 字节库」）。需：`drizzle-kit generate` 落地 + 禁用无 TTY push。证据：`package.json:13`；`src/server/db.ts:41-52`。
- [ ] **P0-6 无代码签名 / 公证**：缺 `certificateThumbprint` / `macOS.signingIdentity` / `publisher` / `licenseFile`。证据：`src-tauri/tauri.conf.json:43-67`；`src-tauri/Cargo.toml:6`。

### P1 — 安全正确性与运维可见性

> **A 系列逐条复算（2026-09-30）**：本批给闸门类端点补用例时，把 A1–A10 每一条都
> 对着当前代码重读了一遍。结论是**这个表在 2026-09-27 就写错了**：`8740948 fix(security): batch1 hardening`
> 一次改了 8 个源文件（A2 / A3 / A6 / A7 / A10 的修复全在里面），而**同一次提交**把这 5 条
> 登记成「待办」—— 修了的东西留在待办栏里，表现是「证据行号还在、内容早就不是那样」
> （A2 当时写的 `task.ts:179-194` 如今指的是别的过程）。
>
> 这不是文档瑕疵，它比没修更危险：待办栏里有一条「IDOR 未修」，后来人就会按它去设计
> 防线、或在评审时据此认为这块没有判据。所以本轮的口径是 **勾销必须与判据同批** ——
> 一条安全项被关闭时，必须能指出「哪条用例在钉它」（下面每条 `[x]` 都写了判据文件名）。
> 复算没找到能机器判的形式（「这条已经修了但没勾」是语义判断，写个启发式扫描器
> 只会误报一片、本身就成了会静默失效的清单 —— 见 §12.18 末段），因此只落这一条口径。

- [ ] **A1 鉴权默认关闭**：无会话回落演示用户，`loginRequired` 默认 false，约 20 个 router 可写。证据：`src/lib/auth-server.ts:99-106`；`src/lib/app-settings/index.ts:96`。需评估默认强鉴权或显式化。
      ⚠️ 它同时是 A2/A3/A6/A7/A8 那一批「越权」的实际可达性前提：单用户本机部署下这些
      洞打不到别人，但**多用户开了登录就是真洞**，所以判据一律按「越不过去」写，不按
      「当前部署形不形得成」写。
- [x] **A2 IDOR：`task.workflow` 无归属校验（已修 + 本批补判据）**：`8740948 fix(security): batch1 hardening`
      已把快照读取挡在归属判定之后（他人 id 与不存在的 id 走同一句 `NOT_FOUND`，不给探测用），
      但**台账没勾、也没有任何用例判它** —— 判据现在在 `src/server/api/routers/task.test.ts`
      「他人任务 → NOT_FOUND」，且 `task.ts` 首次进覆盖率门槛。
      证据：`src/server/api/routers/task.ts`（`workflow` 段）、`src/server/api/routers/task.test.ts`。
- [x] **A3 IDOR：`project.outputs` 无归属校验（已修）+ 同族 `project.upsert` 越权写（本批新照出并修复）**：
      `8740948` 给 `get` / `patch` / `outputs` 三个读出口加了 owner 判定，同样没勾、没判据。
      本批写 `project.router` 的第一批用例时照出**同一族里漏掉的那一个**：`upsert` 的 id 由
      客户端生成（画布 localStorage 的 `proj_*`，每次自动保存原样送上来），而
      `projectRepository.upsertForUser` 的 update 分支**只按 id 定位行** —— 任何人把一个别人的
      项目 id 写进请求，就能把对方的 `name/nodes/edges` 整幅覆盖掉。现在 `upsert` 与 `get`/`patch`
      同口径先判归属，他人 id → `FORBIDDEN` 且**一行都不改**，并在服务端留一行 warn
      （这一路的客户端是「尽力而为的镜像」，失败被前端吞掉，warn 是唯一痕迹）。
      判据：`src/server/api/routers/project.test.ts`（17 条，含越权写 / 越权读 / 跨用户删三态）。
      证据：`src/server/api/routers/project.ts`、`src/lib/core/repository-project.ts`（update 分支
      仍只按 id —— 归属判定在 router 层，与 `get`/`patch` 同一处口径）。
- [ ] **A4 LLM `apiKey` 明文回传客户端**（含远端条目）。证据：`src/lib/llm/server.ts:171`（`apiKey: r.apiKey` 仍在下发）；`src/server/api/routers/llm.ts:60-64`。
- [x] **A5 SSRF 协议白名单（已修复）**：`llm.configSave` 的 `baseUrl` 与 `setting.comfyEmbeddable` 的 `base`/`hostOrigin` 输入层加 `^https?://` 校验（与 `trainerUrl` 同口径），挡 `file://` 等非 http 协议；`comfy-embed.ts` 的 `probeComfyEmbeddable` 已有 `isHttpOrigin` 运行时防护，本次补齐输入层纵深。证据：`src/server/api/routers/llm.ts`、`src/server/api/routers/setting.ts`。
- [x] **A6 `/api/custom-nodes` 参数注入 → 任意文件覆写（已修 + 本批补 35 条判据）**：
      `8740948` 加了 `safeSpawnArg()`（拒 flag 形态 / 空 / 超长 / shell 元字符），此前无执行者。
      判据现在分两层：坏形状必须在 **spawn 之前**就被拒（`expect(spawn).not.toHaveBeenCalled()`
      —— 只在响应码上打勾等于没拦住），合法包名则钉住 argv 的形状（`--only-pkgs` 永远是
      **一个**值、`--out` / `--report-out` 的位置与内容不许被客户端挪动）。
      顺带修掉同一条路径上的浪费：`parents` 为空批时 `runDiscover([])` 照样按
      python3 → python → py 轮三遍（各带一次超时与一次进程启动），现在空批直接回空结果。
      证据：`src/app/api/custom-nodes/route.ts`、`src/app/api/custom-nodes/route.test.ts`；
      GET 侧（manifest / report 读取）仍无执行者，门槛按实测登记在 E7。
- [x] **A7 `workflow.create.sourcePath` 读本机任意文件 + 路径回显（已修 + 判据已在）**：
      `8740948` 加了 `isWithinAllowedLocalWorkflowRoot()` —— 只允许配置目录
      （`LOCAL_WORKFLOWS_PATH` / ComfyUI `workflows`）下的文件，闸在 `importFromLocalPath`
      **之前**（用例断言它没被调用）。判据：`src/server/api/routers/workflow.test.ts`
      「根目录之外的路径在导入闸上被拦下，且不碰磁盘导入」。
      证据：`src/server/api/routers/workflow.ts`（`create` 段）、`src/lib/comfyui/localWorkflows.ts`。
- [x] **A8 `task.delete` 缺路径包含校验（已修，并查出两处真缺陷）**：
      这条与 `openFolder` 白名单「不自洽」的根因是**同一个布局被三处各拼一遍**，而三处已经分叉：1. `task.delete` 只拼 `public/generated/<taskId>`，可 `executor-finalize` 对**项目任务**落的是
      `projects/<projectId>/<taskId>` —— 在画布里删任务永远删不到产物目录，磁盘单调增长；2. 同函数里逐张 `unlink` 时把 `TaskImage.localPath`（`/api/generated/...`）解析成
      `public/api/generated/...`（多了一段 `api`）→ 每次 ENOENT，一张图都没删掉过；3. 两条失败都被 `.catch(() => undefined)` 吞掉 —— 既没有日志、也没有任何数字会动。
      落盘侧还反向缺判据：`projectId` 由客户端生成，一个 `../../x` 形状过去能把产物写到
      产物根之外（而 `/api/generated` 的白名单只认根内，写出去等于文件永远读不到）。
      修法是让布局只有一处定义：`src/lib/media/output-paths.ts`（`taskOutputDir` 同时算目录
      与判越界，`taskOutputUrl` 与它同源），落盘 / 打开 / 删除三个调用点全部改吃它；
      逐张 unlink 那条删掉（每张产物都在目录内，整体删除才是这一层该做的，
      逐张删反而可能碰目录外的文件）。越界处置留在调用点：打开 → `FORBIDDEN`、
      删除 → 只删库行并 warn、落盘 → 硬失败由 `complete()` 收口成任务失败。
      判据：`src/lib/media/output-paths.test.ts`（16 条，含「解析结果就是根本身」→ null）+
      `task.test.ts` 的三条 delete 用例（项目目录按 `projects/<pid>/<tid>` 删 / 越界不动磁盘 /
      rm 失败不阻塞删库但原因可见）。证据：`src/lib/media/output-paths.ts`、
      `src/server/api/routers/task.ts`、`src/lib/comfyui/executor-finalize.ts`。
- [ ] **A9 无 `middleware.ts`、better-auth 未配 `trustedOrigins`；限流仅 1 个 mutation**。证据：`src/server/better-auth/config.ts:8-39`；`src/server/api/routers/task.ts`（`rateLimitedProcedure` 只用在 delete 上）。
- [x] **A10 脚手架残留 `post.getSecretMessage` 不在路由表（已移除，本批复算勾销）**：
      `8740948` 一并删掉了它，`src/server/api/routers/post.ts` 现只剩 `getLatest` / `create`
      两条且都在 `authedProcedure` 后。（台账当时把「修了什么」写进了代码注释，
      却没改这张表 —— 见上方 P1 段首的复算说明。）
- [ ] **B1 capability 对回环通配源开满**（`http://127.0.0.1:*` + `process:default` / `updater:default`）。证据：`src-tauri/capabilities/remote.json:8-26`；`src-tauri/tauri.conf.json:31`。
- [ ] **B2 生产路径 21 处 `unwrap()` + 构建失败 panic**，无降级 UI。证据：`src-tauri/src/lib.rs:72,918,1391,1741`；`shell_launch.rs:78,83,201`。
- [ ] **B3 违反自身规范：`std::process::Command` 直起外部进程 3 处**（应走 `tauri-plugin-shell`）。证据：`src-tauri/src/shell_launch.rs:575`；`lib.rs:1167`；`detached_spawn.rs:147`。
- [ ] **B4 安装型部署回收退化**（回收依赖项目根脚本，副本中不成立；`kill_sidecar` 被 `#[cfg(not(debug_assertions))]` 排除）。证据：`src-tauri/src/lib.rs:1153-1182,2205-2206`。
- [ ] **B5 sidecar 崩溃无重拉 / 退避**（watchdog 只盯 splash）。证据：`src-tauri/src/shell_launch.rs:661-668`；`lib.rs:2101`。
- [ ] **B6 `externalBin` 仅 Windows-msvc 一份 node（89MB 入库）**，跨平台出包不可行。证据：`src-tauri/tauri.conf.json:54-56`。
- [ ] **B7 无 panic hook / 错误全 `String` 化**，前端无法按错误码分支。证据：`src-tauri/Cargo.toml:28-47`（无 thiserror/anyhow）。
- [ ] **B8 退出无二次确认 / 无 `prevent_close`**。证据：`src-tauri/src/lib.rs:1384-1410`。
- [ ] **C1 零依赖漏洞扫描 / license 合规 / SBOM / 自动升级**。证据：全仓 renovate/dependabot/audit/sbom = 0。
- [ ] **C2 `minimumReleaseAge: 0`** 关闭投毒版本时间窗。证据：`pnpm-workspace.yaml:6`。
- [ ] **C3 `.env.production` / `.env.development` 未被忽略**（仅 `.env` + `.env*.local`）。证据：`.gitignore:37-38` vs `next.config.js:50`。（已修：`.gitignore` 改为 `.env.*` + `!.env.example`）
- [ ] **C4 `Cargo.lock` 被忽略** → Rust 二进制依赖树不可复现。证据：`.gitignore:113-114`。
- [ ] **C5 `pnpm-workspace.yaml` 无 `packages:` 字段** + `allowBuilds` 手工清单疑漏 `sharp`。证据：`pnpm-workspace.yaml`（grep packages = 0）；`pnpm-lock.yaml:12198`。
- [ ] **C6 生产 CSP 仍 `'unsafe-inline'`**，无 nonce/hash / `object-src 'none'` / `upgrade-insecure-requests` / `report-uri`。证据：`next.config.js:109-112`。
- [ ] **C7 未关 `poweredByHeader`**；`typescript.ignoreBuildErrors:true`。证据：`next.config.js`（0 命中）/ `:17-19`。
- [ ] **C8 `shadcn` CLI 错放 `dependencies`**。证据：`package.json:83`。
- [ ] **D1 日志无轮转无上限**（固定名 `app-runtime.log` 纯 append）。证据：`src/lib/log/app-runtime-log.ts:85`；`log-sessions.ts:5`。
- [ ] **D2 日志级别不可运行时调整**。证据：`src/lib/core/logger.ts:115,161`。
- [ ] **D3 日志不出用户机器**（无上报 / 导出通道）。证据：`src/lib/core/logger.ts:145-154`。
- [ ] **D4 Sentry 无 release / tags / 用户上下文 / 离线缓存；Edge 缺 beforeSend 脱敏**。证据：`src/sentry.server.config.ts:8-21`；`src/sentry.edge.config.ts:14-18`。
- [ ] **D5 `/api/health` 仅 `{status,db,t}` 且 `*` CORS + 回显运维命令**。证据：`src/app/api/health/route.ts:27,39,46`。
- [ ] **D6 无自动备份 / 恢复工具**（仅手册）。证据：`docs/guide-database-backup.md:37-42`。
- [ ] **D7 版本号三处手工重复（均 0.1.0）** 无同步守卫。证据：`package.json:3` / `tauri.conf.json:4` / `Cargo.toml:3`。

### P2 — 成熟度与体验

- [ ] **E1 提交时只跑一小撮用例**：原记「pre-commit 仅跑 7 测试文件（1.6%）」的形态已
      变过一次——现在是**固定 9 份结构守护 + 沿静态 import 图解析出的受影响用例**
      （`scripts/affected-tests.mjs`，规范 §13.5.8），改到哪测到哪这条已落地。仍未解决
      的两点：① 靠运行时 `readdir` 自扫扫描面的判据不会被「改了某份 check 脚本」拉进
      这一层（实测撞到过一次：那条红在 master 静置到全量复跑才看见）；② `check:all` 只有
      4 项、不含棘轮/E2E/覆盖率。证据：`.githooks/pre-commit:63-70`；`scripts/quality-gate.mjs:39-65`。
- [x] **E2 覆盖率门槛是死配置**：根因比「test 门无 `--coverage`」还深一层 —— 即使加上，
      v8 在任何用例红时默认**清数据、不产出报告**，门槛照样一条都不判（实测全量 464 文件 /
      2 败 → `coverage/` 是空的，终端只看得见那两条红）。两处一起修：两侧门禁
      （`scripts/quality-gate.mjs` 的 `GATES.test` 与 `scripts/quality-gate.ps1` 的 `$Blocks`）
      的 test 门带 `--coverage`；`vitest.config.ts` 补 `coverage.reportOnFailure`。
      两条约束记在规范 §11.7：覆盖率只在**全量**这一档判（单文件跑 `--coverage` 会把其余
      路径按 0% 汇总、`thresholds` 每条都刷红），别挪进钩子的增量层。§11.13 补了
      「带 coverage」这个预算维度（`LogPanel.test.tsx` 45s → 120s，单跑实测 25.0s / 34.4s）。
      开门那一次抓到的 21 条真回退已按实测重基线，**欠的课转 E7**。
      证据：`scripts/quality-gate.mjs`、`scripts/quality-gate.ps1`、`vitest.config.ts`。
- [ ] **E7 覆盖率棘轮开门即抓到的真回退（补用例清单）**：E2 把门打开的那一次全量跑
      （465 文件全绿）当场报出 21 条不达标，已按 §18.6 逐条降到「实测向下取整到 5 的倍数」，
      旧值与原因留在 `vitest.config.ts` 的 `coverage.thresholds` 注释块里。这不是并行档抖动：
      同一批文件**单跑**带 `--coverage` 得到一模一样的数字。欠的课按大头排 ——
      `src/lib/process/process-launch.ts` 行 17.9%、`src/lib/process/kill-process-tree.ts`
      行 29.1%（执行宿主那批新代码 + 平台相关分支）、`src/lib/log/log-file-client.ts` 行 23.5%、
      `src/lib/core/repository-task.ts` 行 70.6%、`src/lib/browser-storage.ts` 行 81.8%。
      补上对应用例后**同批**把门槛抬回旧值（只升不降）。
      同批新增的已知欠账（本批按实测登记，不是回退）：`src/app/api/custom-nodes/route.ts`
      —— POST 的 argv 闸门 35 条已逐分支钉住，**GET 侧**（manifest / report 读取 +
      按 (size, mtime) 指纹的摘要缓存）仍无执行者，门槛登记在 35/35/45/40。
- [ ] **E3 服务端集成覆盖 5/16 router**（generate / run / task / workflow / project，
      project 是本批补的：17 条归属判据）；其余 11 个 router 仍无执行者，其中
      `custom-nodes` / `llm` / `setting` / `material` / `film` 都在写本机状态。
      E2E 仅 3 spec / 31 用例且无登录态。证据：`src/server/api/routers/**`；`e2e/*.spec.ts`；`playwright.config.ts`。
- [ ] **E4 msw 仅 7 文件使用**；缺 zod↔API 契约测试。
- [ ] **E5 棘轮 `--update` 无制衡**。证据：`AGENTS.md:94,97`。
- [ ] **E6 无 bundle 体积门禁 / 变异测试 / a11y 自动化**。
- [ ] **F1 零 i18n**（中文硬编码、`lang` 写死）。证据：`src/app/layout.tsx:36`。
- [ ] **F2 缺 `global-error.tsx`**；`error.tsx` 仅 1/6；`loading.tsx` 仅全屏；`<Suspense>` 0 处。
- [ ] **F3 `next/image` 0 处且 lint 关闭**。证据：`eslint.config.js:185-192`。
- [ ] **F4 无离线能力**（无 SW / `onLine` / 离线队列；58 文件手写 localStorage 无 persist）。
- [ ] **F5 虚拟滚动仅 2 处**；`next/dynamic` 仅 2 处。
- [ ] **F6 无 Storybook / 可视回归**；UI 复用棘轮 78 条存量违规。证据：`scripts/.ui-primitives-baseline.json:18`。
- [ ] **F7 metadata 脚手架默认值**（无 OG/SEO/manifest）。证据：`src/app/layout.tsx:19-23`。
- [ ] **F8 无 Onboarding**；快捷键仅一处命令面板。
- [ ] **F9 更新无通道 / 回滚**；`installMode:passive` 失败无回退。
- [ ] **F10 `eslint-plugin-jsx-a11y` 未显式启用**。证据：`eslint.config.js:63-69`。
- [ ] **F11 端口 TOCTOU + 800 槽哈希分桶碰撞无兜底**。证据：`src-tauri/src/lib.rs:831-834`；`single_instance.rs:189-192`。
- [ ] **F12 无 Web Vitals**；SQLite 无 `busy_timeout`；几乎无事务边界。证据：`src/server/db.ts:74-75`。
- [ ] **P3 卫生**：无 `.editorconfig`；`package.json` 无 `engines`；tsconfig 缺 `exactOptionalPropertyTypes` 等；`cn@^0.3.0` / `lucide-react:^1.47.0` 版本偏宽；双 TS 版本导致构建/门禁语义不一致；`/api/update-check` 无鉴权回显变更指纹；`comfyapp://` 由外部 helper 实现需单独审计防任意网页利用本机路径。

## 规范状态

已固化:12(结构/命名/卫生/防线)、13.5(本地提交门禁)、03 §3.1(v4 规范
类名)、TESTING.md(分层策略/覆盖率棘轮)、reviews/(两轮审查归档)。
待补:无——新缺口按上表滚动进入对应章节。
