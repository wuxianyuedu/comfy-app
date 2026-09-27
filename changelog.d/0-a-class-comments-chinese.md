## Fixed

- **三处整句英文注释中文化（硬规则 23 / §12.4.6）**：`ui/command.tsx`（`<Command>` 包裹层为何必需的说明）、`studio/TopBar.tsx`（base-ui `DropdownMenuLabel` 必须包在 `DropdownMenuGroup` 里的告警）、`workflow-library/WorkflowRunRawCliModal.tsx`（文件头 JSDoc，顺带修掉机翻粘连的空格缺失）。组件名、引号内报错原文（`Cannot read properties of undefined (reading 'subscribe')`、`MenuGroupContext is missing`）、路径 `/api/tasks/[id]/raw-cli` 等技术 token 按规范保留英文。
