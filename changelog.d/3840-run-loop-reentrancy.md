## Fixed

- **run 推进循环并发重入（#3840 / #3837）**：`advanceRunLoop` 增加按 `(userId, projectId)` 的进程内互斥，同一项目已有推进循环活跃时后续 kick 直接让位，避免 `start/resume/approve` 并发触发导致重复执行动作与状态竞态；在 `finally` 中释放并提供测试复位入口。补充回归测试验证并发 kick 不重入。
