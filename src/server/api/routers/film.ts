import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { filmRepository } from "~/lib/core/repository";
import { FILM_COMPOSE_SIZE } from "~/lib/film/film-size";

/** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数）。老口径的 "1280x720"
 *  字符串仍收 —— 由 `toSizeSpec` 归一，落库一律是尺寸表达。 */
const sizeSpecSchema = z.object({
  ratio: z.string(),
  clarity: z.string(),
  multiple: z.number().int(),
});

export const filmRouter = createTRPCRouter({
  /* GET /api/film —— 读 */
  list: authedProcedure.query(async ({ ctx }) => {
    const films = await filmRepository.listByUser(ctx.user.id);
    const { isFFmpegAvailable } = await import("~/server/film/orchestrator");
    return { films, ffmpegAvailable: await isFFmpegAvailable() };
  }),

  /* POST /api/film —— 新建：create */
  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        script: z.string().min(1),
        type: z.string().min(1),
        styleSlug: z.string().min(1).nullable().optional(),
        size: z.union([sizeSpecSchema, z.string()]).optional(),
        fps: z.number().int().positive().optional(),
        framesPerShot: z.number().int().positive().optional(),
        subtitleOn: z.boolean().optional(),
        bgmName: z.string().nullable().optional(),
        /** 逐镜生成用的工作流库视频工作流 id（本地链路唯一来源）。 */
        videoWorkflowId: z.string().optional(),
        /** 文生视频镜头合成首帧用的图类工作流 id。 */
        imageWorkflowId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      /* 建片（含分镜）收在 orchestrator 里：分镜解析 + 逐镜 params（帧数 / 帧率 /
       * 尺寸表达 / 工作流库 id）与画幅折算只此一处，路由不再各写一份。 */
      const { createFilm } = await import("~/server/film/orchestrator");
      const { id, shots } = await createFilm({
        userId: ctx.user.id,
        title: input.title,
        script: input.script,
        type: input.type,
        styleSlug: input.styleSlug,
        size: input.size ?? FILM_COMPOSE_SIZE,
        fps: input.fps,
        framesPerShot: input.framesPerShot,
        subtitleOn: input.subtitleOn,
        bgmName: input.bgmName,
        videoWorkflowId: input.videoWorkflowId,
        imageWorkflowId: input.imageWorkflowId,
      });
      return { id, shots };
    }),

  /* POST /api/film/from-project —— 从统一项目建片（Phase 5 接入，设计 §6.3）：
   *  镜头取自该项目的 production.shots（工坊定稿），不再走「自建剧本 → LLM 平行分镜」。 */
  createFromProject: authedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        videoWorkflowId: z.string().optional(),
        imageWorkflowId: z.string().optional(),
        title: z.string().min(1).max(200).optional(),
        type: z.string().min(1).optional(),
        size: z.union([sizeSpecSchema, z.string()]).optional(),
        fps: z.number().int().positive().optional(),
        framesPerShot: z.number().int().positive().optional(),
        subtitleOn: z.boolean().optional(),
        bgmName: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { createFilmFromProject } =
        await import("~/server/film/orchestrator");
      const { id, shots } = await createFilmFromProject({
        userId: ctx.user.id,
        ...input,
      });
      return { id, shots };
    }),

  /* GET /api/film/[id] —— 读 */
  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id, {
        includeShots: true,
      });
      if (!film) throw new Error("Film not found");
      return { film };
    }),

  /* POST /api/film/[id]/cancel —— 新建 */
  cancel: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
      if (!film) throw new Error("Film not found");
      await filmRepository.markCancelled(input.id);
      return { ok: true };
    }),

  /* POST /api/film/[id]/start —— 新建 */
  start: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
      if (!film) throw new Error("Film not found");
      const { startFilm } = await import("~/server/film/orchestrator");
      await startFilm(input.id);
      return { ok: true };
    }),

  /* POST /api/film/[id]/compose —— 新建 */
  compose: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
      if (!film) throw new Error("Film not found");
      const { composeFilm } = await import("~/server/film/orchestrator");
      await composeFilm(input.id);
      return { ok: true };
    }),
});
