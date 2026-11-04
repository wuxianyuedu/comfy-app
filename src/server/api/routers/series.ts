import { z } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import type * as schema from "~/server/db/schema";
import {
  series,
  season,
  episode,
  character,
  episodeCharacter,
  production,
} from "~/server/db/schema";

/** 生产数据里的角色卡（JSON 列，形状见 `src/lib/workshop/types.ts` 的 `Character`）。 */
type ProductionCharacter = {
  ageGender?: string;
  appearance?: string;
  costume?: string;
  id?: string;
  name?: string;
  negativePrompt?: string;
  params?: unknown;
  personality?: string;
  portraits?: Array<unknown>;
  portraitUrl?: string | null;
  positivePrompt?: string;
  skillSlug?: string | null;
  styleTags?: Array<unknown>;
  temperament?: string;
};

/** 把生产数据里的角色卡映射成系列角色库实体的可写字段（FR-SR-03：引用而非拷贝）。 */
function productionCharacterToLibrary(pc: ProductionCharacter): {
  ageGender: string;
  appearance: string;
  costume: string;
  name: string;
  negativePrompt: string;
  params: unknown;
  personality: string;
  portraits: Array<unknown>;
  portraitUrl: string | null;
  positivePrompt: string;
  skillSlug: string | null;
  styleTags: Array<unknown>;
  temperament: string;
} {
  return {
    name: pc.name ?? "",
    ageGender: pc.ageGender ?? "",
    appearance: pc.appearance ?? "",
    costume: pc.costume ?? "",
    personality: pc.personality ?? "",
    temperament: pc.temperament ?? "",
    styleTags: pc.styleTags ?? [],
    skillSlug: pc.skillSlug ?? null,
    positivePrompt: pc.positivePrompt ?? "",
    negativePrompt: pc.negativePrompt ?? "",
    params: pc.params ?? {},
    portraitUrl: pc.portraitUrl ?? null,
    portraits: pc.portraits ?? [],
  };
}

/** 系列角色库实体 → 生产数据角色卡（注入时落回 `production.characters`）。 */
function libraryCharacterToProduction(c: {
  ageGender: string;
  appearance: string;
  costume: string;
  id: string;
  name: string;
  negativePrompt: string;
  params: unknown;
  personality: string;
  portraits: unknown;
  portraitUrl: string | null;
  positivePrompt: string;
  skillSlug: string | null;
  styleTags: unknown;
  temperament: string;
}): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    ageGender: c.ageGender,
    appearance: c.appearance,
    costume: c.costume,
    personality: c.personality,
    temperament: c.temperament,
    styleTags: c.styleTags,
    skillSlug: c.skillSlug ?? undefined,
    portraits: c.portraits,
    portraitUrl: c.portraitUrl ?? undefined,
    params: c.params ?? {},
    positivePrompt: c.positivePrompt,
    negativePrompt: c.negativePrompt,
  };
}

/** 断言当前用户拥有该角色（沿 series 校验归属）。 */
async function assertCharacterOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(character).where(eq(character.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
  }
  await assertSeriesOwner(ctx, row.seriesId);
  return row;
}

/** 取某季归属的系列 id。 */
async function seasonSeriesId(ctx: Ctx, seasonId: string): Promise<string | null> {
  const rows = await ctx.db
    .select({ seriesId: season.seriesId })
    .from(season)
    .where(eq(season.id, seasonId))
    .limit(1);
  return rows[0]?.seriesId ?? null;
}

/** tRPC ctx 的子集（仅取 router 需要的 db / user）。 */
type Db = LibSQLDatabase<typeof schema>;
type Ctx = { db: Db; user: { id: string } };

/** 载入系列；不存在返回 null。 */
async function loadSeries(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(series).where(eq(series.id, id)).limit(1);
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
  const rows = await ctx.db.select().from(season).where(eq(season.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "季不存在" });
  }
  await assertSeriesOwner(ctx, row.seriesId);
  return row;
}

/** 断言当前用户拥有该集（沿 season → series 校验归属）。 */
async function assertEpisodeOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(episode).where(eq(episode.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "集不存在" });
  }
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
      if (input.seasonNumber !== undefined) {
        patch.seasonNumber = input.seasonNumber;
      }
      if (input.title !== undefined) {
        patch.title = input.title;
      }
      await ctx.db.update(season).set(patch).where(eq(season.id, input.id));
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
      await ctx.db.update(episode).set(patch).where(eq(episode.id, input.id));
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
      const [row] = await ctx.db
        .update(episode)
        .set({ projectId: input.projectId })
        .where(eq(episode.id, input.episodeId))
        .returning();
      return row;
    }),

  // ───────────────────────────── 系列角色库 (FR-SR-03) ─────────────────────────────
  /** 列出某系列下的全部角色库实体（引用而非拷贝，跨集复用）。 */
  characters: authedProcedure
    .input(z.object({ seriesId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.seriesId);
      return ctx.db
        .select()
        .from(character)
        .where(eq(character.seriesId, input.seriesId))
        .orderBy(asc(character.name));
    }),

  createCharacter: authedProcedure
    .input(
      z.object({
        seriesId: z.string().min(1),
        name: z.string().min(1).max(120),
        ageGender: z.string().max(200).optional(),
        appearance: z.string().max(4000).optional(),
        costume: z.string().max(4000).optional(),
        personality: z.string().max(4000).optional(),
        temperament: z.string().max(2000).optional(),
        styleTags: z.array(z.string()).optional(),
        skillSlug: z.string().optional(),
        positivePrompt: z.string().max(8000).optional(),
        negativePrompt: z.string().max(8000).optional(),
        params: z.unknown().optional(),
        portraitUrl: z.string().optional(),
        portraits: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSeriesOwner(ctx, input.seriesId);
      const [row] = await ctx.db
        .insert(character)
        .values({
          id: createId(),
          seriesId: input.seriesId,
          name: input.name,
          ageGender: input.ageGender ?? "",
          appearance: input.appearance ?? "",
          costume: input.costume ?? "",
          personality: input.personality ?? "",
          temperament: input.temperament ?? "",
          styleTags: input.styleTags ?? [],
          skillSlug: input.skillSlug ?? null,
          positivePrompt: input.positivePrompt ?? "",
          negativePrompt: input.negativePrompt ?? "",
          params: input.params ?? {},
          portraitUrl: input.portraitUrl ?? null,
          portraits: input.portraits ?? [],
        })
        .returning();
      return row;
    }),

  updateCharacter: authedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(120).optional(),
        ageGender: z.string().max(200).optional(),
        appearance: z.string().max(4000).optional(),
        costume: z.string().max(4000).optional(),
        personality: z.string().max(4000).optional(),
        temperament: z.string().max(2000).optional(),
        styleTags: z.array(z.string()).optional(),
        skillSlug: z.string().optional(),
        positivePrompt: z.string().max(8000).optional(),
        negativePrompt: z.string().max(8000).optional(),
        params: z.unknown().optional(),
        portraitUrl: z.string().optional(),
        portraits: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCharacterOwner(ctx, input.id);
      const patch: Partial<typeof character.$inferInsert> = {};
      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.ageGender !== undefined) {
        patch.ageGender = input.ageGender;
      }
      if (input.appearance !== undefined) {
        patch.appearance = input.appearance;
      }
      if (input.costume !== undefined) {
        patch.costume = input.costume;
      }
      if (input.personality !== undefined) {
        patch.personality = input.personality;
      }
      if (input.temperament !== undefined) {
        patch.temperament = input.temperament;
      }
      if (input.styleTags !== undefined) {
        patch.styleTags = input.styleTags;
      }
      if (input.skillSlug !== undefined) {
        patch.skillSlug = input.skillSlug ?? null;
      }
      if (input.positivePrompt !== undefined) {
        patch.positivePrompt = input.positivePrompt;
      }
      if (input.negativePrompt !== undefined) {
        patch.negativePrompt = input.negativePrompt;
      }
      if (input.params !== undefined) {
        patch.params = input.params;
      }
      if (input.portraitUrl !== undefined) {
        patch.portraitUrl = input.portraitUrl ?? null;
      }
      if (input.portraits !== undefined) {
        patch.portraits = input.portraits;
      }
      await ctx.db.update(character).set(patch).where(eq(character.id, input.id));
      return (await ctx.db.select().from(character).where(eq(character.id, input.id)).limit(1))[0];
    }),

  deleteCharacter: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertCharacterOwner(ctx, input.id);
      await ctx.db.delete(character).where(eq(character.id, input.id));
      /* SAFETY: 类型断言已复核 */
      return { ok: true as const };
    }),

  /** 列出某集已关联的角色（含在本集中的定位 role）。 */
  episodeCharacters: authedProcedure
    .input(z.object({ episodeId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.episodeId);
      return ctx.db
        .select({ character, role: episodeCharacter.role })
        .from(episodeCharacter)
        .innerJoin(character, eq(episodeCharacter.characterId, character.id))
        .where(eq(episodeCharacter.episodeId, input.episodeId))
        .orderBy(asc(character.name));
    }),

  /**
   * 反向查询：列出「这个角色被哪些集引用了」（FR-SR-03 ②）。
   * 与 `episodeCharacters`（正向：某集关联了哪些角色）互为反向；调用方可取
   * `.length` 作为「被 N 集引用」的计数（FR-SR-03 ① 的提示来源）。
   */
  characterEpisodes: authedProcedure
    .input(z.object({ characterId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertCharacterOwner(ctx, input.characterId);
      return ctx.db
        .select({
          episodeId: episode.id,
          title: episode.title,
          episodeNumber: episode.episodeNumber,
          seasonId: season.id,
          seasonNumber: season.seasonNumber,
          seasonTitle: season.title,
          role: episodeCharacter.role,
        })
        .from(episodeCharacter)
        .innerJoin(episode, eq(episodeCharacter.episodeId, episode.id))
        .innerJoin(season, eq(episode.seasonId, season.id))
        .where(eq(episodeCharacter.characterId, input.characterId))
        .orderBy(asc(season.seasonNumber), asc(episode.episodeNumber));
    }),

  /** 把系列角色库里的某角色关联到某集（同一系列才可；重复关联幂等）。 */
  linkCharacter: authedProcedure
    .input(
      z.object({
        episodeId: z.string().min(1),
        characterId: z.string().min(1),
        role: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ep = await assertEpisodeOwner(ctx, input.episodeId);
      const ch = await assertCharacterOwner(ctx, input.characterId);
      const epSeriesId = await seasonSeriesId(ctx, ep.seasonId);
      if (ch.seriesId !== epSeriesId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该角色不属于本系列，无法关联到本集",
        });
      }
      await ctx.db
        .insert(episodeCharacter)
        .values({
          id: createId(),
          episodeId: input.episodeId,
          characterId: input.characterId,
          role: input.role ?? "",
        })
        .onConflictDoNothing();
      return (
        await ctx.db
          .select()
          .from(episodeCharacter)
          .where(
            and(
              eq(episodeCharacter.episodeId, input.episodeId),
              eq(episodeCharacter.characterId, input.characterId),
            ),
          )
          .limit(1)
      )[0];
    }),

  /** 解除某集与某角色的关联。 */
  unlinkCharacter: authedProcedure
    .input(
      z.object({
        episodeId: z.string().min(1),
        characterId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertEpisodeOwner(ctx, input.episodeId);
      await assertCharacterOwner(ctx, input.characterId);
      await ctx.db
        .delete(episodeCharacter)
        .where(
          and(
            eq(episodeCharacter.episodeId, input.episodeId),
            eq(episodeCharacter.characterId, input.characterId),
          ),
        );
      /* SAFETY: 类型断言已复核 */
      return { ok: true as const };
    }),

  /**
   * 提升（production → 系列角色库）：把某项目（`production.characters` 工作副本）
   * 按 name 幂等合并进本集所属系列的角色库，并把结果关联到本集。
   * 同名角色只更新不新建（重复跑安全）；新增的才建实体。
   */
  promoteFromProduction: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [ep] = await ctx.db
        .select()
        .from(episode)
        .where(eq(episode.projectId, input.projectId))
        .limit(1);
      if (!ep) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目尚未挂载到任何集" });
      }
      await assertEpisodeOwner(ctx, ep.id);
      const [prod] = await ctx.db
        .select()
        .from(production)
        .where(eq(production.id, input.projectId))
        .limit(1);
      if (!prod) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生产数据不存在" });
      }
      if (prod.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该项目" });
      }
      const epSeriesId = await seasonSeriesId(ctx, ep.seasonId);
      if (epSeriesId === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "季未归属任何系列" });
      }
      /* SAFETY: 类型断言已复核 */
      const prodChars = (
        Array.isArray(prod.characters) ? prod.characters : []
      ) as Array<ProductionCharacter>;
      let created = 0;
      let updated = 0;
      let linked = 0;
      const linkedIds = new Set<string>();
      for (const pc of prodChars) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- prodChars 是 `prod.characters as Array<ProductionCharacter>`，JSON 列元素运行期可为 null，`?.` 是防线
        const name = pc?.name ?? "";
        if (!name) {
          continue;
        }
        const [existing] = await ctx.db
          .select()
          .from(character)
          .where(and(eq(character.seriesId, epSeriesId), eq(character.name, name)))
          .limit(1);
        let charId: string;
        if (existing) {
          await ctx.db
            .update(character)
            .set(productionCharacterToLibrary(pc))
            .where(eq(character.id, existing.id));
          updated += 1;
          charId = existing.id;
        } else {
          const [row] = await ctx.db
            .insert(character)
            .values({ id: createId(), seriesId: epSeriesId, ...productionCharacterToLibrary(pc) })
            .returning();
          created += 1;
          if (!row) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "写入系列角色失败" });
          }
          charId = row.id;
        }
        if (!linkedIds.has(charId)) {
          await ctx.db
            .insert(episodeCharacter)
            .values({ id: createId(), episodeId: ep.id, characterId: charId, role: "" })
            .onConflictDoNothing();
          linkedIds.add(charId);
          linked += 1;
        }
      }
      return { created, updated, linked };
    }),

  /**
   * 注入（系列角色库 → production）：把本集已关联的角色按 name 合并进项目的
   * `production.characters` 工作副本（同名覆盖字段，不同名追加）。重复跑安全。
   */
  injectToProduction: authedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [ep] = await ctx.db
        .select()
        .from(episode)
        .where(eq(episode.projectId, input.projectId))
        .limit(1);
      if (!ep) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目尚未挂载到任何集" });
      }
      await assertEpisodeOwner(ctx, ep.id);
      const [prod] = await ctx.db
        .select()
        .from(production)
        .where(eq(production.id, input.projectId))
        .limit(1);
      if (!prod) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生产数据不存在" });
      }
      if (prod.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该项目" });
      }
      const links = await ctx.db
        .select({ character })
        .from(episodeCharacter)
        .innerJoin(character, eq(episodeCharacter.characterId, character.id))
        .where(eq(episodeCharacter.episodeId, ep.id));
      /* SAFETY: 类型断言已复核 */
      const prodChars = (Array.isArray(prod.characters) ? prod.characters : []) as Array<
        Record<string, unknown>
      >;
      const byName = new Map<string, Record<string, unknown>>();
      for (const c of prodChars) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- prodChars 是 JSON 列经 `as Array<Record<string, unknown>>`，元素运行期可为 null
        const n = typeof c?.name === "string" ? c.name : "";
        if (n) {
          byName.set(n, c);
        }
      }
      let injected = 0;
      let merged = 0;
      for (const link of links) {
        const lc = link.character;
        const mapped = libraryCharacterToProduction(lc);
        const existing = byName.get(lc.name);
        if (existing) {
          Object.assign(existing, mapped);
          merged += 1;
        } else {
          prodChars.push(mapped);
          injected += 1;
        }
      }
      await ctx.db
        .update(production)
        .set({ characters: prodChars })
        .where(eq(production.id, input.projectId));
      return { injected, merged, total: prodChars.length };
    }),
});
