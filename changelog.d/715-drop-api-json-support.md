## Removed

- **工作流执行只认 ComfyUI 的原始工作流格式（工作流 / RAW / LiteGraph），API 格式（「导出(API格式)」）的支持整体下线**（ISSUE #715）。本应用不直接吃 API JSON：导入时逐字落 `rawJson` 原件，转成可执行图由 comfy-cli 在执行时按节点类定义完成（顺带展开子图）。随之清理：

  - 落库少两列：`workflowTemplate.graph`（API 图）与 `workflowTemplate.apiSource`（API 列来源标记）整列删除，`rawJson` 成为唯一的存库原件；
  - 导入链路只剩一条：`parseWorkflowContent` 只校验 `nodes[]`（缺失或为空即拒，错误文案指明「API 格式不受支持」），导入面板的「JSON 格式：自动识别 / API 格式 / 工作流格式」下拉退场，改为只读的一行说明；粘贴 / 拖入 / 本地文件三条入口走同一条校验；
  - 执行载荷恒为 `tpl.rawJson`（`hasExecutableWorkflow` 只看这一列），`generate.generate` / 工坊服务端编排 / 就地运行三条路径共用同一份判据与同一份 `enqueue` 形状；
  - 客户端派生标志从「`hasApi` / `hasRaw` / `apiSource` / `usable`」收敛为「`hasRaw` / `usable`」；「源文件」弹窗与详情页签不再有「API 原件兜底」这一态（原件只有一个出口）；
  - 顺带清掉随之失去消费方的死代码：`raw.ts` 的 `detectFormat`、`workflow.ts` 的 `buildCustomWorkflow` / `detectParamMap` / LoRA 重连、`workflow-format.ts` 的 `detectWorkflowFormat`、`execution-shape.ts` 的 `resolveExecutionPayload`、`generate` 入参的 `canvasGraph`、PATCH 的 `upgradeFromApi`，以及 `workflow-library-detail-config` 的 `isApiFallback`。

  `detail.graph` / `detail.nodes` / `rawView` 仍在，但都是**从 `rawJson` 现派生**的视图（`buildRawViewGraph`），不再是另一份可导入 / 可执行的原件。
