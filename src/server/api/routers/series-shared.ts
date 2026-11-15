/**
 * `series-shared.ts` — 系列路由族（series.ts / series-character.ts / series-generation.ts）
 * 共用的 ctx 形状、归属断言与「生产角色卡 ⇄ 角色库实体」的映射。
 *
 * 独立成无 router 的叶子：series.ts 按 §12.6 文件行数上限把角色库段拆到
 * series-character.ts 时，归属断言与映射函数是两边的公共依赖 —— 放在 series.ts
 * 里会让拆分件反向 import 主件、构成环（§12.7）。这里只放「两边都要用」的判定，
 * 不放任何 procedure。
 */
import { eq } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { TRPCError } from "@trpc/server";
import { isPlainRecord } from "~/lib/is-record";
import type * as schema from "~/server/db/schema";
import { character, episode, season, series } from "~/server/db/schema";

/** tRPC ctx 的子集（仅取 router 需要的 db / user）。 */
type Db = SqliteRemoteDatabase<typeof schema>;
export type Ctx = { db: Db; user: { id: string } };

/** 生产数据里的角色卡（JSON 列，形状见 `src/lib/workshop/types.ts` 的 `Character`）。 */
export type ProductionCharacter = {
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

/** `production.characters` 列的运行期判据：条目是对象（引擎写入端保证字段形状，
 *  消费侧字段读取全部 `?? ""` 兜底）；非对象条目跳过，不再对 any[] 盲断言。 */
export function isProductionCharacterRow(v: unknown): v is ProductionCharacter {
  return isPlainRecord(v);
}

/** 把生产数据里的角色卡映射成系列角色库实体的可写字段（FR-SR-03：引用而非拷贝）。 */
export function productionCharacterToLibrary(pc: ProductionCharacter): {
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
export function libraryCharacterToProduction(c: {
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

/** 载入系列；不存在返回 null。 */
export async function loadSeries(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(series).where(eq(series.id, id)).limit(1);
  return rows[0] ?? null;
}

/** 断言当前用户拥有该系列，否则 FORBIDDEN。 */
export async function assertSeriesOwner(ctx: Ctx, id: string) {
  const row = await loadSeries(ctx, id);
  if (row?.userId !== ctx.user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该系列" });
  }
  return row;
}

/** 取某季归属的系列 id。 */
export async function seasonSeriesId(ctx: Ctx, seasonId: string): Promise<string | null> {
  const rows = await ctx.db
    .select({ seriesId: season.seriesId })
    .from(season)
    .where(eq(season.id, seasonId))
    .limit(1);
  return rows[0]?.seriesId ?? null;
}

/** 断言当前用户拥有该季（沿 series 校验归属）。 */
export async function assertSeasonOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(season).where(eq(season.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "季不存在" });
  }
  await assertSeriesOwner(ctx, row.seriesId);
  return row;
}

/** 断言当前用户拥有该集（沿 season → series 校验归属）。 */
export async function assertEpisodeOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(episode).where(eq(episode.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "集不存在" });
  }
  await assertSeasonOwner(ctx, row.seasonId);
  return row;
}

/** 断言当前用户拥有该角色（沿 series 校验归属）。 */
export async function assertCharacterOwner(ctx: Ctx, id: string) {
  const rows = await ctx.db.select().from(character).where(eq(character.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "角色不存在" });
  }
  await assertSeriesOwner(ctx, row.seriesId);
  return row;
}
