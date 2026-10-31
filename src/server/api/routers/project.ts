import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, authedProcedure, rateLimitedProcedure } from "~/server/api/trpc";
import { projectRepository, taskRepository } from "~/lib/core/repository";
import { logger } from "~/lib/core/logger";
import { asRecord } from "~/lib/is-record";

export const projectRouter = createTRPCRouter({
  /* GET /api/projects —— 读 */
  list: authedProcedure.query(async ({ ctx }) => {
    return projectRepository.listByUser(ctx.user.id);
  }),

  /* POST /api/projects —— 新建：upsert (client-generated id) */
  upsert: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        // React Flow 节点/边 JSON,形状由前端持有;仓储层入参即 unknown,收口校验由调用方保证。
        edges: z.unknown().optional(),
        nodes: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /* 归属判定（台账 A3 的同族，此前漏网）：`id` 由客户端生成并随每次画布自动
       * 保存一起送上来，而仓储的 update 分支只按 `id` 定位行 —— 于是任何人把别人
       * 的项目 id 抄进请求，就能把对方的 `name/nodes/edges` 整幅覆盖掉。
       * 与 `get` / `patch` 同口径先判归属：
       *   · 行不存在 → 建（落在我名下）；
       *   · 行存在且归我 → 覆盖（自动保存的正常路径）；
       *   · 行存在但不归我 → FORBIDDEN，一行都不改。
       * 前端这一路是「尽力而为的镜像」（localStorage 才是画布的事实源），被拒后
       * 本地不受影响，所以这里必须留一行日志——否则「我的画布为什么不进服务端
       * 列表」这类问题完全没有可查的出口（硬规则 4）。 */
      const existing = await projectRepository.findById(input.id);
      if (existing && existing.userId !== ctx.user.id) {
        logger.warn(
          `[project.upsert] 拒绝覆盖他人项目：projectId=${input.id} 归属=${existing.userId} 请求方=${ctx.user.id}`,
        );
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "该项目 id 已属于其他用户，不能覆盖",
        });
      }
      return projectRepository.upsertForUser(ctx.user.id, {
        edges: input.edges,
        id: input.id,
        name: input.name,
        nodes: input.nodes,
      });
    }),

  /* GET /api/projects/[id] —— 读 */
  get: authedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    const project = await projectRepository.findById(input.projectId);
    if (project?.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
    }
    return project;
  }),

  /* PATCH /api/projects/[id] —— 局部更新 */
  patch: authedProcedure
    .input(
      z.object({
        edges: z.unknown().optional(),
        name: z.string().optional(),
        nodes: z.unknown().optional(),
        projectId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await projectRepository.findById(input.projectId);
      if (existing?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      }
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.nodes !== undefined) {
        patch.nodes = input.nodes;
      }
      if (input.edges !== undefined) {
        patch.edges = input.edges;
      }
      return projectRepository.update(input.projectId, patch);
    }),

  /* DELETE /api/projects/[id] —— 删除 */
  delete: rateLimitedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await projectRepository.deleteForUser(ctx.user.id, input.projectId);
      return { ok: true };
    }),

  /* GET /api/projects/[id]/outputs —— 读 */
  outputs: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await projectRepository.findById(input.projectId);
      if (project?.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
      }
      const tasks = await taskRepository.findByProjectIdWithImages(input.projectId);
      const outputs = tasks.map((task) => {
        // params 是任务表的 JSON 列:非对象(标量)时所有属性读取均为 undefined,与原
        // `(task.params ?? {}) as Record<string, any>` 的读取结果一致。
        const rawParams: unknown = task.params ?? {};
        const params: Record<string, unknown> = asRecord(rawParams) ?? {};
        return {
          cfg: params.cfg ?? null,
          checkpoint: params.checkpoint ?? null,
          createdAt: task.createdAt,
          id: task.id,
          images: task.images.map((img) => ({
            height: img.height,
            id: img.id,
            isCover: img.isCover,
            localPath: img.localPath,
            mediaType: img.mediaType,
            seed: img.seed,
            width: img.width,
          })),
          negativePrompt: task.negativePrompt,
          parentId: task.parentId ?? null,
          prompt: task.prompt,
          referenceImages:
            /* SAFETY: 类型断言已复核 */ (task.referenceImages as Array<string> | null) ?? [],
          sampler: params.sampler ?? null,
          seed:
            typeof params.seed === "number" || typeof params.seed === "string"
              ? String(params.seed)
              : null,
          size: typeof params.size === "string" ? params.size : null,
          status: task.status,
          steps: params.steps ?? null,
          type: task.type,
          workflowName: task.workflowName,
        };
      });
      return { outputs };
    }),
});
