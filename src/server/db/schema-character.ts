/**
 * 角色库表（ISSUE #5009）：跨项目沉淀的二次元角色档案，供动漫制作选角时检索与复用。
 *
 * 与系列角色库 `character` 表（schema-series.ts，FR-SR-03）的分工：那张表挂在
 * `series` 下、服务「某一部的角色设定」；本表是**全局池**——不挂项目 / 系列，
 * 每个角色带详细描述与从描述自动提取的特征标签，供按标签跨作品选角。
 *
 * - `tags`：从 `description` 提取的特征标签（发色 / 发型 / 瞳色 / 服饰 / 种族 /
 *   性格 / 原型等维度），提取口径唯一出处是 `~/lib/character/tag-extract`；
 *   描述更新时由路由层同步重提，这里只存结果。
 * - `portraitUrl` / `portraits`：角色立绘。产物从任务结果**复制**进角色库自有
 *   目录（`generated/character-library/<id>/`，与任务生命周期解耦，同资产库口径）。
 * - `status`：`draft`（待生成）| `generating`（生图中）| `ready`（已有立绘）|
 *   `failed`（最近一次生成失败）。`taskId` 是最近一次生图任务，用于对账回写。
 * - `source`：`seed`（预置生成器批量入库）| `manual`（手工创建）。
 */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations, type InferInsertModel, type InferSelectModel } from "drizzle-orm";
import { cuid, dateNotNull, user } from "./schema-common";

/** 角色档案状态词表（路由的 zod 与列的取值同源，不两处手抄）。 */
export const CHARACTER_PROFILE_STATUSES = ["draft", "generating", "ready", "failed"] as const;

/** 角色来源词表。 */
export const CHARACTER_PROFILE_SOURCES = ["seed", "manual"] as const;

export const characterProfile = sqliteTable(
  "characterProfile",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** 原型 / 职业（魔法少女、机甲驾驶员、巫女……），选角的第一层筛选。 */
    archetype: text("archetype").notNull().default(""),
    /** 性别（女 / 男 / 不公开）。 */
    gender: text("gender").notNull().default(""),
    /** 详细描述：外形 / 发色发型 / 瞳色 / 服饰 / 配饰 / 性格 / 能力 / 背景。 */
    description: text("description").notNull().default(""),
    /** 从描述自动提取的特征标签（JSON 字符串数组，去重、封顶）。 */
    tags: text("tags", { mode: "json" }).notNull().default("[]"),
    /** 主立绘地址（`/api/generated/character-library/<id>/<文件名>`）。 */
    portraitUrl: text("portraitUrl"),
    /** 候选立绘（JSON 数组，同工坊定妆照口径：一次生成不满意可累积多张再挑）。 */
    portraits: text("portraits", { mode: "json" }).notNull().default("[]"),
    /** draft | generating | ready | failed。 */
    status: text("status").notNull().default("draft"),
    /** seed | manual。 */
    source: text("source").notNull().default("manual"),
    /** 最近一次生图任务（对账回写用；不设外键——任务删除不应连带删角色档案）。 */
    taskId: text("taskId"),
    /** 最近一次生图的参数快照（按原样重新生成的充分输入，同资产库 `params` 口径）。 */
    params: text("params", { mode: "json" }),
    /** 生图宽高（产物元数据，列表页布局用）。 */
    width: integer("width"),
    height: integer("height"),
    createdAt: dateNotNull("createdAt")
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("characterProfile_user_created_idx").on(t.userId, t.createdAt),
    // 生成中角色的对账扫描按 (userId, status) 取行；标签搜索走 json_each 不吃索引。
    index("characterProfile_user_status_idx").on(t.userId, t.status),
    // 同一用户下角色名唯一（同系列角色库 `character` 的口径）：预置生成器保证
    // 不重名，手工撞名转业务 409；重跑种子用 onConflictDoNothing 幂等跳过。
    uniqueIndex("characterProfile_user_name_uniq").on(t.userId, t.name),
  ],
);

export const characterProfileRelations = relations(characterProfile, ({ one }) => ({
  user: one(user, { fields: [characterProfile.userId], references: [user.id] }),
}));

export type CharacterProfile = InferSelectModel<typeof characterProfile>;
export type CharacterProfileInsert = InferInsertModel<typeof characterProfile>;
