## Fixed

- **视图层 24 处 `w-N h-N` 同值换 `size-N`（P80 棘轮 21 → 0，第七批 · 清零）**：
  一次跨 24 个文件的机械替换、把 P80 从引入时的 91 处（经 6 批治理 + 一次
  锚点假阳修至 21 处）彻底清零。合规出口 `size-N` 是 tailwind 内建、视觉
  **完全等价**；shadcn `styling.md` 原则「Use size-* when width and height
  are equal」。

  分布：`studio/canvas/` 5 处（FlowNodePinRows / FlowNodeWidgetRows /
  SubgraphHeader / WorkflowCanvasSettings / WorkflowNode —— 端口与状态
  小点，其中三处 `!h-N !w-N` → `!size-N`，`!` important 前缀保留）；
  `studio/project-canvas/` 4 处（CanvasNodePrimitives / MaterialLibraryPanel
  / WorkflowModePickChip / WorkflowNode）；`studio/workflow-form/` 5 处
  （SectionHeader / WidgetControl / GroupedControls / WorkflowNodeParts
  / 加上 `DynamicWorkflowForm/` 两处）；`studio/workflow-editor/` 2 处；
  `studio/workflow-library/` 2 处；`studio/` 根 4 处（ModelTagManager /
  ProjectOutputs / TrainingStudio / VideoQueueModal / WorkflowIOPreviewPanel）；
  `app/` 根 2 处（error.tsx / login/page.tsx）。

## Changed

- **P80 棘轮转为硬闸**：既然视图层 `w-N h-N` 同值已清零、且合规出口
  `size-N` 是 tailwind 内建（无成本、视觉完全等价），本 PR 把 P80 从
  `RULES` 里棘轮升为硬闸（加进 `HARD_GATE_RULES` 集）。新增 `w-N h-N`
  同值对**直接阻断**、不进基线，与 P4-P35 同款。

  基线随之**从 files 里剥掉 P80 全部条目**（total 131 → 107，
  非棘轮部分保持不变）。
