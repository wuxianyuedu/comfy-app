/**
 * `series-character.ts` — 系列角色库段（FR-SR-03）的 procedures。从 series.ts 按
 * §12.6 文件行数上限拆出（先例：series-generation.ts 的同一刀）；以**对象**而非
 * 子 router 导出、由 series.ts 展开进 `seriesRouter`，客户端的 `trpc.series.*`
 * 路径保持不变。归属断言与角色卡映射见 `./series-shared`（两边共用的叶子）。
 */
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createId } from "@paralleldrive/cuid2";
import { authedProcedure } from "~/server/api/trpc";
import { uniqueConflict } from "./unique-conflict";
import {
  assertCharacterOwner,
  assertEpisodeOwner,
  assertSeriesOwner,
  isProductionCharacterRow,
  libraryCharacterToProduction,
  productionCharacterToLibrary,
  seasonSeriesId,
  type ProductionCharacter,
} from "./series-shared";
import { character, episode, episodeCharacter, production, season } from "~/server/db/schema";

export const seriesCharacterProcedures = {
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
      try {
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
      } catch (error) {
        throw uniqueConflict(error, [{ columns: ["character.name"], message: "同名角色已存在" }]);
      }
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
      try {
        await ctx.db.update(character).set(patch).where(eq(character.id, input.id));
      } catch (error) {
        throw uniqueConflict(error, [{ columns: ["character.name"], message: "同名角色已存在" }]);
      }
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
      const prodChars = Array.isArray(prod.characters)
        ? prod.characters.filter(isProductionCharacterRow)
        : [];
      let created = 0;
      let updated = 0;
      let linked = 0;
      /* 查-改-插收进 immediate 事务（ISSUE #3833）：本方法注释承诺「同名角色
       * 只更新不新建（重复跑安全）」，但 check-then-insert 在重试/并发交叠时会
       * 插出同名重复角色（注入侧按 name 合并也只会命中其中一条）。
       * character_series_name_uniq（#3849）是库级兜底；SQLite 单写者 + immediate
       * 拿锁把整段串行化，让「重复跑安全」由机制兑现而不是靠时序运气。 */
      await ctx.db.transaction(
        async (tx) => {
          const linkedIds = new Set<string>();
          for (const pc of prodChars) {
            const name = pc?.name ?? "";
            if (!name) {
              continue;
            }
            // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
            const [existing] = await tx
              .select()
              .from(character)
              .where(and(eq(character.seriesId, epSeriesId), eq(character.name, name)))
              .limit(1);
            let charId: string;
            if (existing) {
              // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
              await tx
                .update(character)
                .set(productionCharacterToLibrary(pc))
                .where(eq(character.id, existing.id));
              updated += 1;
              charId = existing.id;
            } else {
              // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
              const [row] = await tx
                .insert(character)
                .values({
                  id: createId(),
                  seriesId: epSeriesId,
                  ...productionCharacterToLibrary(pc),
                })
                .returning();
              created += 1;
              if (!row) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "写入系列角色失败" });
              }
              charId = row.id;
            }
            if (!linkedIds.has(charId)) {
              // oxlint-disable-next-line no-await-in-loop -- 顺序依赖：后一步要用前一步的结果（既有串行路径）
              await tx
                .insert(episodeCharacter)
                .values({ id: createId(), episodeId: ep.id, characterId: charId, role: "" })
                .onConflictDoNothing();
              linkedIds.add(charId);
              linked += 1;
            }
          }
        },
        { behavior: "immediate" },
      );
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
      return ctx.db.transaction(
        async (tx) => {
          const [prod] = await tx
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
          const links = await tx
            .select({ character })
            .from(episodeCharacter)
            .innerJoin(character, eq(episodeCharacter.characterId, character.id))
            .where(eq(episodeCharacter.episodeId, ep.id));
          const prodChars = Array.isArray(prod.characters)
            ? prod.characters.filter(isProductionCharacterRow)
            : [];
          const byName = new Map<string, ProductionCharacter>();
          for (const c of prodChars) {
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
              const next = mapped as ProductionCharacter;
              prodChars.push(next);
              if (lc.name) {
                byName.set(lc.name, next);
              }
              injected += 1;
            }
          }
          const updated = await tx
            .update(production)
            .set({ characters: prodChars })
            .where(and(eq(production.id, input.projectId), eq(production.userId, ctx.user.id)))
            .returning({ id: production.id });
          if (!updated[0]) {
            throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该项目" });
          }
          return { injected, merged, total: prodChars.length };
        },
        { behavior: "immediate" },
      );
    }),
} as const;
