## Fixed

- **流式读取的取消路径补全**（#4218）：`streamLLM` 的读循环在 `onToken`（写 SSE）
  抛错时上游 reader 不 cancel、`readResponseBufferCapped`（comfyui / api-channel 两份
  同形实现）与 media-source 的内联循环超 24MB 抛出时只 `releaseLock`——上游连接与
  缓冲会滞留到超时。现在异常/超限路径统一 `reader.cancel()`（正常读完时是无操作）。
