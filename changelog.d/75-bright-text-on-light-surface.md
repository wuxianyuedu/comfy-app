## Fixed

- **Light 主题下「深底亮字」两头写死导致的文字消失（ISSUE #75 清单 B 类）**：一批位置的**文字色取的是亮档**（`text-rose-100/200`、`text-red-200`、`text-amber-100/200`、`text-violet-100/200`、`text-cyan-200`、`text-sky-200`…）**且没有 `dark:` 兄弟**，而底色已经随主题变浅 —— 浅色下就是白底白字/浅底浅字，内容直接看不见（不是「不好看」）。逐个补浅色档（`text-{color}-700/800` + `dark:text-{color}-100~300`）：
  - 项目画布错误面板 `project-canvas/CanvasNode/ErrorPanel.tsx`（标题、teaser、taskId/时间、请求参数与原始错误 `<pre>`、自动建议块，共 17 处）；
  - 全局步骤日志面板 `project-canvas/GlobalStepLogPanel.tsx`（强制取消按钮、工作流验证错误块、错误正文）；
  - 工作流编辑器顶栏 `workflow-editor/WorkflowEditorTopbar.tsx`（子图面包屑「当前层」徽标、返回上一级、强制重载、IO 模式计数徽章）；
  - 工作流编辑器 `WorkflowEditorInner.tsx`（IO 编辑模式提示条、子图下钻失败提示）；
  - 导入面板 `WorkflowImportPanel.tsx`（导入提示块、说明按钮 hover 态）、顶栏 tone 配置 `workflow-editor/workflow-editor-topbar-config.ts`（`ioOn` / `ioPreviewOn` 激活态）；
  - 日志面板 `logs/LogPanel.tsx`（搜索命中高亮 `mark`）；
  - 画布节点 Id 徽标链路 `canvas/IOEditContext.tsx`、`project-canvas/WorkflowPickChip.tsx` / `WorkflowModePickChip.tsx` / `WorkflowSourceFilterChip.tsx` / `CanvasToolbar.tsx` / `WorkflowModelFilterChip.tsx`；
  - `canvas/ProjectOutputs`… 侧栏错误链接（`HistoryPanel` / `MaterialLibraryPanel` / `ImageGenerationPanel`）、`WorkflowIOPreviewPanel` 空态与 tab、`DebugChainFooter` 按钮、`DynamicWorkflowForm` 上传错误出口与 `WidgetControl` 开关文案。
- 顺带清掉两处 `bg-violet-500/14.000000000000002` / `bg-violet-500/14` 之外的浮点残渣：`WorkflowModePickChip` 的选中底透明度由 `14.000000000000002` 归一到 `14`。
