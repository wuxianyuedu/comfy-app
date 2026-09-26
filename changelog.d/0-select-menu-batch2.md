## Fixed

- **视图层 3 处原生 `<select>` 迁 `<SelectMenu>`**（P76 二批 · 累计 8 → 5）：
  - `agent-run/RunControlBar.tsx:145` 「确认粒度」—— 顺带把外层 `<label>`
    也换成 `<FieldLabel>`（P78 同族）、`textHandler` 那层 wrapper 去掉；
  - `app/(main)/settings/components/RuntimeLogBox.tsx:185` 切换启动 ——
    SelectMenu 不暴露 `title` prop（原生 `<select>` 上那个 title 是给浏览器
    hover tooltip 的、SelectMenu 的 trigger 元素自带 aria-label 播报），
    去掉 `title`、保留 `aria-label`；
  - `studio/ProjectOutputs.tsx:188` 项目下拉。

  三处 SelectMenu 的 options/labels 都是从原 `<option>` 列表派生的
  `string[]` + `Object.fromEntries(id → label)`、动态 map 与静态列表都吃。
  基线 **79 → 75**（P76 累计 11 → 5）。

## 剩余 5 处留下一批

- `FilmStudio.tsx` 2 处（视频工作流 / 图类工作流）· 每处带 `<option value="">`
  的「未选择」空态、SelectMenu 需要 placeholder 语义承载；
- `StepLogTaskPicker.tsx` 1 处 · 带「（无任务）」条件性 option + 每个 option
  还挂 title；
- `WorkflowRunLogModal.tsx` 1 处 · task map；
- `LlmLocalSection.tsx` 1 处 · 未看具体形态。

都留下批单独处理（各需要看 placeholder / aria-label 怎么映射）。
