## Fixed

- **`browser-fetch` 的片级重试不再无退避连打下载端点**（ISSUE #3955）。
  `scripts/ci/ci-toolchain-browser-fetch.mjs` 的分片下载里，单片失败后
  `for (attempt 1..retries)` 立即重试、两次尝试之间没有任何等待 —— 对已经抖动 / 限流的
  下载端点是连续快打，既加重对端压力也更难成功。现在第 `n` 次失败后按
  `FETCH_CHUNK_BACKOFF_MS × n`（500ms 起、线性）同步退避后再试下一轮；最后一次失败
  后面没有下一轮，不再白等。退避用 `Atomics.wait` 实现同步等待，保持本层「同步退出码
  路径」与「只 import `node:*`」的约束不变（因此不引 `retry-policy`，退避形状与依据
  对齐规范 §8.10 ②）；测试经新增的 `sleep` 注入面记录时长验证，不真等。CI 工具脚本，
  低危。
