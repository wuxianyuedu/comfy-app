import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { workflowModelTagRepository } from "@/lib/core/repository";

export const workflowModelRouter = createTRPCRouter({
  /** GET /api/workflow-models — tag library */
  list: authedProcedure.query(async ({ ctx }) => {
    const tags = await workflowModelTagRepository.listByUser(ctx.user.id);
    return { tags };
  }),

  /** POST /api/workflow-models — create tag (idempotent) */
  create: authedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const tag = await workflowModelTagRepository.upsertByName(
        ctx.user.id,
        input.name,
      );
      return { tag };
    }),

  /** PATCH /api/workflow-models — rename tag */
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
      if (!existing) throw new Error("Tag does not exist");
      const collision = await workflowModelTagRepository.findByUserAndName(
        ctx.user.id,
        input.newName,
      );
      if (collision) throw new Error("Tag already exists");
      const tag = await workflowModelTagRepository.rename(
        existing.id,
        input.newName,
      );
      return { ok: true, renamed: true, tag };
    }),

  /** DELETE /api/workflow-models — delete tag (idempotent) */
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
