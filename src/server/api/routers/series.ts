/**
 * `series.ts` — 系列 / 季 / 集 容器层路由（FR-SR-01/02）。角色库段（FR-SR-03）拆在
 * `series-character.ts`、整季生成拆在 `series-generation.ts`（§12.6 文件行数上限的
 * 同一刀法）；归属断言与角色卡映射等两边共用的判定在 `series-shared.ts`（无环：
 * 主件与拆分件都只依赖那片叶子）。业务键唯一性口径见 §1.10 / #3849。
 */
import { z } from "zod";
import { asc, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { uniqueConflict } from "./unique-conflict";
import {
  assertEpisodeOwner,
  assertSeasonOwner,
  assertSeriesOwner,
  loadSeries,
} from "./series-shared";
import { seriesCharacterProcedures } from "./series-character";
import { seriesAssetProcedures } from "./series-assets";
import { EPISODE_STATUSES, episode, season, series } from "~/server/db/schema";

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
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.description !== undefined) {
        patch.description = input.description;
      }
      if (input.coverUrl !== undefined) {
        patch.coverUrl = input.coverUrl;
      }
      if (input.styleSlug !== undefined) {
        patch.styleSlug = input.styleSlug;
      }
      await ctx.db.update(series).set(patch).where(eq(series.id, input.id));
      return (await ctx.db.select().from(series).where(eq(series.id, input.id)).limit(1))[0];
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.id);
      await ctx.db.delete(series).where(eq(series.id, input.id));
      /* SAFETY: 类型断言已复核 */
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
      /* UI 建季不传季号：按「现有最大季号 +1」发号。此前默认恒为 1 —— 建第二个
       * 季与第一个同号（#3849 现场之一）；显式传号原样用，撞号由
       * season_series_number_uniq 兜底成 409（下方 catch），不再落重复行。 */
      const maxRow = await ctx.db
        .select({ maxNum: sql<number | null>`max(${season.seasonNumber})` })
        .from(season)
        .where(eq(season.seriesId, input.seriesId));
      const seasonNumber = input.seasonNumber ?? (maxRow[0]?.maxNum ?? 0) + 1;
      try {
        const [row] = await ctx.db
          .insert(season)
          .values({
            id: createId(),
            seriesId: input.seriesId,
            seasonNumber,
            title: input.title ?? "",
          })
          .returning();
        return row;
      } catch (error) {
        throw uniqueConflict(error, [{ columns: ["seasonNumber"], message: "该季号已存在" }]);
      }
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
      if (input.seasonNumber !== undefined) {
        patch.seasonNumber = input.seasonNumber;
      }
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      try {
        await ctx.db.update(season).set(patch).where(eq(season.id, input.id));
      } catch (error) {
        throw uniqueConflict(error, [{ columns: ["seasonNumber"], message: "该季号已存在" }]);
      }
      return (await ctx.db.select().from(season).where(eq(season.id, input.id)).limit(1))[0];
    }),

  deleteSeason: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.id);
      await ctx.db.delete(season).where(eq(season.id, input.id));
      /* SAFETY: 类型断言已复核 */
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
        status: z.enum(EPISODE_STATUSES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeasonOwner(ctx, input.seasonId);
      /* UI 建集不传集号：按「本季现有最大集号 +1」发号（此前默认恒 1，#3849）。
       * 显式传号原样用；集号 / 项目绑定撞唯一索引时按列给业务 409。 */
      const maxRow = await ctx.db
        .select({ maxNum: sql<number | null>`max(${episode.episodeNumber})` })
        .from(episode)
        .where(eq(episode.seasonId, input.seasonId));
      const episodeNumber = input.episodeNumber ?? (maxRow[0]?.maxNum ?? 0) + 1;
      try {
        const [row] = await ctx.db
          .insert(episode)
          .values({
            id: createId(),
            seasonId: input.seasonId,
            projectId: input.projectId ?? null,
            episodeNumber,
            title: input.title ?? "",
            synopsis: input.synopsis ?? "",
            targetDurationSec: input.targetDurationSec ?? null,
            status: input.status ?? "draft",
          })
          .returning();
        return row;
      } catch (error) {
        throw uniqueConflict(error, [
          { columns: ["episode.projectId"], message: "该项目已绑定到其他集" },
          { columns: ["episode.episodeNumber"], message: "该集号已存在" },
        ]);
      }
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
        status: z.enum(EPISODE_STATUSES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.id);
      const patch: Partial<typeof episode.$inferInsert> = {};
      if (input.projectId !== undefined) {
        patch.projectId = input.projectId;
      }
      if (input.episodeNumber !== undefined) {
        patch.episodeNumber = input.episodeNumber;
      }
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      if (input.synopsis !== undefined) {
        patch.synopsis = input.synopsis;
      }
      if (input.targetDurationSec !== undefined) {
        patch.targetDurationSec = input.targetDurationSec;
      }
      if (input.status !== undefined) {
        patch.status = input.status;
      }
      try {
        await ctx.db.update(episode).set(patch).where(eq(episode.id, input.id));
      } catch (error) {
        throw uniqueConflict(error, [
          { columns: ["episode.projectId"], message: "该项目已绑定到其他集" },
          { columns: ["episode.episodeNumber"], message: "该集号已存在" },
        ]);
      }
      return (await ctx.db.select().from(episode).where(eq(episode.id, input.id)).limit(1))[0];
    }),

  deleteEpisode: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.id);
      await ctx.db.delete(episode).where(eq(episode.id, input.id));
      /* SAFETY: 类型断言已复核 */
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
      if (!ep) {
        return null;
      }
      const [se] = await ctx.db.select().from(season).where(eq(season.id, ep.seasonId)).limit(1);
      if (!se) {
        return null;
      }
      const owner = await loadSeries(ctx, se.seriesId);
      if (owner?.userId !== ctx.user.id) {
        return null;
      }
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
      if (!ep) {
        throw new TRPCError({ code: "NOT_FOUND", message: "集不存在" });
      }
      await assertSeasonOwner(ctx, ep.seasonId);
      try {
        const [row] = await ctx.db
          .update(episode)
          .set({ projectId: input.projectId })
          .where(eq(episode.id, input.episodeId))
          .returning();
        return row;
      } catch (error) {
        throw uniqueConflict(error, [
          { columns: ["episode.projectId"], message: "该项目已绑定到其他集" },
        ]);
      }
    }),

  // ────────────────── 系列角色库 (FR-SR-03，拆分件见 series-character.ts) ──────────────────
  ...seriesCharacterProcedures,

  // ────────────────── 跨集资产 (FR-SR-03，拆分件见 series-assets.ts) ──────────────────
  ...seriesAssetProcedures,
});
