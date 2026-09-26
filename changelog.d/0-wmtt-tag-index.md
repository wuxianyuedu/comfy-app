## Fixed

- **工作流标签连接表缺反向索引（`src/server/db/schema.ts`）**：
  `workflowModelTag_workflowTemplate` 只建了 `workflowTemplate` 侧的
  `wmtt_wt_idx`，按标签找它绑定的模板（`templateHasTagIdsWhere` 的 `IN` 查询）走
  连接表全扫。补上 `wmtt_tag_idx`（`workflowModelTag` 侧）。
