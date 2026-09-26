# 2026-09-26 性能问题排查与整改台账

> 来源：全仓四路并行排查（前端渲染 / 服务端与数据访问 / 资源与内存 / 启动构建与桌面壳），
> 每条 P0 均经逐行复核后落 PR；判定修正与例外见 §B。
> 状态图例：✅ 已整改（有 PR）｜📝 已记录（有意保留 / 误报 / 降级）｜⬜ 待整改。
> 闭环判定与文件生命周期遵循 `docs/README.md` §7：全部闭环后删除本文件。

## A. 已闭环（✅）

| 条目 | 级别 | 位置                                                             | 修复                                                                                                   | PR    |
| ---- | ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----- |
| S1   | P0   | `src/app/api/tasks/[id]/stream/route.ts:84-94`                   | SSE `done/error` 分支不清 `hbId`/`pollId` → 三个退出路径统一走幂等 `cleanup()`                         | #966  |
| M1   | P0   | `src/lib/comfyui/runner-state.ts:156/249/351-355`                | `logs` Map 无上限 → per-task 环形缓冲 + 终态淘汰                                                       | #968  |
| M2   | P0   | `runner-state.ts:162/251/540-549`                                | `rawCli` Map 键永不淘汰 → 按任务数 LRU                                                                 | #968  |
| L1   | P0   | `scripts/prepare-local-run.ps1:156-158`                          | `Get-FileHash` 漂移判据恒真（每次双击都全量 install）→ 复用 lockfile 实质 diff                         | #969  |
| F1   | P0   | `src/components/studio/project-canvas/WorkflowNode.tsx:124-127`  | 每节点 `findIndex` O(N²) → 按帧记忆 Map                                                                | #970  |
| F2a  | P0   | `GlobalStepLogPanel.tsx:378`                                     | `useNodes()` 订阅下沉到任务切换器子组件                                                                | #971  |
| F2b  | P0   | `GlobalStepLogPanel.tsx:637-668`                                 | 300 行内联 JSX → `memo` 化 `StepLogRow`                                                                | #973  |
| S2   | P0   | `src/lib/models.ts:86-109`                                       | 串行 N+1 → 并发拉取 + `upsertScannedMany` 批量 upsert                                                  | #974  |
| S3   | P0   | `src/lib/comfyui/localWorkflows.ts`                              | 同步递归扫盘 → 异步 `fs.promises`（方案更正见 §B）                                                     | #977  |
| S4   | P0   | `src/server/film/orchestrator.ts:510-594`                        | 成片监看 N+1 → 批量 `IN` + 只在变化时回写                                                              | #978  |
| S5   | P0   | `src/app/api/custom-nodes/route.ts:193`                          | 路由内 `spawnSync` → 异步 `spawn` + `withTimeoutResult`                                                | #979  |
| F3   | P1   | `src/components/studio/WorkflowCanvasDecorations.tsx:48-64`      | 选择器拼新对象 → 只订阅标量 zoom                                                                       | #980  |
| F5   | P1   | `src/components/ui/aurora-background.tsx`                        | 高斯核 40/50/60→24/28/32 + `contain` 重绘隔离                                                          | #1027 |
| F9   | P1   | `src/components/workshop/LLMContext.tsx:51-61`                   | Context value 现拼 → `useMemo`                                                                         | #1029 |
| F10  | P1   | `src/components/workshop/hooks/use-workshop-pipeline.ts:517-538` | 挂载取数无守卫 → `beginStaleRun`                                                                       | #1029 |
| M8   | P1   | `src/lib/log/log-ansi.ts:182`                                    | 每行 `new RegExp` → 复用模块级 `SGR_RE`                                                                | #1033 |
| M6   | P1   | `src/app/api/custom-nodes/route.ts:176-204`                      | `discoverCache` 无淘汰 → `rememberDiscover`（容量 32）                                                 | #1033 |
| M9   | P1   | `src/components/studio/project-canvas/stepLogCache.ts:117-123`   | 判重 O(n²) → 尾部窗口 64；单任务日志上限 2000（`tailWindow`）                                          | #1036 |
| M3   | P1   | `src/lib/comfyui/runner-state.ts:232`                            | `setMaxListeners(0)`（=无限，静音泄漏告警）→ 50                                                        | #1037 |
| S7   | P1   | `src/lib/core/repository-task.ts:161-171`                        | `task.list` 排除 `workflowSnapshot`/`logs` 大 JSON 列（`TaskCardRow`）                                 | #1043 |
| S11  | P1   | `src/server/api/routers/workflow.ts:792-795`                     | 循环 `upsertByName` → `upsertByNames` 批量                                                             | #1044 |
| M10  | P1   | `src/lib/comfyui/reaper.ts:482`、`executor-scheduler.ts:115`     | 常驻 `setInterval` 加 `unref()`                                                                        | #1048 |
| M11  | P1   | `src/lib/comfyui/executor-ws.ts:247`                             | 重连句柄存模块级，重复调度先清旧                                                                       | #1048 |
| S6   | P1   | `src/app/api/tasks/[id]/stream/route.ts:122-161`                 | 轮询换 `findSseSnapshot` 轻量投影，间隔 3s→5s                                                          | #1049 |
| M4   | P1   | 同上（路由侧）                                                   | 连接死亡（`send` 抛错）即 `cleanup()`，补上 abort 不亮的漏网路径（emitter 侧终态清理由 M3 的告警兜底） | #1049 |
| S8   | P1   | `src/server/api/routers/task.ts:53-62`                           | media 过滤改迭代补页（扫描上限与旧版对齐 400），不再固定拉 400 行                                      | #1052 |
| F7   | P1   | `src/components/workshop/ShotStudio.tsx:121-142`                 | 预填 effect 依赖收窄，抽成 `useAutoFillPrompts`（顺带回到 400 行预算内）                               | #1055 |
| M7   | P1   | `src/lib/log/capture-streams.server.ts:86/138`                   | 转录改 64KB/1s 缓冲批量落盘（FIFO 顺序不变）                                                           | #1058 |
| M5   | P1   | `runner-state.ts` 的 `settled`/`finalized`/`wsWaitLogged`        | 三个只增 Set 走 `addBounded`（4096 容量兜底）                                                          | #1061 |
| S10  | P1   | `repository-film.ts` / `repository-lora.ts` 的 `appendLog`       | `logs` JSON 列按尾部窗口 500 行截断（`tailWindow`）                                                    | #1067 |
| L6   | P1   | `dev-launcher.mjs` + `dev.mjs`                                   | 编排器注入 `COMFYAPP_SKIP_SCHEMA_SYNC=1`，一次启动只跑一份 schema 同步                                 | #1069 |
| L7   | P1   | `scripts/launcher-core/shell.mjs`                                | `whichCommand` 按 name+PATH+PATHEXT+platform 进程内记忆化 + `clearWhichCommandCache()`                 | #1078 |
| L8   | P1   | `scripts/launcher-core/procs.mjs:63`                             | netstat 快照按 1s TTL 缓存，三端口探测合并为一次子进程（CIM 批量化仍待做，见 C.4）                     | #1081 |
| S12  | P2   | `src/server/db/schema.ts:360`                                    | 连接表补 `wmtt_tag_idx`（按标签找模板不再全扫）                                                        | #1096 |
| L11  | P2   | `scripts/launcher-core/worktree.mjs:217-231`                     | lockfile 漂移判定按两份文件 size+mtime 指纹短路，跳过全量 YAML 解析                                    | #1099 |

## B. 判定修正与例外（📝）

| 条目                                       | 判定         | 依据                                                                                                                                                                                                |
| ------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HistoryList（原 F4 之一）                  | **误报**     | `use-history-list.ts` 已有 `PAGE_SIZE` + `visibleGroups` + `loadMore` 分页增量加载                                                                                                                  |
| F8 `WorkflowModePickChip` 订阅 `transform` | **无需改动** | 订阅已下沉到只在弹层打开时挂载的 `PopoverAutoClose`，且该组件 `return null`                                                                                                                         |
| S3 修法                                    | **方案更正** | 「缓存扫描结果」被测试打回：清单里的 `mtimeMs` 是调用方判断磁盘变化的判据（`workflow.ts` 建 `diskMtimeByPath`），缓存会让「只改内容、未改目录 mtime」读到过期值；改异步 fs 才同时保住新鲜度与不阻塞 |
| F6 raw-cli 弹窗 `key={index}`              | **降级暂缓** | 追加场景下 index + 稳定 entry 引用 + `memo` 已够用；根治需给服务端缓冲（`runner-state.appendRawCli` 存裸 `string[]`）加稳定行号，属数据结构改动，收益/成本不划算                                    |
| S9 `project.listByUser` 拉 `nodes`/`edges` | **有意保留** | `canvas-store.hydrateFromServer` 依赖列表里的画布 JSON 与本地对账（跨设备/换端口恢复）；裁列需重新设计「延迟拉取 + 离线合并」语义，属功能改动而非性能修，项目数量级小                               |

## C. 待整改（⬜）

### C.1 前端渲染（P1）

- ⬜ **F4a** `src/components/studio/ProjectOutputs.tsx:250` —— 产出网格 `outputs.map` 全量渲染（每卡带缩略图）。方向：行级虚拟化（`@tanstack/react-virtual`，范式见 `ModelLibrary.tsx:135`）。
- ⬜ **F4b** `src/components/studio/workflow-library/CustomNodesSettings/NodesTab.tsx:141/233/364` —— 节点库三层嵌套全量 `map`（自定义节点包可含数百~上千类型）。方向：展开时才挂载 + 展开组内虚拟化。
- _（F7 已闭环，见 A 表。）_

### C.2 资源与内存（P1）

_（M5 / M7 已闭环，见 A 表。）_

### C.3 服务端 / 数据访问（P1）

_（全部闭环，见 A 表。）_

### C.4 启动 / 构建 / 桌面壳（P1）

- ⬜ **L2** `scripts/build-desktop.mjs:152/182/93-115/291-298` —— 全删全拷（`cpSync` 带 `dereference` 实拷 pnpm store 链接）+ `dirSize()` 递归 `statSync` 整棵 static 两遍。方向：`filter` 排除噪声目录；一次遍历同时算总量与 Top 子目录。
- ⬜ **L3** `src-tauri/src/shell_launch.rs:936-960` —— 注释承诺「命令行廉价预筛」但循环内无预筛，每个 PID 都 `OpenProcess`+读 64KB 环境块。方向：实现进程名/命令行预筛。
- ⬜ **L4** `public/splash.html:730` + `src-tauri/src/lib.rs:513/545/671-760` —— 启动页日志面板每 800ms 轮询，命令对 4 个日志文件各整文件读入（且日志不轮转）。方向：seek 到尾部读最后 N 字节 + 降频/退避。
- ⬜ **L5** `src-tauri/src/lib.rs:1418(250ms×480)`、`2110(1s×300)`、`2084(100ms×50)`、`958(500ms×240)`、`475(2s×90)`、`single_instance.rs:442-455(100ms×∞)` —— 6 处固定间隔 sleep 轮询，无退避无统一收口。方向：收敛到统一的「带退避的等待」工具。
- ⬜ **L8b** `scripts/dev-launcher.mjs:415-432` —— 每个待裁定 PID 再 spawn 一次 PowerShell CIM。方向：一次 `Get-CimInstance Win32_Process` 批量取全部 PID 的命令行（netstat 部分已闭环）。

### C.5 P2（卫生项，随上一批顺手修）

- ⬜ **M12** `src/app/api/logs/current/route.ts`（`readdirSync`/多次 `statSync`）、`api/logs/sessions/route.ts`（同步读+解析 4MiB 尾窗）—— 高频轮询路由的同步 IO。
- ⬜ **S13** `src/app/(main)/settings/hooks/use-settings-page.ts:183-187` —— `comfyStatus` 5s 轮询。**暂缓**：该间隔有 ISSUE #339 的收紧依据，且注释称「服务端有进程级快照兜底」—— 需先核实 `status.ts` 的快照链路（与 S14 的「缓存无失效出口」联动评估），避免误改有意行为。
- ⬜ **S14** `src/lib/comfyui/status.ts:423-444`、`src/server/workshop/comfyui.ts:36-49` —— 进程内缓存永不过期且无失效钩子（正确性风险为主）。
- ⬜ **L9** `scripts/dev-launcher.mjs:1024-1089` —— 就绪轮询 1s×180 无退避，每轮还写状态文件。
- ⬜ **L10** `scripts/dev-launcher.mjs:261-318` —— `shellStaleWarning` 递归遍历 Rust 源码树逐文件 `statSync`。
- _（L11 已闭环，见 A 表。）_
- ⬜ **L12** `scripts/launcher-core/log.mjs:72`、`src-tauri/src/shell_launch.rs:396-397` —— 日志单条 flush / 无 BufWriter。
- ⬜ **L13** `tools/scripts/Build-Guard.ps1:215-249` —— 固定 500ms 忙等 + 三轮全进程 CIM 查询。
- ⬜ **L14** `scripts/quality-gate.mjs:229-232`（4 道门禁串行 spawnSync）、`vitest.config.ts`（coverage 列 60+ 路径 + 3 份 reporter、无分片）。
- ⬜ **L15** `src/app/api/update-check/route.ts:49-67/125-139` —— 前端 30s 轮询，同步递归遍历 `src-tauri` 全树（首轮 4 遍）。方向：目录级粗粒度比对或 `fs.watch`。
- ⬜ **E6** `src/app/api/custom-nodes/route.ts:557-562` —— 每次 GET 重读 + `JSON.parse` manifest/report，无缓存（对比 `runDiscover` 有缓存）。

## D. 维护说明

- 每条修复照旧：分支 + PR + `changelog.d/` 碎片 + pre-commit 全绿后合并；完成后把 ⬜ 改 ✅ 并在 A 表补一行（条目、级别、位置、修法、PR 号）。
- 修之前先复核条目仍然成立（本台账 A 表里已有两处初判被复核推翻，见 §B）。
- 全部闭环后按 `docs/README.md` §7.3 删除本文件。
