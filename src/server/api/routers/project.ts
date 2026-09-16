import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { projectRepository, taskRepository } from "~/lib/core/repository";

export const projectRouter = createTRPCRouter({
  /** GET /api/projects */
  list: authedProcedure.query(async ({ ctx }) => {
    return projectRepository.listByUser(ctx.user.id);
  }),

  /** POST /api/projects — upsert (client-generated id) */
  upsert: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        // React Flow 节点/边 JSON,形状由前端持有;仓储层入参即 unknown,收口校验由调用方保证。
        nodes: z.unknown().optional(),
        edges: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
      const project = await projectRepository.findById(input.projectId);
      if (project?.userId !== ctx.user.id) {
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
        nodes: z.unknown().optional(),
        edges: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await projectRepository.findById(input.projectId);
      if (existing?.userId !== ctx.user.id) {
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
      await projectRepository.deleteForUser(ctx.user.id, input.projectId);
      return { ok: true };
    }),

  /** GET /api/projects/[id]/outputs */
  outputs: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const tasks = await taskRepository.findByProjectIdWithImages(
        input.projectId,
      );
      const outputs = tasks.map((task) => {
        // params 是 Prisma Json 列:非对象(标量)时所有属性读取均为 undefined,与原
        // `(task.params ?? {}) as Record<string, any>` 的读取结果一致。
        const rawParams: unknown = task.params ?? {};
        const params: Record<string, unknown> =
          typeof rawParams === "object" && rawParams !== null
            ? (rawParams as Record<string, unknown>)
            : {};
        return {
          id: task.id,
          type: task.type,
          status: task.status,
          workflowName: task.workflowName,
          prompt: task.prompt,
          negativePrompt: task.negativePrompt,
          seed:
            typeof params.seed === "number" || typeof params.seed === "string"
              ? String(params.seed)
              : null,
          size: typeof params.size === "string" ? params.size : null,
          sampler: params.sampler ?? null,
          steps: params.steps ?? null,
          cfg: params.cfg ?? null,
          checkpoint: params.checkpoint ?? null,
          referenceImages: (task.referenceImages as string[] | null) ?? [],
          createdAt: task.createdAt,
          images: task.images.map((img) => ({
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
