import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { workflowModelTagRepository } from "~/lib/core/repository";

export const workflowModelRouter = createTRPCRouter({
  /* GET /api/workflow-models —— 读：tag library */
  list: authedProcedure.query(async ({ ctx }) => {
    const tags = await workflowModelTagRepository.listByUser(ctx.user.id);
    return { tags };
  }),

  /* POST /api/workflow-models —— 新建：create tag (idempotent) */
  create: authedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const tag = await workflowModelTagRepository.upsertByName(
        ctx.user.id,
        input.name,
      );
      return { tag };
    }),

  /* PATCH /api/workflow-models —— 局部更新：rename tag */
  rename: authedProcedure
    .input(
      z.object({
        oldName: z.string().trim().min(1),
        newName: z.string().trim().min(1).max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.oldName === input.newName) {
        return { ok: true, renamed: false, reason: "same-name" };
      }
      const existing = await workflowModelTagRepository.findByUserAndName(
        ctx.user.id,
        input.oldName,
      );
      if (!existing)
        throw new TRPCError({ code: "NOT_FOUND", message: "标签不存在" });
      const collision = await workflowModelTagRepository.findByUserAndName(
        ctx.user.id,
        input.newName,
      );
      if (collision)
        throw new TRPCError({ code: "CONFLICT", message: "标签名已存在" });
      const tag = await workflowModelTagRepository.rename(
        existing.id,
        input.newName,
      );
      return { ok: true, renamed: true, tag };
    }),

  /* DELETE /api/workflow-models —— 删除：delete tag (idempotent) */
  delete: authedProcedure
    .input(z.object({ name: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await workflowModelTagRepository.findByUserAndName(
        ctx.user.id,
        input.name,
      );
      if (!existing) return { ok: true, deleted: false };
      await workflowModelTagRepository.deleteById(existing.id);
      return { ok: true, deleted: true };
    }),
});
