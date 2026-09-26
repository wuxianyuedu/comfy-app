## Fixed

- **工作流库画布节点组件补 `React.memo`（规范 §2.11）**：`WorkflowLibraryCanvasNodes.tsx` 的 `LibraryParamsNode` / `LibraryOutputsNode` / `LibraryHostNode` / `LibraryBackdropNode` 此前为普通 `function`（项目里其它画布节点均 `React.memo`），React Flow 每次节点更新都会重渲染它们。现统一用 `React.memo` 包裹，避免无谓重渲染。
