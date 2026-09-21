## Fixed

- **历史「工坊参数」按模式契约完整显示，不再只露一条**：任务详情的「工坊参数」此前用一份硬编码键名清单（prompt/negative/firstFrame/lastFrame/frames），只挑「真的落到 params 顶层」的那几项显示。结果 T2I 明明配了三个对外口（提示词 / 尺寸 / 负向提示词），弹窗里却只显示「正向提示词」一条——因为「尺寸」根本没有单一顶层值（工坊的尺寸被拆进 workflowInputs 的具体 pin），而负向提示词为空时又被整条跳过。现改为**按该任务模式的生效契约动态枚举**（`modeContractEntries(mode, contracts)`，与工坊封装页、工作流库画布卡片同一份口径）：配了几个口就显示几行，值按「顶层 params（含 first-frame↔firstFrame、duration↔frames 等别名）→ 尺寸口从 workflowInputs 聚合 → 同名 pin 兜底」解析；本次没给值的口显示「未提供」占位，不再静默消失。
