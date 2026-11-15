## Fixed

- 工坊会话编排的丢更新（#3891）：`generateImage` / `submitVideo` / `generateScript` 等
  变更函数的「load 快照 → 外部调用 → updateState 整包写回」跨度现在按会话 id 走
  `KeyedAsyncMutex` 串行化（`sessionMutationMutex`）。并发 MCP 工具（同时给两个镜头
  生图）不再以各自旧快照互相覆盖；锁内 `load` 拿到的必是上一个变更落库后的最新状态。
  读路径（`getSession` / `listSessions`）不进锁，界面读取保持实时。
