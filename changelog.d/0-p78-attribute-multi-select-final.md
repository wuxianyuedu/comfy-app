## Fixed

- **`AttributeMultiSelect.tsx:166` 的 `<label role="option">` 改为 `<div role="option">`**
  （P78 收尾批 · 累计 1 → **0**）：
  `<label>` 元素要么关联 form 控件（`htmlFor` 或包着 `<input>`），要么是
  标签文本 —— 这里既没有 `htmlFor`、也没有包 input，实际语义是 listbox
  的一个 option（点它 toggle 选中）。P78 判据把它当"裸 label"数、但**真正
  的问题是错的 ARIA 语义**（`<label role="option">` 违反 WCAG · 屏幕
  阅读器会同时播报 "label" 与 "option"、行为不一致）。
  改成 `<div role="option">` 后：DOM 布局与点击 handler 完全不变、语义正
  确、读屏器只播报 option；外层容器加 `role="listbox"` +
  `aria-multiselectable="true"`（`role="option"` 要求 listbox 父级 · 之前
  缺）。

  基线 **2 → 1**（P78 累计 33 → 0 · **九批覆盖 25 文件 33 处全部清零**）。
