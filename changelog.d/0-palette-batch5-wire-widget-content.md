## Fixed

- **视图层 P79 五批 · 3 文件 9 处原色板走语义 token**（累计 37 → 28）：
  - `WorkflowWirePortRows.tsx` 三处相同的 brand 落点指示条
    `bg-violet-400 shadow-[0_0_8px_rgba(124,92,252,0.6)]` →
    `bg-primary shadow-[…]`（brand violet 与 `--color-primary` 同族 · 视觉近似 ·
    shadow 里的 rgba 是具体硬编码值、不影响 P79 判据）；
  - `DynamicWorkflowForm/sections/WidgetControl.tsx` 三处 missingRequired 校验
    态红（`ring-red-400/50` × 2、`border-red-400/50` × 1）→
    `ring-destructive/50` / `border-destructive/50`（校验错误态 · 语义对应
    `--color-destructive`、对齐 §3.6.2 统一状态映射 FAILED→destructive）；
  - `project-canvas/ContentAssetNode.tsx` 四处 brand violet →
    primary（Textarea focus border 一档、active drop-target 描边与底色一档、
    chip 数量徽标 hover 一档、画廊选中项 border 一档）。

  基线 **41 → 32**（P79 累计 67 → 28 · 五批治理覆盖 22 文件 39 处）。
