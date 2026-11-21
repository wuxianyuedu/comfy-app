import { z } from "zod";
import { TRPCError } from "@trpc/server";
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
    const { isFFmpegAvailable } = await import("~/server/film/compose-film");
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
      const { createFilmFromProject } = await import("~/server/film/orchestrator");
      const { id, shots } = await createFilmFromProject({
        userId: ctx.user.id,
        ...input,
      });
      return { id, shots };
    }),

  /* GET /api/film/[id] —— 读 */
  detail: authedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const film = await filmRepository.findByIdForUser(ctx.user.id, input.id, {
      includeShots: true,
    });
    /* 按 `findByIdForUser` 取片 = 越权与不存在天然同形；但错误必须是 **NOT_FOUND**
     * 而不是裸 Error —— 后者会被 tRPC 归成 INTERNAL_SERVER_ERROR，客户端拿不到能
     * 分支的码、服务端还把一次正常点击报成故障（口径同 A2 / A3 / A12）。 */
    if (!film) {
      throw new TRPCError({ code: "NOT_FOUND", message: "成片不存在" });
    }
    return { film };
  }),

  /* POST /api/film/[id]/cancel —— 新建 */
  cancel: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
    if (!film) {
      throw new TRPCError({ code: "NOT_FOUND", message: "成片不存在" });
    }
    /* 终态幂等（ISSUE #3894）：DONE / FAILED / CANCELLED 已收尾，取消不再改写
     * 终态、按幂等处理（markCancelled 侧同批加了终态守卫，双保险）。 */
    if (film.status === "DONE" || film.status === "FAILED" || film.status === "CANCELLED") {
      return { ok: true };
    }
    await filmRepository.markCancelled(input.id);
    return { ok: true };
  }),

  /* POST /api/film/[id]/start —— 新建 */
  start: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
    if (!film) {
      throw new TRPCError({ code: "NOT_FOUND", message: "成片不存在" });
    }
    const { startFilm } = await import("~/server/film/orchestrator");
    await startFilm(input.id);
    return { ok: true };
  }),

  /* POST /api/film/[id]/compose —— 新建 */
  compose: authedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
    if (!film) {
      throw new TRPCError({ code: "NOT_FOUND", message: "成片不存在" });
    }
    /* 不可合成的状态在入口就给**可行动**的错误（ISSUE #4736）：此前一律 ok:true，
     * 而 composeFilm 里 claimComposing 抢不到就静默让位——GENERATING 期间误触发
     * 会拿「部分成片」过早 markDone 定格成 DONE，此后剩余镜头完成的自动合成被
     * DONE 挡住、再点也悄无声息，影片永久失去重合成出口。
     * 只放行 FAILED（「重新合成」是文档承诺的恢复出口，ISSUE #4251），其余状态
     * 逐个给可行动文案；COMPOSING 的并发第二次由 claimComposing 的原子守卫兜底，
     * 这里也如实告知「正在合成中」而不是冒充成功。监看循环的自动合成直调
     * composeFilm、不经过本路由，不受这道闸影响。 */
    if (film.status !== "FAILED") {
      const blockedMessage =
        {
          PARSING: "影片还在解析剧本，还没有可合成的镜头",
          GENERATING: "镜头还在生成中，等全部完成后再合成（可在成片面板看进度）",
          COMPOSING: "影片正在合成中，请等这一次完成",
          DONE: "影片已完成合成，无需重复合成",
          CANCELLED: "影片已取消，不能合成",
        }[film.status] ?? "当前状态不可合成，请等影片生成完成";
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: blockedMessage });
    }
    const { composeFilm } = await import("~/server/film/compose-film");
    await composeFilm(input.id);
    return { ok: true };
  }),
});
