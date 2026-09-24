## Added

- **工作流库列表 / 详情改为可拖动分栏（Phase 8 · 界面完善）**：此前工作流库的列表列固定 `w-80`、详情列吃剩余宽度，
  用户完全无法调整宽度。改用官方 `ui/resizable`（react-resizable-panels）的 `ResizablePanelGroup` 横向分栏：
  列表列 `defaultSize=24% / minSize=16% / maxSize=45%`，中间 `ResizableHandle` 可拖，详情列 `minSize=40%`。
  列表根从 `w-80 shrink-0` 改为 `w-full min-w-0`（宽度交给分栏面板控制），详情容器保留 `min-w-0` 防溢出。
