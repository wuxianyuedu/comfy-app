## Fixed

- **执行日志面板的 SSE 长连接从视图组件抽入 `hooks/use-task-step-log-stream`（视图零 IO，硬规则 10 / 规范 17）**：`GlobalStepLogPanel.tsx` 此前在 `.tsx` 里直接 `new EventSource(...)` 并 hand-manage 整条 SSE 生命周期（建连 / onopen / onmessage 帧解析 / 终态向 DB 要权威结论 / onerror / close），同文件别处已把网络下沉到 `~/lib/task-cancel-client`、`useCancelTask`，唯独这条流漏了。抽出后视图只消费 `{ logs, status, progress, error, validationErrors, connected }` 与 `setError` / `clear`。播种、终态对账、20s 无活动「卡住」提示随连接一并入 hook（三者都依赖连接的活动时间戳，拆开放反而要跨边界传 ref）。面板文件从 582 行降到 351 行。
