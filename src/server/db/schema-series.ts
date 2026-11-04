/**
 * FR-SR 系列 / 季 / 集 / 角色库表（#2477）。schema.ts 触到 900 行硬闸（规范 §12.6）后「只拆不改」搬来，末尾
 * `export * from "./schema-series"` 原样再导出（导入方与 drizzle-kit push 均无损）。`db:push --force` 自动批准丢数据，
 * 故只新增表、绝不改 `production` 的 `characters`/`shots` 列（走 `db:generate` + `db:migrate`）；`character` 对齐 `workshop/types.ts`。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { cuid, dateNotNull, user } from "./schema-common";

export const series = sqliteTable(
  "series",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("未命名系列"),
    description: text("description").notNull().default(""),
    coverUrl: text("coverUrl"),
    /** 系列风格锚：关联 `skill.slug`，系列下各集默认沿用。 */
    styleSlug: text("styleSlug"),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
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
    id: cuid(),
    seriesId: text("seriesId")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    seasonNumber: integer("seasonNumber").notNull().default(1),
    title: text("title").notNull().default(""),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
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
    projectId: text("projectId"),
    episodeNumber: integer("episodeNumber").notNull().default(1),
    title: text("title").notNull().default(""),
    synopsis: text("synopsis").notNull().default(""),
    coverUrl: text("coverUrl"),
    targetDurationSec: integer("targetDurationSec"),
    /** draft | producing | done。 */
    status: text("status").notNull().default("draft"),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
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
    id: cuid(),
    seriesId: text("seriesId")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ageGender: text("ageGender").notNull().default(""),
    appearance: text("appearance").notNull().default(""),
    costume: text("costume").notNull().default(""),
    personality: text("personality").notNull().default(""),
    temperament: text("temperament").notNull().default(""),
    styleTags: text("styleTags", { mode: "json" }).notNull().default("[]"),
    skillSlug: text("skillSlug"),
    positivePrompt: text("positivePrompt").notNull().default(""),
    negativePrompt: text("negativePrompt").notNull().default(""),
    params: text("params", { mode: "json" }).notNull().default("{}"),
    portraitUrl: text("portraitUrl"),
    portraits: text("portraits", { mode: "json" }).notNull().default("[]"),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
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
    id: cuid(),
    episodeId: text("episodeId")
      .notNull()
      .references(() => episode.id, { onDelete: "cascade" }),
    characterId: text("characterId")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    /** 该角色在本集中的定位 / 备注（如「男主」「反派」）。 */
    role: text("role").notNull().default(""),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("episode_character_episode_idx").on(t.episodeId),
    uniqueIndex("episode_character_uniq").on(t.episodeId, t.characterId),
  ],
);

export const seriesRelations = relations(series, ({ many }) => ({
  seasons: many(season),
}));
export const seasonRelations = relations(season, ({ one, many }) => ({
  series: one(series, { fields: [season.seriesId], references: [series.id] }),
  episodes: many(episode),
}));
export const episodeRelations = relations(episode, ({ one, many }) => ({
  season: one(season, { fields: [episode.seasonId], references: [season.id] }),
  characters: many(episodeCharacter),
}));
export const characterRelations = relations(character, ({ many }) => ({
  episodeLinks: many(episodeCharacter),
}));
export const episodeCharacterRelations = relations(episodeCharacter, ({ one }) => ({
  episode: one(episode, {
    fields: [episodeCharacter.episodeId],
    references: [episode.id],
  }),
  character: one(character, {
    fields: [episodeCharacter.characterId],
    references: [character.id],
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
