## Fixed

- **视图层 2 处原生 `<select>` 迁 `<SelectMenu>`**（P76 四批 · 累计 3 → 1）：
  - `workflow-library/WorkflowRunLogModal.tsx:248` 任务切换（runs map）
    · SelectMenu 不吃 `title` prop（原生 select 上那个是浏览器 hover
    tooltip），去掉 title、保留 aria-label；`textHandler` wrapper 一并
    去掉；
  - `project-canvas/StepLogTaskPicker.tsx:43` 步骤日志面板的任务切换 ——
    原本 `!taskId && <option value="">（无任务）</option>` 的条件空 option
    通过 SelectMenu 的 `placeholder` 承载（value 空时显示）；per-option
    `title` 语义通过 `labels` 里放 `<span title=…>` 承载（labels 支持
    ReactNode）；`onChange` 里的 `event.target.value || null` 简化为
    `v || null`。
  基线 **73 → 71**（P76 累计 3 → 1）。

## 剩余 1 处留下一批

- `LlmLocalSection.tsx:134` —— 在 `<FormField>` 的 render prop 里，
  `{...a11y}` spread 传 `id` / `aria-describedby` / `aria-invalid`
  到 `<select>`。**SelectMenu 目前不转发这些 a11y 属性**（内部是
  Base UI Select Trigger、没暴露 `id` 转发口），迁它需要先扩
  SelectMenu 的 props（把 id 与 aria-* spread 到底层 Trigger），
  属于"改基元再迁"，留下一批单独做。
