## Fixed

- **评审族 / 成片族的业务失败改抛 `TRPCError`（#4042）**：`review.ts`（18 处）、
  `orchestrator.ts`（5 处）、`compose-film.ts`（2 处）此前裸抛 `Error`，经 tRPC
  透传一律包成 `INTERNAL_SERVER_ERROR`（500）——「镜头还没有生成图」「没有可
  生成的镜头」这类**可预期的业务前置不满足**与真实服务端故障拿到同一个码：
  客户端无法按码分支，`sync-notice` 把这类拒收误判为「暂时性 / 可重试」，
  正常用户操作污染 `trpc_error` 错误面板。现在按语义映射：前置不满足 →
  `PRECONDITION_FAILED`、不存在 → `NOT_FOUND`、客户端输入错 → `BAD_REQUEST`、
  模型产出不可用 → `UNPROCESSABLE_CONTENT`；ffmpeg 执行失败保持 500（那是
  真故障）。同族「生产数据行不存在」的两种码（PRECONDITION_FAILED vs
  NOT_FOUND）一并统一。接口契约与兼容审计 #3907 的 P2 项。
