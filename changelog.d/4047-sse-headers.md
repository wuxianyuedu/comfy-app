## Fixed

- **`tasks/[id]/stream` 的 SSE 头与公共边缘对齐（#4047）**：补
  `X-Accel-Buffering: no` 与 `charset=utf-8`（与 sse-stream.ts 的
  SSE_HEADERS、console/run 同一形状）——此前经启用缓冲的反代时，任务进度 /
  日志帧被攒到连接关闭才到客户端，任务「看起来卡住」。接口契约与兼容审计
  #3907 的 P3 项。
