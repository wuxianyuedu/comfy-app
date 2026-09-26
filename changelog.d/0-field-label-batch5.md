## Fixed

- **视图层 5 处 `<label>` 迁 `<FieldLabel>`**（P78 五批 · 清完所有"字段行 label"）：
  - `canvas/WorkflowCanvasSettings.tsx:459` `LabeledSlider` 组件外层（block
    布局、下方 `<RangeSlider>`）；
  - `canvas/WorkflowCanvasSettings.tsx:491` `ToggleRow` 组件外层（包 `<Switch>`
    与「标签 + 提示」两栏 —— 与 `#1038` 里 `ProjectCanvasSettings.tsx:38`
    那个 ToggleRow 是**同族**，此前两处各写各的、这次一起进 `FieldLabel`）；
  - `workshop/VideoStudio.parts.tsx:94, 243, 262` 三处（帧率 / 时长 / 运动
    参数行、分别包 `<SelectMenu>` 与 `<Input type=number>`）。

  全部走 `<FieldLabel>` 基元 —— DOM 契约不变（`FieldLabel` 内部 `<Label>`
  → `<label>`、无 `htmlFor` 时靠 label-wraps-input 关联），但把「字段行 label
  的视觉」收到基元 cva 里（未来若加 `has-data-checked:*` 或 `has-[>input]:
  focus-within:*` 一类的统一变体，这五处与已迁的其它 label 一起跟）。

  基线 **94 → 89**（P78 累计 33 → 16）。
