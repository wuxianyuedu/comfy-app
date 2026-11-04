import { createTRPCRouter } from "~/server/api/trpc";

import { workflowDetailProcedures } from "./workflow-detail";
import { workflowListProcedures } from "./workflow-list";
import { workflowMutationProcedures } from "./workflow-mutations";

/**
 * workflow 路由的组合根（原 943 行按子域拆分）：`workflow-list`（库 + 磁盘扫描 + 待导入占位）、
 * `workflow-detail`（detail/detailFull/subgraph）、`workflow-mutations`（create/update/delete/resync）、
 * `workflow-local-roots`（本地目录事实与导入安全边界）。procedure key 与拆分前逐字一致，`RouterOutputs` 不变。
 */
export const workflowRouter = createTRPCRouter({
  ...workflowListProcedures,
  ...workflowDetailProcedures,
  ...workflowMutationProcedures,
});
