## Fixed

- comfy-cli 执行链两处 DB 写失败不再静默：`markRunning`（QUEUED→RUNNING 状态推进与 promptId 回写）失败逐条留 warn，避免行停在 QUEUED 被 reaper 误判孤儿；任务进度落库失败按任务首次失败留 warn（防刷屏）。此前 SQLite busy 等故障会让状态推进/进度无声停滞。（#4268）
