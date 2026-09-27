## Changed

- **P3 §5 第 2 期 · Phase 3-C：SSE 改纯 DB 短轮询（单源化），inline/host 两模式同一契约**（三个已签决定记入设计文档 §13-3C）：
  - **D3 退役订阅通道**：`/api/tasks/[id]/stream` 删除进程内 `subscribe`（emitter→SSE）通道，log/state 全部以 DB 为准——单一来源、无重复帧；host 执行（3-B1）不再有两模式分裂（#1151 补的终态收口顺势成为通用路径）。`subscribe` 本体保留给 `firstframe.ts` 进程内消费，emitter 彻底删除在 4-A。初始 `replaySrc` 回放（内存优先、DB 兜底）按 ADR 原案保留。
  - **D2 轮询 5s → 3s**：进度/日志/取消/终态感知统一 ≤3s（叠加 persistLogs 200ms 防抖）。
  - **D1 节点级进度落库**：`task` 新增 `progressNode`（json）列，`updateProgress` 加可选第三参（executor-ws 现成 node 对象随进度 tick 落库；帧无节点信息时不覆写、画布标签不闪没）。此前「当前节点+步数」只活在进程内 progress 帧里，host 模式整条丢失。
  - 轮询每 tick：日志按游标做增量 diff 发 `log` 帧（数组只变长；异常变短只归正游标不重发历史），`state` 帧在 status/progress/node 任一变化时发出、终态附 `images`（#1151 形状）。`findSseSnapshot` 投影相应补 `progressNode`/`logs` 两列（仍不含 `workflowSnapshot` 大列）。
  - **cli 进度回写洞（E2E 实测抓出）**：raw 执行路径的进度事件全走 comfy-cli stdout（`type:"progress"`，带 node/completed/total）、不走 executor-ws 的 WS——而 cli 的 `onProgress` 此前只发进程内 emitter，SSE 单源化后进度/节点全程空（实测 state 帧 0→100 一跳）。补：`createCliEnvelopeParser.onProgress` 透传 node 步数，`executeViaComfyCli` 在发 emitter 事件的同时 `void updateProgress(taskId, pct, node)`（CAS 在 impl 内部，形态对齐 onPromptId 的 markRunning）。
  - `pnpm db:push` 已落 `progressNode` 列（`pragma_table_info` 真数确认）。

## 测试

- `repository-task-impl.test.ts` +1：node 快照落列、缺省参不覆写。
- 真机端到端（自主验证）：改 prompt 防 ComfyUI 缓存 → 种 host 行 → host 领取执行 → curl SSE 观察执行中 log 增量帧与 `node` 字段 → 终态 images 帧收流；inline 模式同法回归一遍。
