## Fixed

- `/api/schema/push` 的并发闸挂到 `globalThis`（带版本键），不再放模块顶层——dev 的
  HMR 会重置模块变量，而闸要保持到 db-sync 子进程退出（最坏 600s）；模块被重新
  求值时闸归零，第二个请求会穿过两道闸并发 push 同一个 SQLite。与 ollama-start
  启动锁同一形态。（#4455）
