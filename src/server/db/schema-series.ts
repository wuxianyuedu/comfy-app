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
  (t) => [
    index("season_series_idx").on(t.seriesId),
    // 同一系列下季号唯一（#3849）：服务端按「现有最大季号 +1」发号（UI 建季
    // 不传号），唯一索引兜住并发与显式传号撞号的路径。
    uniqueIndex("season_series_number_uniq").on(t.seriesId, t.seasonNumber),
  ],
);

/** 集状态词表（#4049）：路由的 zod 与列的取值同源，不再两处手抄。 */
export const EPISODE_STATUSES = ["draft", "producing", "done"] as const;

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
    // 同一季下集号唯一（#3849）：服务端按「现有最大集号 +1」发号（UI 建集
    // 不传号），唯一索引兜住并发与显式传号撞号的路径。
    uniqueIndex("episode_season_number_uniq").on(t.seasonId, t.episodeNumber),
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
  (t) => [
    index("character_series_idx").on(t.seriesId),
    // 同一系列下角色名唯一（#3849）：promoteFromProduction 按 name 合并 /
    // 去重，同名两行会让合并只命中其一；服务端 create / 改名路径把撞名转成
    // 业务冲突（409），这里补上库级兜底。
    uniqueIndex("character_series_name_uniq").on(t.seriesId, t.name),
  ],
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

/** 跨集资产的种类（ISSUE #5215）：风格锚 / 场景 / 镜头模板。词表与 router 的 zod 同源。 */
export const SERIES_ASSET_KINDS = ["style", "scene", "shot"] as const;

/**
 * 系列级可复用资产（ISSUE #5215 / FR-SR-03）：风格锚、场景、镜头模板从 JSON 列实体化，
 * 按系列归属、可被多集引用。`version` 在正文变更时递增，`refCount` 由集关联增删维护，
 * 两者都只是展示口径（变更提示 / 「被 N 集引用」），真值来自 `episode_asset` 关联行。
 */
export const seriesAsset = sqliteTable(
  "seriesAsset",
  {
    id: cuid(),
    seriesId: text("seriesId")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    /** 见 SERIES_ASSET_KINDS。 */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** 别名 / 变体名（同义引用，创作时用任一名字指到同一资产）。 */
    alias: text("alias"),
    /** 资产正文：风格锚配置 / 场景设定 / 镜头模板（外来 JSON，逐字段消费时校验）。 */
    data: text("data", { mode: "json" }).notNull().default("{}"),
    version: integer("version").notNull().default(1),
    refCount: integer("refCount").notNull().default(0),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("series_asset_series_idx").on(t.seriesId),
    uniqueIndex("series_asset_series_kind_name_uniq").on(t.seriesId, t.kind, t.name),
  ],
);

/** 集 ↔ 系列资产 引用（ISSUE #5215）：引用而非拷贝，删集只清关联不动资产。 */
export const episodeAsset = sqliteTable(
  "episode_asset",
  {
    id: cuid(),
    episodeId: text("episodeId")
      .notNull()
      .references(() => episode.id, { onDelete: "cascade" }),
    assetId: text("assetId")
      .notNull()
      .references(() => seriesAsset.id, { onDelete: "cascade" }),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("episode_asset_episode_idx").on(t.episodeId),
    index("episode_asset_asset_idx").on(t.assetId),
    uniqueIndex("episode_asset_uniq").on(t.episodeId, t.assetId),
  ],
);

export const seriesRelations = relations(series, ({ many }) => ({
  seasons: many(season),
  assets: many(seriesAsset),
}));
export const seasonRelations = relations(season, ({ one, many }) => ({
  series: one(series, { fields: [season.seriesId], references: [series.id] }),
  episodes: many(episode),
}));
export const episodeRelations = relations(episode, ({ one, many }) => ({
  season: one(season, { fields: [episode.seasonId], references: [season.id] }),
  characters: many(episodeCharacter),
  assets: many(episodeAsset),
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

export const seriesAssetRelations = relations(seriesAsset, ({ one, many }) => ({
  series: one(series, { fields: [seriesAsset.seriesId], references: [series.id] }),
  episodeLinks: many(episodeAsset),
}));
export const episodeAssetRelations = relations(episodeAsset, ({ one }) => ({
  episode: one(episode, { fields: [episodeAsset.episodeId], references: [episode.id] }),
  asset: one(seriesAsset, { fields: [episodeAsset.assetId], references: [seriesAsset.id] }),
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
export type SeriesAsset = InferSelectModel<typeof seriesAsset>;
export type EpisodeAsset = InferSelectModel<typeof episodeAsset>;
export type SeriesAssetInsert = InferInsertModel<typeof seriesAsset>;
export type EpisodeAssetInsert = InferInsertModel<typeof episodeAsset>;
