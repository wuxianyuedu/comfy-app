/* workflow 路由的只读详情 procedures（从 workflow.ts 拆出）。
 * detail 返回库里的原始行；detailFull / subgraph 是富化后的派生视图
 * （缓存与派生逻辑在 `~/lib/comfyui/workflow-detail`，这里只做鉴权与转发）。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { authedProcedure } from "~/server/api/trpc";
import { workflowTemplateRepository } from "~/lib/core/repository";
import {
  buildSubgraphDetail,
  buildWorkflowDetailFull,
} from "~/lib/comfyui/workflow-detail";

export const workflowDetailProcedures = {
  /* GET /api/workflows/[id] —— 读 */
  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await workflowTemplateRepository.findByIdForUser(
        ctx.user.id,
        input.id,
      );
      if (!template)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      return { template };
    }),

  /* GET /api/workflows/[id] —— 完整派生详情（从旧的 REST GET 处理器移植：
   * rawJson 重新导入、COMBO 解析、rawView、
   * positions / groups / notes / rawNodes、来源追踪、30 秒服务端缓存）。 */
  detailFull: authedProcedure
    .input(z.object({ id: z.string(), bust: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      return buildWorkflowDetailFull(ctx.user.id, input.id, {
        bust: input.bust,
      });
    }),

  /* GET /api/workflows/[id]/subgraph —— 子图的完整派生详情
   *（从旧的 REST GET 处理器移植，需要子图的 uid）。 */
  subgraph: authedProcedure
    .input(
      z.object({
        id: z.string(),
        uid: z.string(),
        /* 宿主链前缀（`4` / `4:5`）。子图内部节点在 `positions` 列里存的是
         * `宿主:内部` 拼接键，读回时按同一口径还原；缺省为空串（顶层口径 /
         * 老客户端调用）。 */
        hostId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return buildSubgraphDetail(
        ctx.user.id,
        input.id,
        input.uid,
        input.hostId ?? "",
      );
    }),
};
