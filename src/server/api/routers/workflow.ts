import { createTRPCRouter } from "~/server/api/trpc";

import { workflowDetailProcedures } from "./workflow-detail";
import { workflowListProcedures } from "./workflow-list";
import { workflowMutationProcedures } from "./workflow-mutations";

/**
 * workflow 路由的组合根（原 943 行大文件按子域拆分）：
 *   · `./workflow-list`      —— list（库 + 磁盘扫描 + 待导入占位）
 *   · `./workflow-detail`    —— detail / detailFull / subgraph（只读详情）
 *   · `./workflow-mutations` —— create / update / delete / resync（写操作）
 *   · `./workflow-local-roots` —— 本地目录事实与导入安全边界（共享出处）
 * procedure 的 key 与拆分前逐字一致，客户端 `RouterOutputs` 类型不受影响。
 */
export const workflowRouter = createTRPCRouter({
  ...workflowListProcedures,
  ...workflowDetailProcedures,
  ...workflowMutationProcedures,
});
