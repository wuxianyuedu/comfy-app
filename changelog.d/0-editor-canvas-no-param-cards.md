## Removed

- **工作流编辑器画布不再画「对外参数卡片」（`wfParam` / `wfOutput`），映射连线改到工作流库详情的「画布节点」页签**：卡片会浮在图节点之上（`zIndex` 20，贴着宿主节点左右各排一列），把工作流图本身挡掉一片 —— 无论是否在「编辑 IO」模式都一样。现在编辑器画布只有工作流图：节点只来自 `buildInitialNodes`、连线只来自 `buildEdges`，卡片与映射线、以及连线手势（`onConnect` / `onEdgesDelete` / 连线闸门）一并从编辑器移除。
  > 本条**取代** `[Unreleased]` 里「对外参数在画布上是可连线的节点（ISSUE #355）」一节中关于**编辑器画布**的描述，以及「工作流库的『画布节点』页签…拉线 / 断开 / 恢复默认仍在编辑器画布上做」那句反向说明 —— 落点连线现在只在库内「画布节点」页签编辑。
- **随之失去消费方的编辑器侧模块一并删除**：`workflow-param-nodes.ts`、`workflow-param-edges.ts`、`workflow-output-nodes.ts`、`WorkflowParamNode.tsx`、`WorkflowOutputParamNode.tsx`、`workflow-param-node-data.ts` 及其测试；节点类型注册表只剩图自身的五类（`wfNode` / `wfNote` / `wfGroup` / `wfSubgraph` / `wfIoPort`）。

## Changed

- **落点映射编辑面收敛到一处（工作流库「画布节点」页签）**：卡片列 + 连线层仍是可编辑的（圆点拖到宿主行即改落点，落库经 `hooks/use-param-wiring.ts` → `onPatchParamMap`）。编辑器不再提供连线手势，但保存时照旧原样带上 `paramMap` —— 在库内改过的落点不会因为「进编辑器点一次保存」被抹掉。卡片视觉本体 `WorkflowParamCard` 保留（库内卡片列继续用），仍与 React Flow 解耦。
