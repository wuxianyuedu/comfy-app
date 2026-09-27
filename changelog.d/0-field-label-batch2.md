## Fixed

- **视图层 3 处 checkbox 配对的 `<label>` → `<FieldLabel>`**（P78 批次二）：
  - `workflow-library/WorkflowRunLogModal.tsx:321` 一处（自动滚动）；
  - `workflow-library/WorkflowRunRawCliModal.tsx:251` 一处（自动滚动）；
  - `project-canvas/GlobalStepLogPanel.tsx:281` 一处（自动滚动）。

  这三处是**同一族**「日志面板底部的『自动滚动』勾选行」—— 每个面板
  都手写一份 `<label><Checkbox/>自动滚动</label>`。这次一并迁到 `<FieldLabel>`
  （DOM 不变、`ui/field.tsx` 里 `FieldLabel` 内部还是 `<label>`）；
  未来若要在 FieldLabel 的 cva 变体里统一加「勾选态边框」等，这三处
  与设置页那批一起跟。

  基线 **103 → 100**（P78 累计 33 → 26）。
