## Fixed

- **视图层 3 处原生 `<select>` 迁 `<SelectMenu>`**（P76 首批 · 用户口径：
  走 SelectMenu、允许视觉漂到 SelectMenu 统一观感）：
  - `studio/history/HistoryList.tsx:93` 排序方向 2 静态 option →
    `SelectMenu options={["newest","oldest"]}`；
  - `workshop/mode-contract/dialog/ModeContractEditorView.tsx:230`
    输出类别 3 静态 option（image / video / audio）→ `SelectMenu`；
  - `workshop/WorkshopModelAdapterModal.tsx:278` 输入类型（map
    `WORKSHOP_INPUT_TYPES`）→ `SelectMenu` + `options=string[]` +
    `labels=Object.fromEntries(...)` 派生。

  三处的 `textHandler` / 原生 `<select>` 手写边框色全部去掉，走
  SelectMenu 内置的统一样式（Base UI Select 派、支持富 ReactNode 标签）；
  与原生下拉的观感会漂（SelectMenu 是自定义浮层、非浏览器原生 popup），
  用户已明确允许、后续视觉走查统一处理。

  基线 **82 → 79**（P76 累计 11 → 8）。
