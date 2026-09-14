import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { filmRepository } from "@/lib/core/repository";
import { toSizeSpec } from "@/lib/size-presets";
import { FILM_COMPOSE_SIZE } from "@/lib/film/film-size";

/** 尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数）。老口径的 "1280x720"
 *  字符串仍收 —— 由 `toSizeSpec` 归一，落库一律是尺寸表达。 */
const sizeSpecSchema = z.object({
  ratio: z.string(),
  clarity: z.string(),
  multiple: z.number().int(),
});

export const filmRouter = createTRPCRouter({
  /** GET /api/film */
  list: authedProcedure.query(async ({ ctx }) => {
    const films = await filmRepository.listByUser(ctx.user.id);
    const { isFFmpegAvailable } = await import("@/lib/film/orchestrator");
    return { films, ffmpegAvailable: await isFFmpegAvailable() };
  }),

  /** POST /api/film — create */
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const film = await filmRepository.create({
        userId: ctx.user.id,
        title: input.title,
        script: input.script,
        type: input.type,
        styleSlug: input.styleSlug,
        /* 列是文本：存尺寸表达的 JSON（读的时候由 `toSizeSpec` 兼容老字符串）。 */
        size: JSON.stringify(toSizeSpec(input.size ?? FILM_COMPOSE_SIZE)),
        fps: input.fps ?? 24,
        framesPerShot: input.framesPerShot ?? 60,
        subtitleOn: input.subtitleOn ?? true,
        bgmName: input.bgmName,
      });
      return { id: film.id };
    }),

  /** GET /api/film/[id] */
  detail: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id, {
        includeShots: true,
      });
      if (!film) throw new Error("Film not found");
      return { film };
    }),

  /** POST /api/film/[id]/cancel */
  cancel: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
      if (!film) throw new Error("Film not found");
      await filmRepository.markCancelled(input.id);
      return { ok: true };
    }),

  /** POST /api/film/[id]/start */
  start: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
      if (!film) throw new Error("Film not found");
      const { startFilm } = await import("@/lib/film/orchestrator");
      await startFilm(input.id);
      return { ok: true };
    }),

  /** POST /api/film/[id]/compose */
  compose: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const film = await filmRepository.findByIdForUser(ctx.user.id, input.id);
      if (!film) throw new Error("Film not found");
      const { composeFilm } = await import("@/lib/film/orchestrator");
      await composeFilm(input.id);
      return { ok: true };
    }),
});