## Fixed

- `fetchWorkshopWorkflows()` 兼容 `workflow.list` 的两种返回形状（早期裸数组 / 现行 `{ workflows, localPending, localRoots }` 对象）并取 `workflows` 数组——修工坊「生成资源」下拉与测试模型页工作流候选因形状演进恒为空的问题（#4119）
