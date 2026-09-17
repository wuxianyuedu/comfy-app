## Changed

- **执行链统一走 comfy-cli：API 图不再单独 POST `/prompt`（ISSUE #632 后续）**。此前两种格式各有一条提交路径——RAW 原件交 comfy-cli（由它做权威的 UI→API 转换并展开子图），API 图走 `postPrompt` 直接 POST。两份提交实现各自维护一套**校验错误文案、日志措辞与失败出口**，同一份工作流换个格式就有不同的报错，出了问题也要分两处查。现在 `comfy run --workflow` 两种格式都吃（API 格式本就是它的默认输入，UI 格式由它自动转换），于是：① `executor-cli` 的 `executeViaComfyCli` 同时接收 `rawJson` 与 API 图两种载荷，写同一个 `temp/comfy-cli/wf-<taskId>.json`；② `executor-scheduler` 的 `/prompt` 分支与 `postPrompt` / `PromptResult` / `buildPromptError` 一并删除，提交路径只剩一条；③ **行为不变的地方**：API 载荷在提交前仍会剔除 bypass / 静音 / 纯前端节点并把断掉的连线穿透到上游（该收拾挪进新模块 `lib/comfyui/execution-graph.ts` 的 `prepareGraphForExecution`，因为 comfy-cli 对 API 格式是原样提交、不会替我们做这一步），画布上「旁路一个节点再运行」的语义与从前逐条一致。

## Removed

- **`raw.ts` 不再产出 API 图**：`fallbackRawToApi` / `buildApiGraph` / `buildLinkMap` / `indexNodes` / `applyWidgets` / `ConversionResult` / `usedObjectInfo` 全部移出并被**画布视图派生**取代（新模块 `lib/comfyui/raw-view-graph.ts` 的 `buildRawViewGraph`）。它只从 `rawJson` 派生「节点 + 连线元组 + 坐标」，**不做控件值映射、不依赖 object_info**，用途单一：让 RAW 视图画出保留 subgraph wrapper 的原始布局（含 Kahn 自动布局要用的连线）。控件值本来就不走这里（画布参数值来自 `rawInputsById` / `rawNodes[].widgets_values`）。`raw.ts` 因此从 1057 行降到约 590 行，**退出 900 行拆分候选清单**，文件头也改成如实描述（旧标题仍写着「3) 把 raw 转换为 api (用于执行 /prompt)」，是误导性文档）。

## Fixed

- **API 格式载荷补齐「画布覆盖注入」（ISSUE #632 后续）**。`buildCustomWorkflow` / `buildPromptFromGraph` 只在入库前做结构注入，而 `enqueue().overrides` 只有 RAW 路径带了 —— 与 `workflow.ts` 里「同一个数组既喂 `buildCustomWorkflow` 也喂 `enqueue().overrides`」的既有说明不符。现在 `generate` 与服务端编排的 API 分支同样下发 `overrides`，执行点新增 `raw-overrides.applyApiOverrides`（与 RAW 侧同语义、同数值收窄）：① 按名字写进 API 图的 `inputs`（不再有下标可错位）；② `control_after_generate` **不入载荷** —— 它是 ComfyUI 前端的控件概念，后端 `/prompt` 不认，因此先把它从入参摘掉，`randomize` 由这里铸一个新 seed 写给 seed 入参（与 RAW 路径在「没有哨兵槽」时的兜底一致）。数值收窄（`coerceApiInputValue`）此前在 `buildCustomWorkflow` / `buildPromptFromGraph` 各存一份，现收敛为一处。

- **外部输入边界改为 zod 校验（规范 §5.5）**。此前这些边界全靠手写 `typeof` 守卫 + `as` 盲转型，坏数据的表现是「下游某个字段读不到」而不是「输入不符合契约」。本次落地四处：① 工作流导入（`importSource`）的格式契约 —— 判据仍只由 `detectFormat` 回答，zod 只声明「据判据要落库的东西是什么形状」（RAW 用 `.loose()` 保证原件逐字落库）；② 工作流库 `workflowIO` 列 —— schema 与 `WorkflowIOEntry` 放在同一模块（`workflow-io-types.parseWorkflowIOMap`），只硬约束四个身份字段、富化字段原样保留；③ ComfyUI `/object_info` 响应 —— 只校验「顶层是类名 → 类定义对象的 map」这一层（4.7MB 深验不划算，内部字段读取点本就按形态兜底），挡住的是「上游返回 HTML 错误页被当成一份没有类的定义表」这种静默失败；④ 子图定义的连线条目与暴露口 pin（`raw.ts` 的 `SubgraphLinkSchema` / `SubgraphPinSchema`，紧邻 `RawSubgraphDef` 声明），以及画布覆盖注入里三处带 `as` 的节点/子图查找（`raw-overrides` 的 `UiNodeIdentitySchema` / `SubgraphIdentitySchema`，顺带消掉 3 个未受检转型）。**身份字段硬约束、其余字段容错读取**是这几处共同的口径：收紧 schema 会把「一个字段形态不认识」升级成「整条数据被丢掉」，而丢掉的后果是静默的（画布上少一根线 / 改了参数没反应）。
