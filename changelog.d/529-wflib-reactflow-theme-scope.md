## Changed

- **工作流库画布的「类型色例外」判定口径随自绘连线层一起落户 React Flow 那张常量表**（ISSUE #529 收尾）：库画布的线描边色常量表由 `WorkflowParamWires.tsx`（已删除）搬到 `workflow-library/workflow-library-wire-graph.ts`，`scripts/check-theme-colors.cjs` 的 `EXEMPT_TABLES` 逐条豁免 `AUTO_STROKE` / `MANUAL_STROKE` / `DRAG_STROKE` / `SELECTED_STROKE`（规范 03 §3.6.1「类型色例外」：一条边画的是「这条线是什么状态」，属内容自身的颜色）。`globals.css` 的清单与规范 §3.6.1 同步改，三处同源。基线随之收紧 170 → 167。

## Fixed

- **主题色棘轮在合并 master 后不再把库画布的三处写死色值报成新增**：`WorkflowLibraryCanvas` 的网格线 `rgba(148,163,184,0.14)` 是 React Flow `<Background>` 的兜底值（与该处 `var(--color-canvas-grid-line)` 同源，取不到 token 时才生效），随库画布迁到新文件后计在 `WorkflowLibraryCanvas.tsx` 名下；连线状态色常量落 `EXEMPT_TABLES` 后不再进入未豁免计数。
