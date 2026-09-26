## Fixed

- **视图层 2 处原生 `<select>` 迁 `<SelectMenu>`**（P76 三批 · 累计 5 → 3）：
  - `studio/FilmStudio.tsx:665` 「视频工作流（工作流库）」—— 原来自
    带的 `<option value="">` 空态（"选择视频工作流…" / "工作流库里还
    没有视频工作流"）迁到 SelectMenu 的 `placeholder`；
  - `studio/FilmStudio.tsx:694` 「首帧合成工作流（可选）」——
    同上，`placeholder` 承载「不需要 / 未选择」。
  `textHandler` 那层 wrapper 一并去掉（SelectMenu 的 onChange 直接接
  value、不是 event），`fullWidth` 打开让 trigger 铺满 FormField 容器。
  基线 **75 → 73**（P76 累计 5 → 3）。

## 剩余 3 处留下一批

- `LlmLocalSection.tsx:134` 在 `<FormField>` 的 render prop 里、`{...a11y}`
  spread 传 `id` / `aria-describedby` / `aria-invalid` 到 `<select>` ——
  **SelectMenu 目前没有 spread 这些 a11y 属性**（它内部是 Base UI Select
  Trigger、没直接暴露 `id` 转发口）。要迁得先扩 SelectMenu 的 API（转发
  id + aria-* 到 Trigger），这条属于"改基元再迁"、留下一批；
- `StepLogTaskPicker.tsx` 需要 placeholder + per-option title 语义（每个
  `<option>` 有自己的 `title`），SelectMenu 的 labels 支持 ReactNode
  可以承载 title 但要看是否被 trigger / item 显示；
- `WorkflowRunLogModal.tsx:248` 未看具体形态。
