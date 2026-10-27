import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import type * as schema from "~/server/db/schema";
import { series, season, episode } from "~/server/db/schema";

/** tRPC ctx 的子集（仅取 router 需要的 db / user）。 */
type Db = LibSQLDatabase<typeof schema>;
type Ctx = { db: Db; user: { id: string } };

/** 载入系列；不存在返回 null。 */
async function loadSeries(ctx: Ctx, id: string) {
  const rows = await ctx.db
    .select()
    .from(series)
    .where(eq(series.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** 断言当前用户拥有该系列，否则 FORBIDDEN。 */
async function assertSeriesOwner(ctx: Ctx, id: string) {
  const row = await loadSeries(ctx, id);
  if (row?.userId !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该系列" });
  }
  return row;
}

/** 断言当前用户拥有该季（沿 series 校验归属）。 */
async function assertSeasonOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db
    .select()
    .from(season)
    .where(eq(season.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "季不存在" });
  await assertSeriesOwner(ctx, row.seriesId);
  return row;
}

/** 断言当前用户拥有该集（沿 season → series 校验归属）。 */
async function assertEpisodeOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db
    .select()
    .from(episode)
    .where(eq(episode.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "集不存在" });
  await assertSeasonOwner(ctx, row.seasonId);
  return row;
}

export const seriesRouter = createTRPCRouter({
  // ───────────────────────────── 系列 (FR-SR-01) ─────────────────────────────
  list: authedProcedure.query(async ({ ctx }) =>
    ctx.db
      .select()
      .from(series)
      .where(eq(series.userId, ctx.user.id))
      .orderBy(desc(series.updatedAt)),
  ),

  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).optional(),
        coverUrl: z.string().optional(),
        styleSlug: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(series)
        .values({
          id: createId(),
          userId: ctx.user.id,
          title: input.title ?? "未命名系列",
          description: input.description ?? "",
          coverUrl: input.coverUrl ?? null,
          styleSlug: input.styleSlug ?? null,
        })
        .returning();
      return row;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).optional(),
        coverUrl: z.string().optional(),
        styleSlug: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.id);
      const patch: Partial<typeof series.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined)
        patch.description = input.description;
      if (input.coverUrl !== undefined) patch.coverUrl = input.coverUrl;
      if (input.styleSlug !== undefined) patch.styleSlug = input.styleSlug;
      await ctx.db.update(series).set(patch).where(eq(series.id, input.id));
      return (
        await ctx.db
          .select()
          .from(series)
          .where(eq(series.id, input.id))
          .limit(1)
      )[0];
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.id);
      await ctx.db.delete(series).where(eq(series.id, input.id));
      return { ok: true as const };
    }),

  // ───────────────────────────── 季 (FR-SR-02) ─────────────────────────────
  seasons: authedProcedure
    .input(z.object({ seriesId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.seriesId);
      return ctx.db
        .select()
        .from(season)
        .where(eq(season.seriesId, input.seriesId))
        .orderBy(asc(season.seasonNumber));
    }),

  createSeason: authedProcedure
    .input(
      z.object({
        seriesId: z.string().min(1),
        seasonNumber: z.number().int().positive().optional(),
        title: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.seriesId);
      const [row] = await ctx.db
        .insert(season)
        .values({
          id: createId(),
          seriesId: input.seriesId,
          seasonNumber: input.seasonNumber ?? 1,
          title: input.title ?? "",
        })
        .returning();
      return row;
    }),

  updateSeason: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        seasonNumber: z.number().int().positive().optional(),
        title: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.id);
      const patch: Partial<typeof season.$inferInsert> = {};
      if (input.seasonNumber !== undefined)
        patch.seasonNumber = input.seasonNumber;
      if (input.title !== undefined) patch.title = input.title;
      await ctx.db.update(season).set(patch).where(eq(season.id, input.id));
      return (
        await ctx.db
          .select()
          .from(season)
          .where(eq(season.id, input.id))
          .limit(1)
      )[0];
    }),

  deleteSeason: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.id);
      await ctx.db.delete(season).where(eq(season.id, input.id));
      return { ok: true as const };
    }),

  // ───────────────────────────── 集 (FR-SR-02) ─────────────────────────────
  episodes: authedProcedure
    .input(z.object({ seasonId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.seasonId);
      return ctx.db
        .select()
        .from(episode)
        .where(eq(episode.seasonId, input.seasonId))
        .orderBy(asc(episode.episodeNumber));
    }),

  createEpisode: authedProcedure
    .input(
      z.object({
        seasonId: z.string().min(1),
        projectId: z.string().nullable().optional(),
        episodeNumber: z.number().int().positive().optional(),
        title: z.string().max(120).optional(),
        synopsis: z.string().max(4000).optional(),
        targetDurationSec: z.number().int().positive().optional(),
        status: z.enum(["draft", "producing", "done"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.seasonId);
      const [row] = await ctx.db
        .insert(episode)
        .values({
          id: createId(),
          seasonId: input.seasonId,
          projectId: input.projectId ?? null,
          episodeNumber: input.episodeNumber ?? 1,
          title: input.title ?? "",
          synopsis: input.synopsis ?? "",
          targetDurationSec: input.targetDurationSec ?? null,
          status: input.status ?? "draft",
        })
        .returning();
      return row;
    }),

  updateEpisode: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        projectId: z.string().nullable().optional(),
        episodeNumber: z.number().int().positive().optional(),
        title: z.string().max(120).optional(),
        synopsis: z.string().max(4000).optional(),
        targetDurationSec: z.number().int().positive().optional(),
        status: z.enum(["draft", "producing", "done"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.id);
      const patch: Partial<typeof episode.$inferInsert> = {};
      if (input.projectId !== undefined) patch.projectId = input.projectId;
      if (input.episodeNumber !== undefined)
        patch.episodeNumber = input.episodeNumber;
      if (input.title !== undefined) patch.title = input.title;
      if (input.synopsis !== undefined) patch.synopsis = input.synopsis;
      if (input.targetDurationSec !== undefined)
        patch.targetDurationSec = input.targetDurationSec;
      if (input.status !== undefined) patch.status = input.status;
      await ctx.db.update(episode).set(patch).where(eq(episode.id, input.id));
      return (
        await ctx.db
          .select()
          .from(episode)
          .where(eq(episode.id, input.id))
          .limit(1)
      )[0];
    }),

  deleteEpisode: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.id);
      await ctx.db.delete(episode).where(eq(episode.id, input.id));
      return { ok: true as const };
    }),

  /** 按 projectId 查它归属的集（系列层级下的定位）。无归属返回 null。 */
  byProject: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [ep] = await ctx.db
        .select()
        .from(episode)
        .where(eq(episode.projectId, input.projectId))
        .limit(1);
      if (!ep) return null;
      const [se] = await ctx.db
        .select()
        .from(season)
        .where(eq(season.id, ep.seasonId))
        .limit(1);
      if (!se) return null;
      const owner = await loadSeries(ctx, se.seriesId);
      if (owner?.userId !== ctx.user.id) return null;
      return ep;
    }),

  /** 把某个 project 挂到某集（唯一：一个项目至多属一集）。 */
  assignProject: authedProcedure
    .input(
      z.object({
        episodeId: z.string().min(1),
        projectId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [ep] = await ctx.db
        .select()
        .from(episode)
        .where(eq(episode.id, input.episodeId))
        .limit(1);
      if (!ep) throw new TRPCError({ code: "NOT_FOUND", message: "集不存在" });
      await assertSeasonOwner(ctx, ep.seasonId);
      const [row] = await ctx.db
        .update(episode)
        .set({ projectId: input.projectId })
        .where(eq(episode.id, input.episodeId))
        .returning();
      return row;
    }),
});
