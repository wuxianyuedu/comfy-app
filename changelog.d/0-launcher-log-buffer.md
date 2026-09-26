## Fixed

- **编排器日志逐条同步落盘（`scripts/launcher-core/log.mjs`）**：
  `createLogSink` 每打一条日志都 `appendFileSync`（open/write/close × 每行）。现在
  攒进缓冲，满 16KB / 500ms / 进程 exit 时一次落盘；`close()` 与 `process.on("exit")`
  都会 flush，保证退出前的 `archiveRunLog` 归档读到完整内容；崩溃最多丢一份未满缓冲
  （与 `capture-streams` 的转录缓冲同判据）。
