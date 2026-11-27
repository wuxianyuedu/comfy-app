## Changed

- **项目画布 workflow 节点：稳定传给 memo 子组件的回调并缓存筛选列表（ISSUE #5204）**：`CanvasNode` 此前在渲染期现造 `onFormChange` / `onModesChange` / `onSeedModeChange` / `onSelectWorkflow` 四个内联箭头回调，加上 `runGenerate` 每次新建、`saveModes` 的 `onFailed` 内联，令已 `React.memo` 的 `WorkflowNode` 浅比较必失败，画布节点每次重渲都重渲整棵 W 节点（含表单区）；`WorkflowNode` 自身的 `filteredList` 又在渲染期做两次 `.filter`，节点数 × 工作流数时是乘法开销。本次把六个回调收成 `useCallback`（会变的 `seedModes` / `wfList` / 生成函数用 ref 在 effect 中同步后读取，不进依赖），`filteredList` 改 `useMemo`（依赖 `workflowList` / `sourceFilter` / `modelFilter`）。回归用例钉住回调引用跨父重渲稳定、两种筛选组合下选项结果不变（规范 4.8 / 反模式 C7）。
