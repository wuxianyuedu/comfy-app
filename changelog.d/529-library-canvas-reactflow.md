## Changed

- **工作流库「画布节点」预览改用 React Flow 画布**（ISSUE #529）：左列对外参数卡片、中间宿主卡片、右列对外输出参数卡片各是一个节点，映射连线是真正的 edge、端点是真正的 `<Handle>`，「这一行收不收这个口子」收敛到 `isValidConnection` 一个纯函数（判据与自动落点同一份 `pinAcceptsEntry`）。视口（拖动平移 / 滚轮缩放 / fitView）交给 React Flow，卡片与表单的渲染结构不变；拖线没落上时的原因提示由 `onConnectEnd` 接回（不再静默）。

## Removed

- **自绘的量测型连线层与视口外框整体删除**：`WorkflowParamWires.tsx`（911 行，量 rect + 画 SVG + 文档级指针手势）、`WorkflowCanvasViewportFrame.tsx`、`workflow-library-canvas-viewport.ts`、`hooks/use-library-canvas-viewport.ts` 及 4 个几何量测型测试文件。
- **映射连线的 `data-*` 锚点契约整条退场**：`WIRE_ROW_ATTR` / `WIRE_PINS_ATTR` / `WIRE_DIRECTION_ATTR`（`workflow-io-types`）、`data-wire-anchor` / `data-wire-kind`、以及只服务量测的 `data-io-pins`。端点的身份改由 handle id（= ioKey）表达，组件不再为了「被量到」而挂属性；`data-io-key` 保留（拖拽重排与 e2e 按它认行）。
- **`GroupedControls.anchors.test.tsx`**（锚点契约的回归测试）随契约一起删除。

## Added

- **回归测试从「量测出的 path」改为「节点 / 边的 DOM 断言」**：新增 `workflow-library-wire-graph.test.ts`（边身份 / 两端 handle 取值 / 类型闸门的判决矩阵 / 三列布局，14 例）；`WorkflowCanvasNodePreview` 的两个交互测试改为断言节点、handle 与派生边。
