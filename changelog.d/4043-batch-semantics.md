## Fixed

- **整季批量生成的部分成功语义按镜明细化（#4043）**：`batchGenerateSeason`
  此前只返回 `{ enqueued, skipped }`，且 `skipped` 混杂「已 SUCCEEDED 无需
  重排」与「撞进行中任务被拒」两种语义、坏镜头静默不计账（总数对不上），
  也没有单发生成同款的 `hasExecutableWorkflow` 预检（空工作流整批收下后
  逐个失败）。现在返回 `{ enqueued, skippedSucceeded, skippedActive,
  invalid }`，并在入队前整批拒绝不可执行的工作流（与 generate 同一判据）。
  接口契约与兼容审计 #3907 的 P2 项。
