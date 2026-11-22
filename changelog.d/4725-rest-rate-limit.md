## Fixed

- **扣费 / 外联 / 拉进程的 REST 端点补统一限流（#4725，#3904 的子项）**。滑动窗口
  限流（10s / 20 次）此前只挂在 tRPC 三个 delete 上；现给会花钱、会外联、会拉进程
  的端点挂上同一份桶：`/api/llm/test`、`/api/llm/test-usage`（含 query 轮询）、
  `/api/llm`、`/api/agent/chat`、`/api/workshop-api/generate`、`/api/comfy/ensure`
  （拉起子进程）、`/api/schema/push`（强制 schema 同步）。REST 侧出口收在
  `~/server/lib/rest-rate-limit`（复用 `checkRateLimit` 纯函数，键按端点名 +
  `x-forwarded-for` 首段，直连回落 local），超限回 429。
