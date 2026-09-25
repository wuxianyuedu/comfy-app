## Fixed

- **视图层 4 处 checkbox 配对的裸 `<label htmlFor="…">` 迁到 `<FieldLabel htmlFor="…">`**（P78 棘轮批次一）：
  - `ExitSection.tsx:35,57` 两处（「关闭应用时连带关闭 ComfyUI / Ollama」两个
    checkbox 的标签）；
  - `ComfyuiSection.tsx:134` 一处（「提交任务时 ComfyUI 未运行则自动启动」）；
  - `UpdateCheckSection.tsx:57` 一处（「开启运行期『本地更新需重启』检测」）。

  `<label>` 与 `<FieldLabel>` **都渲染 `<label htmlFor>`、a11y 契约不变**；
  换过来是为了让「设置页 checkbox 行的标签」这一族视觉/交互契约
  （`has-data-checked:border-primary/30` `has-data-checked:bg-primary/5`
  等 `ui/field.tsx` 里的 `FieldLabel` cva 变体）由**基元**统一持有、
  不再每处 `<label>` 自己拼类。P78 是同一族账，跨视图层与 settings 目录
  都算。

  基线 **107 → 103**（P78 累计 33 → 29；剩余分三类：a. 已有 `htmlFor` 的
  checkbox 配对，可继续机械迁 FieldLabel — 本批起手；b. 内含 `<select>`
  的表单行，需要 P76 select 迁移后再整行收 `FormField`；c. 装饰性 `<label>`，
  应走 `<h4>` 或 `<FieldLegend>`）。
