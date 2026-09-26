## Fixed

- **视图层 P79 七批 · 7 文件 10 处原色板就地处置**（累计 15 → 5）：
  **迁语义 token 8 处**：
  - `WorkflowLibraryList.tsx` 拖入高亮 `outline-cyan-400/60` → `outline-info/60`
    （cyan 视作 info 蓝、对齐 §3.6.2 与「cyan 系常作信息色」的惯例）；
  - `DynamicWorkflowFormView.tsx` 落点指示条 `bg-violet-400` → `bg-primary`
    （与 `#1079` 里 `WorkflowWirePortRows` 同收口口径）；
  - `WorkflowCanvasSettings.tsx` hasOverrides 小点 `bg-violet-400` → `bg-primary`；
  - `WorkflowCanvasDecorations.tsx` fps meter 边框 `border-purple-400/60` →
    `border-primary/60`（brand 主色档）；
  - `CanvasContextMenu.tsx` 测试节点 chip 描边 `border-violet-400/30` →
    `border-primary/30`（与已有 `from-primary/15 to-accent/10` 渐变同族）；
  - `WorkshopStageNav.tsx` 完成度进度点 `bg-emerald-500/80` → `bg-success/80`
    （§3.6.2 SUCCEEDED/DONE → success）；
  - `WorkflowRunLogModal.tsx` Checkbox `accent-violet-500` → `accent-primary`。

  **包 p71-allow 例外 2 处**：`WorkflowLibraryList.tsx:277` 卡片选中态
  brand 双色渐变（violet→fuchsia · 与卡片头 logo 呼应 · 单档 token 化会失去
  渐变识别度）——用 `//` 形态（数组元素位、JS 表达式上下文合法）。

  基线 **19 → 9**（P79 累计 67 → 9 · 七批覆盖 35 文件 58 处）。
