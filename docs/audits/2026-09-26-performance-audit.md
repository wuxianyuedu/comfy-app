# 2026-09-26 性能问题排查与整改台账

> 来源：全仓四路并行排查（前端渲染 / 服务端与数据访问 / 资源与内存 / 启动构建与桌面壳），
> 每条 P0 均经逐行复核后落 PR；判定修正与例外见 §B。
> 状态图例：✅ 已整改（有 PR）｜📝 已记录（有意保留 / 误报 / 降级）｜⬜ 待整改。
> 闭环判定与文件生命周期遵循 `docs/README.md` §7：全部闭环后删除本文件。

## A. 已闭环（✅）

| 条目 | 级别 | 位置 | 修复 | PR |
|---|---|---|---|---|
| S1 | P0 | `src/app/api/tasks/[id]/stream/route.ts:84-94` | SSE `done/error` 分支不清 `hbId`/`pollId` → 三个退出路径统一走幂等 `cleanup()` | #966 |
| M1 | P0 | `src/lib/comfyui/runner-state.ts:156/249/351-355` | `logs` Map 无上限 → per-task 环形缓冲 + 终态淘汰 | #968 |
| M2 | P0 | `runner-state.ts:162/251/540-549` | `rawCli` Map 键永不淘汰 → 按任务数 LRU | #968 |
| L1 | P0 | `scripts/prepare-local-run.ps1:156-158` | `Get-FileHash` 漂移判据恒真（每次双击都全量 install）→ 复用 lockfile 实质 diff | #969 |
| F1 | P0 | `src/components/studio/project-canvas/WorkflowNode.tsx:124-127` | 每节点 `findIndex` O(N²) → 按帧记忆 Map | #970 |
| F2a | P0 | `GlobalStepLogPanel.tsx:378` | `useNodes()` 订阅下沉到任务切换器子组件 | #971 |
| F2b | P0 | `GlobalStepLogPanel.tsx:637-668` | 300 行内联 JSX → `memo` 化 `StepLogRow` | #973 |
| S2 | P0 | `src/lib/models.ts:86-109` | 串行 N+1 → 并发拉取 + `upsertScannedMany` 批量 upsert | #974 |
| S3 | P0 | `src/lib/comfyui/localWorkflows.ts` | 同步递归扫盘 → 异步 `fs.promises`（方案更正见 §B） | #977 |
| S4 | P0 | `src/server/film/orchestrator.ts:510-594` | 成片监看 N+1 → 批量 `IN` + 只在变化时回写 | #978 |
| S5 | P0 | `src/app/api/custom-nodes/route.ts:193` | 路由内 `spawnSync` → 异步 `spawn` + `withTimeoutResult` | #979 |
| F3 | P1 | `src/components/studio/WorkflowCanvasDecorations.tsx:48-64` | 选择器拼新对象 → 只订阅标量 zoom | #980 |
| F5 | P1 | `src/components/ui/aurora-background.tsx` | 高斯核 40/50/60→24/28/32 + `contain` 重绘隔离 | #1027 |
| F9 | P1 | `src/components/workshop/LLMContext.tsx:51-61` | Context value 现拼 → `useMemo` | #1029 |
| F10 | P1 | `src/components/workshop/hooks/use-workshop-pipeline.ts:517-538` | 挂载取数无守卫 → `beginStaleRun` | #1029 |
| M8 | P1 | `src/lib/log/log-ansi.ts:182` | 每行 `new RegExp` → 复用模块级 `SGR_RE` | #1033 |
| M6 | P1 | `src/app/api/custom-nodes/route.ts:176-204` | `discoverCache` 无淘汰 → `rememberDiscover`（容量 32） | #1033 |
| M9 | P1 | `src/components/studio/project-canvas/stepLogCache.ts:117-123` | 判重 O(n²) → 尾部窗口 64；单任务日志上限 2000（`tailWindow`） | #1036 |
| M3 | P1 | `src/lib/comfyui/runner-state.ts:232` | `setMaxListeners(0)`（=无限，静音泄漏告警）→ 50 | #1037 |

## B. 判定修正与例外（📝）

| 条目 | 判定 | 依据 |
|---|---|---|
| HistoryList（原 F4 之一） | **误报** | `use-history-list.ts` 已有 `PAGE_SIZE` + `visibleGroups` + `loadMore` 分页增量加载 |
| F8 `WorkflowModePickChip` 订阅 `transform` | **无需改动** | 订阅已下沉到只在弹层打开时挂载的 `PopoverAutoClose`，且该组件 `return null` |
| S3 修法 | **方案更正** | 「缓存扫描结果」被测试打回：清单里的 `mtimeMs` 是调用方判断磁盘变化的判据（`workflow.ts` 建 `diskMtimeByPath`），缓存会让「只改内容、未改目录 mtime」读到过期值；改异步 fs 才同时保住新鲜度与不阻塞 |
| F6 raw-cli 弹窗 `key={index}` | **降级暂缓** | 追加场景下 index + 稳定 entry 引用 + `memo` 已够用；根治需给服务端缓冲（`runner-state.appendRawCli` 存裸 `string[]`）加稳定行号，属数据结构改动，收益/成本不划算 |

## C. 待整改（⬜）

### C.1 前端渲染（P1）

- ⬜ **F4a** `src/components/studio/ProjectOutputs.tsx:250` —— 产出网格 `outputs.map` 全量渲染（每卡带缩略图）。方向：行级虚拟化（`@tanstack/react-virtual`，范式见 `ModelLibrary.tsx:135`）。
- ⬜ **F4b** `src/components/studio/workflow-library/CustomNodesSettings/NodesTab.tsx:141/233/364` —— 节点库三层嵌套全量 `map`（自定义节点包可含数百~上千类型）。方向：展开时才挂载 + 展开组内虚拟化。
- ⬜ **F7** `src/components/workshop/ShotStudio.tsx:123-144` —— effect 依赖含父级数组（每次渲染新引用），每渲染都 O(N) 扫描 + map。方向：依赖改内容指纹 / 长度，或 `didFillRef` 守卫。

### C.2 资源与内存（P1）

- ⬜ **M4** `src/lib/comfyui/enqueue.ts:61-70` + SSE 路由 —— `subscribe` 无连接结束兜底退订；任务终态后无 `removeAllListeners(taskId)`。方向：终态收口强制清订阅（与 S1 的 `cleanup()` 呼应）。
- ⬜ **M5** `runner-state.ts` 的 `wsWaitLogged`(221/270)、`settled`(188/259)、`finalized`(198/260) —— 三个 Set 只 add（delete 仅重入/收口处各 1 处）。方向：任务终态收口统一清理；注意 `settled`/`finalized` 是「一次性权利」语义，误清会导致重复落库。
- ⬜ **M7** `src/lib/log/capture-streams.server.ts:86/138/147-148` —— 劫持 `process.stdout.write` 后每条日志 `appendFileSync`，且无 uninstall 出口。方向：内存缓冲 + 定时批量 flush。
- ⬜ **M10** `src/lib/comfyui/reaper.ts:482`、`executor-scheduler.ts:115/126` —— 模块级 `setInterval` 无 clear、无 `unref()`。方向：加 `unref()`（注意平台/环境判据，这两个是 Node-only 模块）。
- ⬜ **M11** `src/lib/comfyui/executor-ws.ts:247` —— 重连 `setTimeout` 句柄不保存，主动停止时无法取消。方向：保存句柄并在停止路径 `clearTimeout`。

### C.3 服务端 / 数据访问（P1）

- ⬜ **S6** `src/app/api/tasks/[id]/stream/route.ts:122-161` —— 每连接 3s `findById` 全行。方向：降频（5~8s）+ `columns` 投影（status/progress/error/validationErrors/workflowName）。
- ⬜ **S7** `src/lib/core/repository-task.ts:161-171/208-217` —— `findMany/findFirst` 无 `columns` 投影，`task.list` 与详情把 `workflowSnapshot`/`logs`/`params` 大 JSON 全拉回。方向：`columns` 投影 + 消费方逐个核对。
- ⬜ **S8** `src/server/api/routers/task.ts:53-62` —— `overFetch = min(take*4, 400)` 拉回再内存 filter/slice。方向：服务端 `mediaType` 条件 + 游标分页。
- ⬜ **S9** `src/lib/core/repository-project.ts:17-23` —— `listByUser` 无 limit 且取 `nodes`/`edges` 画布 JSON。方向：列表只选 id/name/updatedAt，画布 JSON 走 `project.get`。
- ⬜ **S10** `src/lib/core/repository-film.ts:109-127`、`repository-lora.ts:102-121` —— `appendLog` 读整列→push→整列写回，数组无上限。方向：日志独立表，或环形上限 + 批量/节流写。
- ⬜ **S11** `src/server/api/routers/workflow.ts:792-795` —— 循环内 `await upsertByName`。方向：批量 upsert（同 S2 手法）。

### C.4 启动 / 构建 / 桌面壳（P1）

- ⬜ **L2** `scripts/build-desktop.mjs:152/182/93-115/291-298` —— 全删全拷（`cpSync` 带 `dereference` 实拷 pnpm store 链接）+ `dirSize()` 递归 `statSync` 整棵 static 两遍。方向：`filter` 排除噪声目录；一次遍历同时算总量与 Top 子目录。
- ⬜ **L3** `src-tauri/src/shell_launch.rs:936-960` —— 注释承诺「命令行廉价预筛」但循环内无预筛，每个 PID 都 `OpenProcess`+读 64KB 环境块。方向：实现进程名/命令行预筛。
- ⬜ **L4** `public/splash.html:730` + `src-tauri/src/lib.rs:513/545/671-760` —— 启动页日志面板每 800ms 轮询，命令对 4 个日志文件各整文件读入（且日志不轮转）。方向：seek 到尾部读最后 N 字节 + 降频/退避。
- ⬜ **L5** `src-tauri/src/lib.rs:1418(250ms×480)`、`2110(1s×300)`、`2084(100ms×50)`、`958(500ms×240)`、`475(2s×90)`、`single_instance.rs:442-455(100ms×∞)` —— 6 处固定间隔 sleep 轮询，无退避无统一收口。方向：收敛到统一的「带退避的等待」工具。
- ⬜ **L6** `scripts/dev-launcher.mjs:957` + `scripts/dev.mjs:90` —— 同一次启动两份 `spawnSchemaSync`（各 15~30s drizzle）并发写同一 `db.sqlite`。方向：编排器设 `COMFYAPP_SKIP_SCHEMA_SYNC=1` 二选一。
- ⬜ **L7** `scripts/launcher-core/shell.mjs:62-83/200-252` —— `whichCommand` 遍历 PATH×扩展名，每个候选真 `spawnSync(--version)`（10s 超时），单次启动调 4~6 次无记忆化。方向：进程内缓存 + 收敛为一次。
- ⬜ **L8** `scripts/dev-launcher.mjs:343-345/479-523` + `launcher-core/procs.mjs:63` —— 3 个端口各跑一次 `netstat -ano`（输出相同）；每个待裁定 PID 再 spawn 一次 PowerShell CIM。方向：一次 netstat 复用解析 + 一次批量取命令行。

### C.5 P2（卫生项，随上一批顺手修）

- ⬜ **M12** `src/app/api/logs/current/route.ts`（`readdirSync`/多次 `statSync`）、`api/logs/sessions/route.ts`（同步读+解析 4MiB 尾窗）—— 高频轮询路由的同步 IO。
- ⬜ **S12** `src/server/db/schema.ts:350-361` —— 连接表缺 `workflowModelTag` 侧索引。
- ⬜ **S13** `src/app/(main)/settings/hooks/use-settings-page.ts:183-187` —— `comfyStatus` 5s 轮询（接口要做进程扫描+端口探测）。
- ⬜ **S14** `src/lib/comfyui/status.ts:423-444`、`src/server/workshop/comfyui.ts:36-49` —— 进程内缓存永不过期且无失效钩子（正确性风险为主）。
- ⬜ **L9** `scripts/dev-launcher.mjs:1024-1089` —— 就绪轮询 1s×180 无退避，每轮还写状态文件。
- ⬜ **L10** `scripts/dev-launcher.mjs:261-318` —— `shellStaleWarning` 递归遍历 Rust 源码树逐文件 `statSync`。
- ⬜ **L11** `scripts/launcher-core/worktree.mjs:217-231` —— 每次启动全量解析两份 ~1.2 万行 YAML，无 mtime/size 短路。
- ⬜ **L12** `scripts/launcher-core/log.mjs:72`、`src-tauri/src/shell_launch.rs:396-397` —— 日志单条 flush / 无 BufWriter。
- ⬜ **L13** `tools/scripts/Build-Guard.ps1:215-249` —— 固定 500ms 忙等 + 三轮全进程 CIM 查询。
- ⬜ **L14** `scripts/quality-gate.mjs:229-232`（4 道门禁串行 spawnSync）、`vitest.config.ts`（coverage 列 60+ 路径 + 3 份 reporter、无分片）。
- ⬜ **L15** `src/app/api/update-check/route.ts:49-67/125-139` —— 前端 30s 轮询，同步递归遍历 `src-tauri` 全树（首轮 4 遍）。方向：目录级粗粒度比对或 `fs.watch`。
- ⬜ **E6** `src/app/api/custom-nodes/route.ts:557-562` —— 每次 GET 重读 + `JSON.parse` manifest/report，无缓存（对比 `runDiscover` 有缓存）。

## D. 维护说明

- 每条修复照旧：分支 + PR + `changelog.d/` 碎片 + pre-commit 全绿后合并；完成后把 ⬜ 改 ✅ 并在 A 表补一行（条目、级别、位置、修法、PR 号）。
- 修之前先复核条目仍然成立（本台账 A 表里已有两处初判被复核推翻，见 §B）。
- 全部闭环后按 `docs/README.md` §7.3 删除本文件。
