## Fixed

- **PR #659 与 `master` 的合并冲突按「`master` 的别名门禁优先、本分支的语义改动保真」解决**：
  冲突集中在 5 个文件，两类来源 ——
  ① import 别名：`master` 的 ISSUE #640 把全库 `@/` 统一为 `~/` 并加了门禁，本分支在旧写法上
  改动了同一批 import 区。冲突处一律取 `~/`（`src/lib/comfyui/workflow-detail-io.ts`、
  `workflow-detail.ts`、`src/components/studio/canvas/FlowNodeWidgetRows.tsx`、
  `WorkflowSubgraphNode.tsx`），并把本分支新增的 `src/lib/workflow-param-mapping-size.test.ts`
  里残留的 `@/` 一并收口（否则 R13 门禁拦下）。
  ② 语义：`master` 的 `fix(comfyui)` 多行判定改由节点类型声明驱动，与本分支的改动无重叠，
  自动合并；`workflow-detail-io.test.ts` 的两处冲突（`master` 新增的冗余 `io` 块 + 旧测试标题）
  取本分支侧 —— 本分支已把「机器名让位」整套机制删掉，`label` 直读、本层作者名只作为
  `slotLabel` 事实下发，`master` 那侧依赖的 `enrichedLabel` 已不存在。
