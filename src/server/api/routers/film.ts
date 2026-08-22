import { z } from "zod";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { filmRepository } from "@/lib/core/repository";

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
        size: z.string().optional(),
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
        size: input.size ?? "1280x720",
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