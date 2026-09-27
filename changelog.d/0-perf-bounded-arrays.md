## Fixed

- **三类随会话无限增长的数组补上内存上限（规范 §2.1 / P1 反模式 `[...prev, …]`）**：
  - `use-workshop-agent.ts` 的 Agent 对话 `messages` 与工具运行 `toolRuns`：长会话含大量 tool-run，此前 `setMessages((prev) => [...prev, msg])` 无上限追加，现按 `AGENT_MESSAGE_MAX` / `AGENT_TOOLRUN_MAX`（2000）环形截断。
  - `use-task-step-log-stream.ts` 的本地 `logs` state：SSE 每帧 `setLogs((prev) => [...prev, entry])` 无上限，绕过了 `stepLogCache` 已有的 `MAX_LOGS_PER_TASK=2000` 环形缓冲——现复用同一常量 + `tailWindow` 截断（缓存裁了、本地 state 也裁，避免 React state 层无界增长）。
  - `use-custom-nodes-settings.ts` 的解析控制台 `logs`：流式解析逐行追加无上限，现按 `PARSE_LOG_MAX`（2000）截断。
