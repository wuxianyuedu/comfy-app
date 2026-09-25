## Fixed

- **两处 `export default React.memo(X)` 加 displayName**（`WorkflowNode.tsx`、`WorkflowNodeArdot.tsx`）：匿名 `React.memo(...)` 作为默认导出时，React DevTools 里组件树节点显示成 "Memo"，排查画布节点时看不出是哪个组件。改成先具名 `const MemoizedX = React.memo(X)`、赋 `displayName`、再默认导出（行为不变，仅 DevTools 可读性）。
- **两处虚报类型的陈旧注释改正**（`executor-finalize.ts`、`workflow-editor-build-nodes.ts`）：注释称 `runner-state.executedWorkflow` 是 `Map<string, any>`、`WorkflowDetail.graph` 是 `Record<string, any>`，但实际早已是 `Map<string, unknown>` / `Record<string, ApiWorkflowNode>`。这类「说还有 any 债」的过期注释会误导后续审计，按实改正。
