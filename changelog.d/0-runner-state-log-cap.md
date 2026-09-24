## Fixed

- **执行器内存日志与 comfy-cli 原文缓冲只增不减（`src/lib/comfyui/runner-state.ts`）**：
  `state().logs`（`Map<taskId, LogEntry[]>`）此前只有 `push`、全仓没有任何删除或
  淘汰 —— 进程跑得越久、执行过的任务越多，驻留的日志行越多，且它们还会被
  `persistLogs` 整包写回数据库；`rawCli` 虽然给单个数组设了 5000 行上限，Map 的
  **键**同样永不删除，每个跑过的任务都留下最多 5000 行 CLI 原文常驻。现在两个缓冲
  共用 `touchAndEvict`：写入时把该任务标记为「最近使用」，行数超 `LOGS_MAX_LINES`
  （5000）丢最旧的一段，任务数超 `LOGS_MAX_TASKS`（64）淘汰最久没写过的那个任务。
  淘汰不丢数据 —— 日志已由 `persistLogs` 落库，SSE 回放读不到内存时会回落 DB 列。
