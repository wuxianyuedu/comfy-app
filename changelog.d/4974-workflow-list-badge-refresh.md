## Fixed

- **工作流列表的有效性角标随画布接线即时刷新**（#4974）：画布接线落库（`patchParamMap` / `patchWorkflowIO`）此前只失效 detail / detailFull 缓存，工作流列表查询（30s staleTime + 关闭窗口聚焦刷新）拿到的还是旧行，角标停在 ⚠️，要切走再切回才变 ✓。现在落库后同时失效 `workflow.list` 重拉，角标随新行数据即时刷新（判定口径不变）。
