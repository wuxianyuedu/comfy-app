/**
 * `series-assets.ts` — 系列级跨集资产段（FR-SR-03 / ISSUE #5215）：风格锚 / 场景 /
 * 镜头模板从 `production` 的 JSON 列实体化，按系列归属、集引用而非拷贝。
 * 与 `series-character.ts` 同形：导出**procedure 对象**，由 series.ts 展开进
 * `seriesRouter`，客户端路径仍是 `trpc.series.*`。归属断言复用 `series-shared`。
 */
import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";
import { authedProcedure } from "~/server/api/trpc";
import { uniqueConflict } from "./unique-conflict";
import { assertEpisodeOwner, assertSeriesOwner, seasonSeriesId } from "./series-shared";
import { episode, episodeAsset, season, seriesAsset, SERIES_ASSET_KINDS } from "~/server/db/schema";

const assetKindSchema = z.enum(SERIES_ASSET_KINDS);
const assetIdSchema = z.string().min(1);

/** 资产归属断言：不存在 → NOT_FOUND，存在但不归你 → FORBIDDEN（同角色库口径）。 */
async function loadAssetOwned(ctx: Parameters<typeof assertSeriesOwner>[0], id: string) {
  const rows = await ctx.db.select().from(seriesAsset).where(eq(seriesAsset.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "资产不存在" });
  }
  await assertSeriesOwner(ctx, row.seriesId);
  return row;
}

export const seriesAssetProcedures = {
  /** 系列下的资产列表（可按种类过滤）。 */
  seriesAssets: authedProcedure
    .input(z.object({ seriesId: assetIdSchema, kind: assetKindSchema.optional() }))
    .query(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.seriesId);
      const conditions = [eq(seriesAsset.seriesId, input.seriesId)];
      if (input.kind !== undefined) {
        conditions.push(eq(seriesAsset.kind, input.kind));
      }
      return ctx.db
        .select()
        .from(seriesAsset)
        .where(and(...conditions))
        .orderBy(asc(seriesAsset.name));
    }),

  /** 新建资产；同名（同一系列 + 同一种类）撞唯一索引 → 业务 409。 */
  createSeriesAsset: authedProcedure
    .input(
      z.object({
        seriesId: assetIdSchema,
        kind: assetKindSchema,
        name: z.string().min(1).max(120),
        alias: z.string().max(200).optional(),
        data: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.seriesId);
      try {
        const [row] = await ctx.db
          .insert(seriesAsset)
          .values({
            id: createId(),
            seriesId: input.seriesId,
            kind: input.kind,
            name: input.name,
            alias: input.alias ?? null,
            data: input.data ?? {},
          })
          .returning();
        return row;
      } catch (error) {
        throw uniqueConflict(error, [
          {
            columns: ["seriesAsset.seriesId", "seriesAsset.kind", "seriesAsset.name"],
            message: "同名资产已存在",
          },
        ]);
      }
    }),

  /** 更新资产；正文变化时版本号 +1（展示「改了会影响哪些集」的锚点）。 */
  updateSeriesAsset: authedProcedure
    .input(
      z.object({
        id: assetIdSchema,
        name: z.string().min(1).max(120).optional(),
        alias: z.string().max(200).nullable().optional(),
        data: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadAssetOwned(ctx, input.id);
      try {
        /* 正文变更单独一条语句：version 用 SQL 自增（并发安全），而 patch 只装
         * 强类型字段——把 SQL 塞进 `$inferInsert` 会被 tsc 判成类型不符。 */
        if (input.data !== undefined) {
          await ctx.db
            .update(seriesAsset)
            .set({ data: input.data, version: sql`${seriesAsset.version} + 1` })
            .where(eq(seriesAsset.id, input.id));
        }
        const patch: Partial<typeof seriesAsset.$inferInsert> = {};
        if (input.name !== undefined) {
          patch.name = input.name;
        }
        if (input.alias !== undefined) {
          patch.alias = input.alias;
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.update(seriesAsset).set(patch).where(eq(seriesAsset.id, input.id));
        }
      } catch (error) {
        throw uniqueConflict(error, [
          {
            columns: ["seriesAsset.seriesId", "seriesAsset.kind", "seriesAsset.name"],
            message: "同名资产已存在",
          },
        ]);
      }
      return (
        await ctx.db.select().from(seriesAsset).where(eq(seriesAsset.id, input.id)).limit(1)
      )[0];
    }),

  /** 删除资产：仍被集引用时先解引用，不静默连带删掉引用关系。 */
  deleteSeriesAsset: authedProcedure
    .input(z.object({ id: assetIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAssetOwned(ctx, input.id);
      if (asset.refCount > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `该资产仍被 ${asset.refCount} 集引用，请先解除引用`,
        });
      }
      await ctx.db.delete(seriesAsset).where(eq(seriesAsset.id, input.id));
      return { ok: true as const };
    }),

  /** 某集引用了哪些资产（含资产正文与版本，供创作时「引用而非拷贝」）。 */
  episodeAssets: authedProcedure
    .input(z.object({ episodeId: assetIdSchema }))
    .query(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.episodeId);
      return ctx.db
        .select({ asset: seriesAsset })
        .from(episodeAsset)
        .innerJoin(seriesAsset, eq(episodeAsset.assetId, seriesAsset.id))
        .where(eq(episodeAsset.episodeId, input.episodeId))
        .orderBy(asc(seriesAsset.name));
    }),

  /** 资产的反向引用：被哪些集用过（「被 N 集引用」与受影响集清单同源）。 */
  seriesAssetEpisodes: authedProcedure
    .input(z.object({ assetId: assetIdSchema }))
    .query(async ({ ctx, input }) => {
      await loadAssetOwned(ctx, input.assetId);
      return ctx.db
        .select({ episode })
        .from(episodeAsset)
        .innerJoin(episode, eq(episodeAsset.episodeId, episode.id))
        .innerJoin(season, eq(episode.seasonId, season.id))
        .where(eq(episodeAsset.assetId, input.assetId))
        .orderBy(asc(episode.episodeNumber));
    }),

  /** 集引用一个系列资产；跨系列引用直接拒绝，引用计数用 SQL 自增避免并发丢更新。 */
  linkSeriesAsset: authedProcedure
    .input(z.object({ episodeId: assetIdSchema, assetId: assetIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const ep = await assertEpisodeOwner(ctx, input.episodeId);
      const asset = await loadAssetOwned(ctx, input.assetId);
      const seriesId = await seasonSeriesId(ctx, ep.seasonId);
      if (seriesId !== asset.seriesId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该资产不属于此集所属的系列，不能跨系列引用",
        });
      }
      try {
        await ctx.db
          .insert(episodeAsset)
          .values({ id: createId(), episodeId: input.episodeId, assetId: input.assetId });
      } catch (error) {
        throw uniqueConflict(error, [
          {
            columns: ["episode_asset.episodeId", "episode_asset.assetId"],
            message: "该集已引用此资产",
          },
        ]);
      }
      await ctx.db
        .update(seriesAsset)
        .set({ refCount: sql`${seriesAsset.refCount} + 1` })
        .where(eq(seriesAsset.id, input.assetId));
      return { ok: true as const };
    }),

  /** 解除引用；计数用 SQL 钳到 0，重复调用不会减成负数。 */
  unlinkSeriesAsset: authedProcedure
    .input(z.object({ episodeId: assetIdSchema, assetId: assetIdSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.episodeId);
      await loadAssetOwned(ctx, input.assetId);
      const deleted = await ctx.db
        .delete(episodeAsset)
        .where(
          and(eq(episodeAsset.episodeId, input.episodeId), eq(episodeAsset.assetId, input.assetId)),
        )
        .returning({ id: episodeAsset.id });
      if (deleted.length > 0) {
        await ctx.db
          .update(seriesAsset)
          .set({ refCount: sql`MAX(${seriesAsset.refCount} - 1, 0)` })
          .where(eq(seriesAsset.id, input.assetId));
      }
      return { ok: true as const };
    }),
};
