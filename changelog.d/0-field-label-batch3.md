## Fixed

- **视图层 2 处「Checkbox + 文本」的 `<label>` 迁 `<FieldLabel>`**（P78 三批 ·
  类别 a 继续机械替换）：
  - `studio/ModelLibrary.tsx:356` —— 搜索栏右侧「仅显示已启用」筛选；
  - `studio/FilmStudio.tsx:710` —— 「烧录字幕」开关（`bg-canvas/60` 边框卡片
    里的 flex 行）。

  两处都是 `<label>` 直接包 `<Checkbox>` + 文本、没有 `htmlFor`（Checkbox 也
  没 `id`），依赖 HTML5 label-wraps-input 语义。`FieldLabel` 内部还是 `<Label>`
  → `<label>`、DOM 完全一致；换过来把这族「勾选行的边框/底色 pressed 视觉」
  从**每处 className 手拼**收进基元的 cva 变体（未来 `ui/field.tsx` 里给
  `FieldLabel` 加 `has-data-checked:*` 一档，这两处与 #1030 #1032 那批一起跟）。

  基线 **99 → 97**（P78 累计 33 → 24）。
