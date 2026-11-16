## Fixed

- **入参校验与枚举单源小批次收口（#4049）**：`workflow.create` 的 name 两个
  分支两套规则（本地导入不截断 / 粘贴 JSON 截 80 且放行空串）→ 共用
  `resolveWorkflowName`（trim、空串回落、上限与 schema 的 200 对齐）；
  `llm.modelSave` 的模型行 `baseUrl` 补 `isHttpUrl` 校验（与供应商级 /
  configSave 级同判据，坏值不再覆盖好值）；`approvalMode` 与 episode 状态的
  枚举改为词表单源派生（`APPROVAL_MODES` / `EPISODE_STATUSES`）；project 路由
  键名统一 `projectId`（upsert 原用 `id`）、`patch.name` 补 `min(1)`；
  `model.list` 的 300 条封顶改为响应带 `total`（超限可表达「还有更多」）。
  接口契约与兼容审计 #3907 的 P3 项。
