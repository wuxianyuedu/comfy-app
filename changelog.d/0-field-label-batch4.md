## Fixed

- **视图层 3 处 `<label>` 迁 `<FieldLabel>`**（P78 四批）：
  - `agent-run/RunControlBar.tsx:158`（「生图后自动评审」Checkbox + 文本的
    包裹 label）；
  - `app/(main)/settings/components/ComfyuiSection.tsx:148`（`<label htmlFor>`
    与 `<Checkbox id>` 配对的独立行）；
  - `studio/ProjectCanvasSettings.tsx:38`（`ToggleRow` 组件里包 `<Switch>`
    与标签+提示文本的可点击 label）。

  形态各一（三种不同"label 承载哪种控件"的排列）、DOM 与 a11y 契约
  保持等价。基线 **97 → 94**（P78 累计 33 → 21）。
