## Fixed

- **视图层 P79 六批 · 6 文件 13 处原色板就地处置**（累计 28 → 15）：

  **迁语义 token**（对齐 §3.6.2 统一状态映射 · 项目 brand 主色档）：
  - `WorkflowImportPanel.tsx` 3 处：拖入态 `border/bg-violet-*` → `border/bg-primary-*`
    · 虚线提示框 `border-violet-400/50` → `border-primary/50` · 输入框 focus
    → `border-primary/40`；
  - `GlobalStepLogPanel.tsx` 2 处：SSE 已连接点 `bg-emerald-400` →
    `bg-success` · Checkbox accent `accent-violet-500` → `accent-primary`；
  - `WorkshopStageBody.tsx` 2 处：`btn-gradient` 按钮阴影 `shadow-purple-900/20`
    → `shadow-primary/20`（brand 阴影、同族 · 视觉近似）；
  - `MetaEditor.tsx` 2 处：标签选中 `border/bg-fuchsia-*` → `border/bg-primary-*`
    · 输入框 focus `border-fuchsia-400/40` → `border-primary/40`。

  **包 `p71-allow` 就地声明例外**（§3.6.1 · workshop 域装饰色与 brand 双色渐变）：
  - `WorkflowLibraryCanvas.tsx` 2 处 amber：**`//` 形态**（`{flow.dropHint && (`
    JS 表达式位内可用）·「workshop 域 amber 装饰色 · 拖线未落定的临时提示、
    非状态色」；
  - `WorkflowCanvasNodePreview.tsx` 1 处 brand 渐变：**`//` 形态**（同位）·
    「工作流执行进度条 violet→fuchsia 双色 · 项目品牌视觉」。

  基线 **32 → 19**（P79 累计 67 → 15 · 六批覆盖 28 文件 52 处）。
