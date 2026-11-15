## Fixed

- **按镜头活动任务统一原子去重（#4001, #4002 / #3892）**：在任务仓储内用 immediate 事务统一“检查同镜头活动任务（QUEUED/RUNNING）+ 入队”守卫，`generate.generate`、`task.retry` 与 `seriesGeneration.batchGenerateSeason` 共用该路径，避免跨入口/并发重复入队；`retry` 在镜头已有活动任务时返回冲突，整季批量保留已成功镜头跳过的断点续跑语义并补充回归用例。
