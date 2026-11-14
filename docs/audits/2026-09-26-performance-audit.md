# 2026-09-26 性能问题排查与整改台账

> 来源：全仓四路并行排查（前端渲染 / 服务端与数据访问 / 资源与内存 / 启动构建与桌面壳），
> 每条 P0 均经逐行复核后落 PR；判定修正与例外见 §B。
> 状态图例：✅ 已整改（有 PR）｜📝 已记录（有意保留 / 误报 / 降级）｜⬜ 待整改
> ｜⬜ … → **#NNNN** 已转 Issue 跟踪（2026-10-22 起，§C 七条全在这一态；跟踪面在单上，不在这里）。
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
| L8   | P1   | `scripts/launcher-core/procs.mjs:63`                             | netstat 快照按 1s TTL 缓存，三端口探测合并为一次子进程（这格末尾曾写「CIM 批量化仍待做，见 C.4」—— 它已随同表 L8b / #1129 闭环，C.4 里现在没有这一项） | #1081 |
| S12  | P2   | `src/server/db/schema.ts:360`                                    | 连接表补 `wmtt_tag_idx`（按标签找模板不再全扫）                                                        | #1096 |
| L11  | P2   | `scripts/launcher-core/worktree.mjs:217-231`                     | lockfile 漂移判定按两份文件 size+mtime 指纹短路，跳过全量 YAML 解析                                    | #1099 |
| L2   | P1   | `scripts/build-desktop.mjs:182`                                  | 噪声目录复制前由 `cpSync` filter 排除（不再先拷后删）                                                  | #1112 |
| L3   | P1   | `src-tauri/src/shell_launch.rs:936-960`                          | `find_owned_orchestrator` 落地 exe 名预筛，非 node 进程不再跨进程读环境块                              | #1114 |
| L4   | P1   | `src-tauri/src/lib.rs:513` + `public/splash.html:730`            | 日志尾部读取改 seek（不整读文件）；splash 日志轮询 800ms→1500ms                                        | #1117 |
| E6   | P2   | `src/app/api/custom-nodes/route.ts:626`                          | manifest 摘要按 size+mtime 指纹缓存，GET 不再整份读盘解析                                              | #1121 |
| L12  | P2   | `scripts/launcher-core/log.mjs:72`                               | 编排器日志改 16KB/500ms/exit 缓冲落盘（exit 钩子保证归档完整）                                         | #1125 |
| L9   | P1   | `scripts/dev-launcher.mjs:1024-1089`                             | 就绪等待轮询退避（1s→2s→3s）+ 状态文件每 5 轮写一次；总超时仍为墙钟 deadline                           | #1109 |
| L8b  | P1   | `scripts/launcher-core/procs.mjs` + `dev-launcher.mjs`           | 端口占用裁定改批量取命令行（一条 CIM / 一条 ps），`cmdlineOf` 契约不变                                 | #1129 |
| F11  | P1   | `src/lib/page-window.ts` + 三处日志窗口                          | 尾部窗口改增量追加（`tailWindowAppend`：满时原地 `shift`+`push`，不再整份复制 + 切片）                 | #1873 |
| S14a | P1   | `src/lib/comfyui/status.ts:423-457`                              | 在途查询随 `reset` 作废 + 身份比对才回写；在途去重只在非 `force` 档生效                                | #1873 |
| S13  | P1   | `src/app/(main)/settings/hooks/use-settings-page-comfy.ts`       | `comfyStatus` 改「事件驱动为主、30s 兜底」：新增 `/api/comfy/state` 长轮询推送（五个变化源：启动 / 就绪 / 关闭 / 退出 / 配置写入） | #1874 |
| F11b | P1   | `src/lib/workflow/workflow-run-store.ts`                         | 日志落盘改合并窗口（250ms）：每来一行整表序列化 → 窗口内只写一次；判重收窄到尾窗 64 条；追加改 `tailWindowAppend`（实测 20s / 2000 行：8109ms → 331ms，落盘 2000 → 80 次） | #1885 |
| F12  | P1   | `src/components/studio/logs/log-analysis.ts`                     | 时间线去重索引跨轮复用（`TimelineIndex` + `mergeTimelineIndexed` / `trimTimelineIndex`）：每轮重建两张全表 Map → 只在形状变化时建；截断改摘键 | #1887 |
| F4a  | P1   | `src/components/studio/ProjectOutputs.tsx` + `ViewContainer.tsx`（滚动锚） | 产出网格行级虚拟化：虚拟项 = 一行 2~4 卡（列数按容器宽推，镜像旧断点）；`useVirtualizer` 挂文档型滚动锚 `data-document-scroll`；未量测环境全量渲染兜底（ModelLibrary 的 `measured` 守卫同形） | #2375 |
| L5   | P1   | `src-tauri/src/poll_clock.rs`（新）+ `lib.rs` + `single_instance.rs` | 六处手写 sleep 轮询收敛成 `PollClock`：每拍先 tick 再探测（首绘看护那次「`continue` 跳过循环底 sleep」的事故从结构上消失）；预算改墙钟、退避不缩短它；focus waiter 走 `forever` 形。守事故的 `#[test]` 同批改钉新不变量 | #2315 |
| S14  | P1   | `src/server/workshop/comfyui.ts`（检索 `resolvedBase` / `resetWorkshopComfyBase`） | 两份进程内 memo 补失效出口：`resetWorkshopComfyBase()` 丢缓存重新探测，执行者是本模块的 `guardNetworkFailure`（连不上才复位，活实例报错不复位）；手改 settings 生效、端口漂移不再钉死 | #2323 |
| F4b  | P1   | `src/components/studio/workflow-library/CustomNodesSettings/NodesTab.tsx`（检索 `useVirtualizer`） | 单包节点卡列表窗口化：挂载成本不再随包内类型数线性涨（另两层此前已「展开才挂载」） | #2548 |

## B. 判定修正与例外（📝）

| 条目                                       | 判定           | 依据                                                                                                                                                                                                            |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HistoryList（原 F4 之一）                  | **误报**       | `use-history-list.ts` 已有 `PAGE_SIZE` + `visibleGroups` + `loadMore` 分页增量加载                                                                                                                              |
| F8 `WorkflowModePickChip` 订阅 `transform` | **无需改动**   | 订阅已下沉到只在弹层打开时挂载的 `PopoverAutoClose`，且该组件 `return null`                                                                                                                                     |
| S3 修法                                    | **方案更正**   | 「缓存扫描结果」被测试打回：清单里的 `mtimeMs` 是调用方判断磁盘变化的判据（`workflow.ts` 建 `diskMtimeByPath`），缓存会让「只改内容、未改目录 mtime」读到过期值；改异步 fs 才同时保住新鲜度与不阻塞             |
| F6 raw-cli 弹窗 `key={index}`              | **降级暂缓**   | 追加场景下 index + 稳定 entry 引用 + `memo` 已够用；根治需给服务端缓冲（`runner-state.appendRawCli` 存裸 `string[]`）加稳定行号，属数据结构改动，收益/成本不划算                                                |
| S9 `project.listByUser` 拉 `nodes`/`edges` | **有意保留**   | `canvas-store.hydrateFromServer` 依赖列表里的画布 JSON 与本地对账（跨设备/换端口恢复）；裁列需重新设计「延迟拉取 + 离线合并」语义，属功能改动而非性能修，项目数量级小                                           |
| L10 `shellStaleWarning` 全量 stat          | **不值得**     | 每次启动仅调用一次、目标树（Rust 源码 + splash 资源）文件数有限，全量 stat 毫秒级；免 stat 的目录级 mtime 会漏掉「编辑已有文件」这一最常见场景、把旧壳误判为新，判据退化                                        |
| L14a 门禁聚合的串行 `spawnSync`            | **维持现状**   | 平台逐格墙钟（`cnb-ac2-1k5n5pftv` / `cnb-cid-1k5naje7o` 的 stage-30）：不含 cargo test 时 47 条合计 **45.1s**（占该 PR 流水线 ~25 分钟的 ≈3%），短格（<1.2s，spawn 启动税承重区）36 条合计 17.6s。并行化的理论收益 ≈25-30s，代价是 47 个 node 进程同时压这台**既跑 PR 又跑每日还跑开发会话**的共享机 —— 那正是 §13.5.21「全量单测不进 PR 档」要防的「超订把读数变不可信」形态；且聚合档有顺序与工作区前提（D0 先行 / 部分格写指纹账），并行要重排。收益面本身比 2026-09-26 小得多（本地默认档只剩 D0，实测 5.7s）。付费者：PR 平台那格（每条 PR 3%）与本地 `check:all` / `premerge --full`（人工触发） |
| L14b 覆盖率面 124 条 glob + 三份 reporter  | **维持现状**   | 与 `thresholds` 的**逐条配对**是判据（只写门槛不进 `include` 会让门槛静默失效，`ui/file-picker.tsx` 前车之鉴）—— 任何「合并 glob」都在没有回归信号的情况下改了棘轮分母（§18.6：门槛取实测值只升不降）；`--shard` 与「重档归平台每日档」是同一个执行面决定（§13.5.21），不是配置里加一行。coverage 的墙钟占比没有独立读数 —— 它随 `每日单元测试` 一起跑（该格 779s，主体是 3000+ 用例本身），单拆 reporter/glob 的税在总账里读不出来，先记账不动手 | 量级一路在缩：2026-10-22 复量 87 文件 / 50-58ms 每遍；2026-10-24 复量（#2315 后的树上，含 build-desktop 产物）106 文件 / 暖态 6.4-8.5ms 每遍 —— 每 30s 轮询 ≈ 16ms 同步 IO，噪声级。目录级 mtime 的失效形态与 L10 同款（漏「编辑已有文件」），`fs.watch` 要处理长驻进程的句柄漂移，两者都不值这 16ms。**「同步 IO」那一半同族归 M12 / #2193 的异步化那轮顺带**，不单独立项 |
| L12b Rust 侧日志逐条 open/write/close      | **有意保留**   | `append_line` 每条开/关文件与 Node 侧同源——**不持有句柄**：残留进程握住日志文件会锁死下次启动的重定向（历史事故）；BufWriter 常驻句柄会重新引入该风险，壳侧日志频率低，成本可接受                               |
| L13 `Build-Guard.ps1` 500ms + 三轮 CIM     | **有意保留**   | 500ms 是 `taskkill /T /F` 异步生效后的必要复查间隔；三轮 CIM 各对应一个判定点（初始 / 回收后复查 / AutoClose 后复查），正常路径仅首轮 1 次 CIM 即返回 0                                                         |
| F11b 复核（#1885）                         | **成立并已修** | 与 F11 同一条链的**落盘侧**：F11 / M9 修的是「窗口写法」与「判重」，而 `workflow-run-store` 每次 `notify()` 都整表 `JSON.stringify` + 同步 `localStorage.setItem`（实测 4.2ms / 683KB），这笔开销此前没人看。列表要立刻更新、能合并的只有落盘那一半 |
| F11 复核（#1873）                          | **成立并已修** | 复核 M9 / F2b 那条链时翻出的：**判重与行组件**当时都修了，而 `setLogs` 的窗口写法本身（每行「整份复制 + 整份切片」两遍 O(上限)）没被一起看。窗口 2000、连打 6 万行实测 113ms → 4ms（28×），堆峰值 ~9MB → ~0.5MB |
| F12 复核（#1869）                          | **成立并已修** | 沿 F11 / M9 那条链往下翻到的「另一半」：**M9 修的是判重扫满窗口（O(n²) 那一半），F11 修的是窗口写法（复制那一半）**，而 `mergeTimeline` 每轮为判「这一两行是不是新的」建的两张全表 Map 没被一起看——5000 条上限下实测占整次合并的 **97%**（2.27ms / 2.34ms，排序只占 0.11ms）。store 路径单轮 5.127ms → 3.046ms（1.68×）。**刻意没动**：`computeCounts` / `computeFiltered` 等派生计算（那是 ISSUE #1782 已收口的面，不属本条），以及时间线无上限这条既有设计 |

## C. 待整改（⬜ 七条已于 2026-10-22 逐条复量并转 Issue）

> **这一节为什么把行号全换了**：本节旧版有 **14 处** `file:NN` 定位，2026-10-22 逐条复量时
> **逐行回读那一行的内容**（不是只验「行号在文件范围内」），结果是
> **8 处指的不是它描述的那个东西** —— 其中五处在 `src-tauri/src/lib.rs`，
> 落点分别是「POSIX 常量注释」「`&format!(`」「`);`」「`clamp_to_monitor` 调用」
> 与「一条日志话术」，与它各自声称的那条 sleep 循环毫无关系；
> `quality-gate.mjs:229-232` 那一处现在落在一段 JSDoc 上（真正的 `spawnSync(` 在 261 与 284）。
> 另外 6 处仍然对得上或被区间覆盖 —— **这正是要改掉 `:NN` 的理由**：区间能盖住，
> 单行会悄悄挪走，而 `docs/audits/**` 不在 `pnpm doc:check` 的核对面里、
> `check-doc-references.cjs` 也不解析过程文档的行号 ⇒ **没有任何判据会红**。
> 现在定位一律写检索式（符号 / 搜索串），每条后面跟它的 Issue 号 —— 症状、当场读数与
> 复算命令都只在单里写一份，抄在这张台账里就是 §12.12 的孪生对。
> 按 `docs/README.md` §7.3，本文件此刻已满足删除条件（没有未被跟踪的 ⬜）；**保留它的理由**
> 是 §A 的「条目 ↔ PR」对应表与 §B 的判定修正仍是引用对象（`docs/standards/02-性能规范.md`
> 引它取 F1 / F2a / F2b / F3 的闭环结论，`docs/audits/2026-10-12-architecture-risk-review.md`
> 开头声明「不含本文件已闭环的微性能项」）。

### C.1 前端渲染（P1）

- _（F4a 已闭环，见 A 表。）_
- ~~**F4b** → **#2191**。节点库三层嵌套 `map`（自定义节点包可含数百~上千类型）。~~
  **已闭环（#2548）**：单包节点卡列表窗口化（`useVirtualizer`），挂载成本不再随包内类型数
  线性涨；两层「展开才挂载」的门控在此前复核中已落地。见 A 表 F4b 行。
- _（F7 已闭环，见 A 表。）_

### C.2 资源与内存（P1）

_（M5 / M7 已闭环，见 A 表。）_

### C.3 服务端 / 数据访问（P1）

_（全部闭环，见 A 表。）_

### C.4 启动 / 构建 / 桌面壳（P1）

- _（L5 已闭环，见 A 表。）_
- _（L8b 已闭环，见 A 表。）_

### C.5 P2（卫生项，随上一批顺手修）

- ~~**M12** → **#2193**。高频轮询路由的同步 IO~~ **已闭环（#2193）**：原点那句「`/api/logs/current`
  被面板每 2s 打一遍」低估了面 —— `POLL_SOURCES` 是**六路**来源，每 2s 各一次；而按原登记的那条
  检索式（`statSync|readFileSync|readdirSync`）复算，`src/app/api/logs` 下是**五份** route 在场
  （`current` / `sessions` / `diagnostics` / `history` / `list`，台账只点了前两份），
  改成判据现算时又抓到**第六份** `export`（它用的是 `mkdirSync` / `writeFileSync`，
  不在那条 grep 的量程里 —— 「清单点数」与「按目录现算」的差就是这么出现的）。
  处置：六份 route 的读写全部换 `fs.promises`；轮询链真正经过的四个读侧 helper
  （`fileMtimeMs` / `latestPanelLogFile` / `listRuntimeLogFiles`+`latestRuntimeLogFile` / `scanRunPacks`）
  一并异步化，**写侧**（`appendFileSync` 落盘、`prune*` 的 `rmSync`、启动期 `mkdirSync`）刻意不动 ——
  它们不在被轮询的那条链上，异步化会把 lifecycle 整条签名拖进来（那是另一轮）。
  两条原登记点名的风险都按处处置：`turbopackIgnore` 标记**逐处跟着调用点搬**（`current` 那
  7 枚变 3 枚是因为 `existsSync` + `statSync` 合并成一次 `stat`，不是漏搬；`history` / `list`
  原本不带，也**没有**给它们补 —— 加标记同样是改 tracing）；会话边界那层的顺序假设按
  「逐包 await、不 `Promise.all`」保住（`scanRunPacks` 的输出顺序就是判据）。
  判据：`tests/log-routes-no-sync-fs.test.ts`（面按目录取，新加一份 route 自动进面；
  先剥注释再匹配，所以注释里可以说 `statSync`；另附两条负控制 —— 真同步形态抓得到、
  `fs.promises.*` 不误伤）。验证：既有读取契约用例一字未改并全绿
  （`current/route.test.ts` 12 条、`sessions/route.test.ts` 23 条、四个 helper 的 39 条），
  真机 dev server 上六路各一次 200 且游标增量成立（第二帧 `offset` = 第一帧 `size`）；
  `pnpm run build` EXIT=0，产物判据绿（3152 文件、无缺件无私件），路由表里六条 logs 路由仍全为动态。
  **本轮不主张省了多少毫秒**：dev 模式首帧含按需编译，跨档不可比；承重的是
  「请求路径上的同步系统调用清零」这条可判的形状。顺带在真机复算时撞上另一条，已单独立案
  （**#2417**：`isPanelSelfPollingLine` 的端点集合停在 `logs/current` + `dev/server-id` 两个名字上，
  每 30s 一拍的 `/api/dev/build-id` 回声行不滤）。
  **备注（保留原登记那条口径，它自己是账）**：`current` 早已是游标增量 + 尾部窗口
  （窗口大小搜 `TAIL_BYTES`，`sessions` 那份搜 `MAX_TEXT_BYTES` —— 本台账旧版写「4MiB 尾窗」是
  **抄走的数值**，复量是 40 万字节那一档，这正是「绝对数值不进台账」这条口径的由来）。
- ~~**S13** `src/app/(main)/settings/hooks/use-settings-page.ts:183-187` —— `comfyStatus` 5s 轮询~~ **已闭环（#1874）**：5s 那一拍当初是为「外部拉起的实例要被及时认出来」而收紧的，现在改成**事件驱动为主**（服务端一发现运行态变化就经 `/api/comfy/state` 推过来，设置页收到立刻重问），兜底那一拍从 5s 放到 30s 且只剩「通道自己坏了」这一件事。**复核进展（#1873）**：快照链路已核实——TTL `1.5s` / 未绑定端口 `0s`（`COMFY_UNBOUND_PORT_TTL_MS`），且动作后会 `reset`，所以这 5s 不是「兜住一个永不过期的缓存」而是纯轮询节奏；核实中翻出的那条「启动了却读到旧结论」的窗口已单独闭环（S14a，见 A 表）。
- ~~**S14** → **#2194**（只剩 `src/server/workshop/comfyui.ts` 那一半，定位搜 `settingsCache` /
  `resolvedBase`；旧登记的 `:36-49` 其实还盖得住，改写成检索式是按本节的统一口径，不是因为它错了）~~
  **已闭环（#2323）**：两份 memo 补上失效出口 `resetWorkshopComfyBase()`（与
  `~/lib/comfyui/client.ts` 的 `resetComfyBase()` 同语义），执行者是本模块的 `guardNetworkFailure`
  —— 连不上才复位，活实例报错不复位。见 A 表 S14 行。
  —— `status.ts` 那一半已闭环（**S14a**，见 A 表）：缓存本就有 TTL + `reset` 出口，缺的是「在途查询不随 `reset` 一起作废」，已随 #1873 修。
  —— `workshop/comfyui.ts` 的 `settingsCache` / `resolvedBase` 是**进程内 memo、无失效出口**（改设置文件后要重启才生效）。它属功能语义（何时该失效）而非纯性能，单列一轮。
  —— 转单时补的一条对照：同维度的 `src/lib/comfyui/client.ts` 那份缓存**有**出口 `resetComfyBase()`，
  它的注释写的理由正是「ComfyUI 重启后可能落在另一个端口」—— 同一件事两侧各写一份、
  只有一侧带失效出口，这是「正确性风险为主」那句的具体形状。
- _（L9 已闭环，见 A 表。）_
- _（L10 已判定为不值得（见 B 表）；L11 已闭环，见 A 表。）_
- _（L12b / L13 已判定为有意保留（见 B 表）。）_
- _（L14 已定性为两半都维持现状（见 B 表；读数出处在那两行里）。）_
- _（L15 已判定为维持现状（见 B 表；同步 IO 那一半已随 M12 / #2193 闭环，见本节上面那条）。）_
- _（E6 已闭环，见 A 表。）_

## D. 维护说明

- 每条修复照旧：分支 + PR + `changelog.d/` 碎片 + pre-commit 全绿后合并；完成后把 ⬜ 改 ✅ 并在 A 表补一行（条目、级别、位置、修法、PR 号）。
- 修之前先复核条目仍然成立（A 表里就有初判被复核推翻的条目，全部记录在 §B —— 条数不写在这里，
  §B 那张表会长，写死一次就漂一次）。
- **定位一律写检索式，不写 `file:NN`**。这条是本文件自己付出来的：§C 旧版 14 处行号引用，
  逐行回读内容后有 8 处指错了东西（方法与五处落点记在 §C 开头），而**没有任何判据会红** ——
  `docs/audits/**` 不在 `pnpm doc:check` 的核对面里，`check-doc-references.cjs` 也不解析过程文档里的行号。
  写符号名与搜索串，改名字才会被 grep 抓到。
- **绝对数值换成复算入口**（窗口大小指到常量名、耗时给「怎么复量」）；`⬜` 长期不动的转成 Issue，
  行尾写 `→ #NNNN`，跟踪面就交出去了，这里只留形状。
- 全部闭环后按 `docs/README.md` §7.3 删除本文件。§C 已转 Issue 跟踪，所以「删除条件」此刻成立；
  §A / §B 仍是上面点名那两份文档的引用对象，删之前要先把那两条引用一起处理。
