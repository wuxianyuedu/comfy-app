## Removed

- **工作流编辑器画布不再画「对外参数卡片」（`wfParam` / `wfOutput`），映射连线改到工作流库详情的「画布节点」页签**：卡片会浮在图节点之上（`zIndex` 20，贴着宿主节点左右各排一列），把工作流图本身挡掉一片 —— 无论是否在「编辑 IO」模式都一样。现在编辑器画布只有工作流图：节点只来自 `buildInitialNodes`、连线只来自 `buildEdges`，卡片与映射线、以及连线手势（`onConnect` / `onEdgesDelete` / 连线闸门）一并从编辑器移除。
- **随之失去消费方的编辑器侧模块一并删除**：`workflow-param-nodes.ts`、`workflow-param-edges.ts`、`workflow-output-nodes.ts`、`WorkflowParamNode.tsx`、`WorkflowOutputParamNode.tsx`、`workflow-param-node-data.ts` 及其测试；节点类型注册表只剩图自身的五类（`wfNode` / `wfNote` / `wfGroup` / `wfSubgraph` / `wfIoPort`）。

## Changed

- **编辑器仍然保住已有落点映射**：它不再提供连线手势，但顶栏「恢复默认映射」与「保存时把映射并进 `paramMap`」照旧 —— 否则进编辑器点一次保存就会把在库内改过的线抹掉。卡片视觉本体 `WorkflowParamCard` 保留（库内卡片列继续用），仍与 React Flow 解耦。
