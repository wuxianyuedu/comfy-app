/**
 * FR-SR 系列 / 季 / 集 / 角色库表（#2477）。
 *
 * 从 schema.ts 拆出：schema.ts 触到 900 行文件行数硬闸（规范 §12.6），按「只拆不改」
 * 把本域五张表挪到这里，schema.ts 末尾 `export * from "./schema-series"` 原样再导出，
 * 故 `~/server/db/schema` 的既有导入方与 drizzle-kit push（读 schema.ts 的导出面）均无损。
 * 本文件与 schema.ts 互相引用是刻意的 ESM 环：`series.userId → user.id` 外键经
 * `() => user.id` 惰性回调解析，模块初始化期不触碰对方绑定。
 *
 * 设计约束：本仓 `db:push` 走 `drizzle-kit push --force`（自动批准丢数据语句），
 * schema 注释因此明令「纯新增表、不动既有表」。故本文件**只新增表**，绝不改
 * `production` 的 `characters` / `shots` JSON 列 —— 那些列的抽取是破坏性迁移，
 * 单列走 `db:generate` + `db:migrate`（带回填），不在本变更内。
 *
 * 层级（FR-SR-01/02）：series → season → episode；一集 = 一次创作链路 + 一部成片。
 * 角色（FR-SR-03）：`character` 是系列级可复用实体，`episodeCharacter` 是「引用」
 * 而非「拷贝」的关联（同一角色被多集引用时只有一份真相）。`character` 字段对齐
 * `src/lib/workshop/types.ts` 的 `Character` + `characterInputSchema`，便于将来与
 * `production.characters` 工作副本做双向同步时形状一致。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { cuid, dateNotNull, user } from "./schema-common";

export const series = sqliteTable(
  "series",
  {
    coverUrl: text("coverUrl"),
    description: text("description").notNull().default(""),
    id: cuid(),
    title: text("title").notNull().default("未命名系列"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 系列风格锚：关联 `skill.slug`，系列下各集默认沿用。 */
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    styleSlug: text("styleSlug"),
    updatedAt: dateNotNull("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [index("series_user_idx").on(t.userId)],
);

export const season = sqliteTable(
  "season",
  {
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    id: cuid(),
    seasonNumber: integer("seasonNumber").notNull().default(1),
    seriesId: text("seriesId")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    updatedAt: dateNotNull("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [index("season_series_idx").on(t.seriesId)],
);

export const episode = sqliteTable(
  "episode",
  {
    id: cuid(),
    seasonId: text("seasonId")
      .notNull()
      .references(() => season.id, { onDelete: "cascade" }),
    /** 外链 `project.id`（= `production.id`）。可空以便回填存量项目；唯一：
     *  一个项目至多归属一个 episode，未归属的 episode 为 NULL（SQLite 唯一索引
     *  对 NULL 不视为相等，允许多个未归属 episode 共存）。 */
    coverUrl: text("coverUrl"),
    episodeNumber: integer("episodeNumber").notNull().default(1),
    projectId: text("projectId"),
    synopsis: text("synopsis").notNull().default(""),
    targetDurationSec: integer("targetDurationSec"),
    title: text("title").notNull().default(""),
    /** draft | producing | done。 */
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    status: text("status").notNull().default("draft"),
    updatedAt: dateNotNull("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("episode_season_idx").on(t.seasonId),
    uniqueIndex("episode_project_uniq").on(t.projectId),
  ],
);

/** 系列角色库（FR-SR-03）：字段对齐 `Character`（`src/lib/workshop/types.ts`）。 */
export const character = sqliteTable(
  "character",
  {
    ageGender: text("ageGender").notNull().default(""),
    appearance: text("appearance").notNull().default(""),
    costume: text("costume").notNull().default(""),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    id: cuid(),
    name: text("name").notNull(),
    negativePrompt: text("negativePrompt").notNull().default(""),
    params: text("params", { mode: "json" }).notNull().default("{}"),
    personality: text("personality").notNull().default(""),
    portraits: text("portraits", { mode: "json" }).notNull().default("[]"),
    portraitUrl: text("portraitUrl"),
    positivePrompt: text("positivePrompt").notNull().default(""),
    seriesId: text("seriesId")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    skillSlug: text("skillSlug"),
    styleTags: text("styleTags", { mode: "json" }).notNull().default("[]"),
    temperament: text("temperament").notNull().default(""),
    updatedAt: dateNotNull("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [index("character_series_idx").on(t.seriesId)],
);

/** 集 ↔ 角色 关联（FR-SR-03：引用而非拷贝）。 */
export const episodeCharacter = sqliteTable(
  "episode_character",
  {
    characterId: text("characterId")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    episodeId: text("episodeId")
      .notNull()
      .references(() => episode.id, { onDelete: "cascade" }),
    id: cuid(),
    /** 该角色在本集中的定位 / 备注（如「男主」「反派」）。 */
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    role: text("role").notNull().default(""),
  },
  (t) => [
    index("episode_character_episode_idx").on(t.episodeId),
    uniqueIndex("episode_character_uniq").on(t.episodeId, t.characterId),
  ],
);

export const seriesRelations = relations(series, ({ many }) => ({
  seasons: many(season),
}));
export const seasonRelations = relations(season, ({ many, one }) => ({
  episodes: many(episode),
  series: one(series, { fields: [season.seriesId], references: [series.id] }),
}));
export const episodeRelations = relations(episode, ({ many, one }) => ({
  characters: many(episodeCharacter),
  season: one(season, { fields: [episode.seasonId], references: [season.id] }),
}));
export const characterRelations = relations(character, ({ many }) => ({
  episodeLinks: many(episodeCharacter),
}));
export const episodeCharacterRelations = relations(episodeCharacter, ({ one }) => ({
  character: one(character, {
    fields: [episodeCharacter.characterId],
    references: [character.id],
  }),
  episode: one(episode, {
    fields: [episodeCharacter.episodeId],
    references: [episode.id],
  }),
}));

export type Series = InferSelectModel<typeof series>;
export type Season = InferSelectModel<typeof season>;
export type Episode = InferSelectModel<typeof episode>;
export type CharacterEntity = InferSelectModel<typeof character>;
export type EpisodeCharacter = InferSelectModel<typeof episodeCharacter>;
export type SeriesInsert = InferInsertModel<typeof series>;
export type SeasonInsert = InferInsertModel<typeof season>;
export type EpisodeInsert = InferInsertModel<typeof episode>;
export type CharacterEntityInsert = InferInsertModel<typeof character>;
export type EpisodeCharacterInsert = InferInsertModel<typeof episodeCharacter>;
