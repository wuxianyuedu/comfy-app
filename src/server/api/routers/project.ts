import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { container } from "@/lib/core";
import { taskRepository } from "@/lib/core/repository";

export const projectRouter = createTRPCRouter({
  /** GET /api/projects */
  list: authedProcedure.query(async ({ ctx }) => {
    const projectRepository = container.resolve("projectRepository");
    return projectRepository.listByUser(ctx.user.id);
  }),

  /** POST /api/projects — upsert (client-generated id) */
  upsert: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        nodes: z.any().optional(),
        edges: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const projectRepository = container.resolve("projectRepository");
      return projectRepository.upsertForUser(ctx.user.id, {
        id: input.id,
        name: input.name,
        nodes: input.nodes,
        edges: input.edges,
      });
    }),

  /** GET /api/projects/[id] */
  get: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const projectRepository = container.resolve("projectRepository");
      const project = await projectRepository.findById(input.projectId);
      if (!project || project.userId !== ctx.user.id) {
        throw new Error("Project not found");
      }
      return project;
    }),

  /** PATCH /api/projects/[id] */
  patch: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().optional(),
        nodes: z.any().optional(),
        edges: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const projectRepository = container.resolve("projectRepository");
      const existing = await projectRepository.findById(input.projectId);
      if (!existing || existing.userId !== ctx.user.id) {
        throw new Error("Project not found");
      }
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.nodes !== undefined) patch.nodes = input.nodes;
      if (input.edges !== undefined) patch.edges = input.edges;
      return projectRepository.update(input.projectId, patch);
    }),

  /** DELETE /api/projects/[id] */
  delete: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const projectRepository = container.resolve("projectRepository");
      await projectRepository.deleteForUser(ctx.user.id, input.projectId);
      return { ok: true };
    }),

  /** GET /api/projects/[id]/outputs */
  outputs: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const tasks = await taskRepository.findByProjectIdWithImages(input.projectId);
      const outputs = tasks.map((t) => {
        const params = (t.params ?? {}) as Record<string, any>;
        return {
          id: t.id,
          type: t.type,
          status: t.status,
          workflowName: t.workflowName,
          prompt: t.prompt,
          negativePrompt: t.negativePrompt,
          seed:
            typeof params.seed === "number" || typeof params.seed === "string"
              ? String(params.seed)
              : null,
          size: typeof params.size === "string" ? params.size : null,
          sampler: params.sampler ?? null,
          steps: params.steps ?? null,
          cfg: params.cfg ?? null,
          checkpoint: params.checkpoint ?? null,
          referenceImages: (t.referenceImages as string[] | null) ?? [],
          createdAt: t.createdAt,
          images: t.images.map((img) => ({
            id: img.id,
            localPath: img.localPath,
            mediaType: img.mediaType,
            seed: img.seed,
            width: img.width,
            height: img.height,
            isCover: img.isCover,
          })),
        };
      });
      return { outputs };
    }),
});