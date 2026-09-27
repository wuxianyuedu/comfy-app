## Fixed

- **视图层 10 处 `w-N h-N` 同值换 `size-N`（P80 棘轮 60 → 50，第四批）**：
  - `workshop/WorkshopAside.tsx` 2 处（缺失素材色点 `h-2.5 w-2.5`、
    资源库文件图标的容器 `h-8 w-8`）；
  - `workflow-library/WorkflowLibraryDetailView.tsx` 2 处（空态占位方块
    `h-16 w-16` 与内部 `ExternalLink` 图标 `h-7 w-7`）；
  - `workflow-form/DynamicWorkflowForm/sections/WidgetInputRow.tsx` 2 处
    （accent 圆点 `h-2 w-2 shrink-0 rounded-full`）；
  - `workflow-form/DynamicWorkflowForm/sections/IoEndpointsSection.tsx` 2 处
    （`bg-info h-1.5 w-1.5` / `bg-success h-1.5 w-1.5` 输入 / 输出指示点）；
  - `project-canvas/WorkflowModelFilterChip.tsx` 2 处（下拉项前缀圆点
    `bg-accent h-1.5 w-1.5` / `bg-accent-soft h-1.5 w-1.5`）。
  基线 **166 → 156**（P80 累计 91 → 50）。视觉 0 变化。
