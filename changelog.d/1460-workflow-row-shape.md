## Fixed

- **工作流库的行声明与服务端返回形状对不上（`createdAt` / `source` / `paramMap` 三处），错误一直靠双跳断言抹平**（ISSUE #1460，承 #1436 第二轮）。视图侧 `WorkflowRow` 与 `workflow.list` 的 payload 是两份各自演化的声明，漂移处一律写 `as unknown as WorkflowRow[]` —— 而那句把「字段名与类型逐项对上」这项检查**也一起丢掉**：服务端改字段名不会红，只会在渲染时静默变 `undefined`（同族的 `ModelRow.createdAt` 已在上一批修掉）。
  - `createdAt` 是 **`Date`** 不是 ISO 串：`workflow.list` 走 tRPC，`transformer: superjson`，`Date` 过线保真。同一份 payload 里两个来源此前还各写一种形状（已导入行给 `Date`、本地待导入占位行给 `new Date(...).toISOString()`），现在统一。
  - `source` 的联合**缺一档**：服务端占位行发 `"local-pending"`，而声明只有 `"local" | "online"`。补档后把「三档声明 → 两档筛选」这条映射显式写在类型旁边（占位行按定义就是本地来源），否则加档时筛选条件会静默漏掉它。
  - `paramMap` 从「一层 key → string」改成**权威类型 `WorkflowParamMap`**：`source` / `output` 两个键空间按模式归拢，值 `string | null`（`null` = 作者显式断开），其余历史命名空间原样保留。此前那个 `Record<string, string>` 是一句**没有任何消费点照它执行**的话。
- 新增 `src/lib/workflow/workflow-param-map.ts`（`paramMap` 列的权威类型 + zod schema + 读边界 `parseWorkflowParamMap`）与 `src/lib/workflow/workflow-list-types.ts`（**列表行形状的唯一出处**）。三条路由入参 `workflow.list` 出口 / `workflow.update`（原 `z.unknown()`，等于无校验）/ `generate.generate`（原 `z.record(z.string(), z.string())`，表达不了嵌套）统一走同一份 schema。
- 顺带清掉同形状的另外三处：`workflow-detail` / 客户端 `WorkflowDetail` / `ReimportResult` 的 `paramMap: Record<string, string>`，以及本地待导入占位行手写的 `preview: { nodes, edges, w, h }`（字段名与 `WorkflowPreview` 的 `total` / `width` / `height` / `truncated` 对不上，改走同一个构造器）。

## Tests

- `tests/workflow-row-shape.test.ts`：①**类型层** —— `WorkflowListRow` 直接赋给 `WorkflowRow`（无断言），不兼容则本文件编译不过；②事实层 —— 三处错配不许回潮；③接线层 —— 视图 hook 落 state 时不再有任何断言，有断言即判据①被关掉。A/B 核过：把 hook 改回 `as unknown as WorkflowRow[]` → 该条红。
- `WorkflowLibraryList.test.tsx` / `WorkflowLibraryLayout.test.tsx` 的清掉双跳断言与「声明比库里窄」的注释、夹具按真实三层形状构造；`createdAt` 夹具改 `Date`。
