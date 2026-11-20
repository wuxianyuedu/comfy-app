## Fixed

- **SSE 的 NOT_FOUND 终态帧客户端不识别 → 任务被删后误报「任务连接中断」（#4606）**：
  服务端（#4453）在任务被删 / id 不存在时发 `status:"NOT_FOUND"` 终态帧，但客户端
  落定分支只认 FAILED / CANCELLED / ERROR —— 帧被丢弃，流关闭后 EventSource
  重连 404，用户看到误导性的「任务连接中断」。
  现在把 SSE state 帧的终态判据收进 `~/lib/task-state`（`isTerminalTaskStreamStatus`
  / `isFailedTaskStreamStatus`，含 NOT_FOUND），发射侧（stream 路由的帧值）与
  消费侧（generation-client 的落定分支）读同一份出处；客户端按服务端给的
  error 文案（「任务不存在或已被删除」）落定为失败，不再重连、不再误报。
