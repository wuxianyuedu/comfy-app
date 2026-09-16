/**
 * `schema.ts` — Drizzle SQLite schema（替代 prisma/schema.prisma）
 * ===========================================================================
 *
 * 表名严格对齐现有 `db.sqlite`（Prisma `@map` / 默认模型名），保证
 * `drizzle-kit push` 以 ALTER 方式同步、**不破坏已有数据**。
 *
 * 关键兼容性处理：
 *   - Prisma 在 SQLite 把 `DateTime` 存成 ISO 字符串（TEXT），Drizzle 默认
 *     `integer(timestamp)` 与其不兼容，故用自定义 `text` 列 + ISO 序列化
 *     （dateNotNull / dateNull），保证读写与历史数据一致。
 *   - Boolean 用 `integer(..., { mode: "boolean" })`（Prisma 同样存 0/1）。
 *   - Json 用 `text(..., { mode: "json" })`（Prisma Json 同样存为 TEXT JSON）。
 *   - id 默认用 cuid2（`@paralleldrive/cuid2` 的 createId），贴近 Prisma cuid；
 *     Project 复用客户端 `proj_*` id（无默认）。
 *
 * @module server/db/schema
 */
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import { OLLAMA_DEFAULT_BASE_URL } from "@/lib/endpoints";

// ── 自定义 DateTime 列（ISO 字符串，兼容 Prisma 存储）─────────────
const dateNotNull = customType<{ data: Date; driverData: string }>({
  dataType() {
    return "text";
  },
  fromDriver: (v) => new Date(v),
  toDriver: (v) => v.toISOString(),
});

const dateNull = customType<{ data: Date | null; driverData: string | null }>({
  dataType() {
    return "text";
  },
  fromDriver: (v) => (v == null ? null : new Date(v)),
  toDriver: (v) => (v == null ? null : v.toISOString()),
});

const cuid = () => text("id").$defaultFn(() => createId()).primaryKey();

// ── Better Auth 表（表名单数，对齐原 Prisma @map）─────────────────
export const user = sqliteTable("user", {
  id: cuid(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  password: text("password"),
  createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: dateNotNull("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  issuer: text("issuer"),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: dateNull("accessTokenExpiresAt"),
  refreshTokenExpiresAt: dateNull("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: dateNotNull("expiresAt").notNull(),
  createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

// ── 业务表 ───────────────────────────────────────────────────────
export const post = sqliteTable(
  "post",
  {
    id: cuid(),
    name: text("name").notNull(),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
    createdById: text("createdById")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("post_name_idx").on(t.name)]
);

export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(), // 复用客户端 proj_* id
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nodes: text("nodes", { mode: "json" }).notNull().default("[]"),
    edges: text("edges", { mode: "json" }).notNull().default("[]"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  },
  (t) => [index("project_user_updated_idx").on(t.userId, t.updatedAt)]
);

export const model = sqliteTable(
  "model",
  {
    id: cuid(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    fileName: text("fileName").notNull(),
    folder: text("folder"),
    subfolder: text("subfolder"),
    baseModel: text("baseModel"),
    coverUrl: text("coverUrl"),
    description: text("description"),
    category: text("category"),
    isAvailable: integer("isAvailable", { mode: "boolean" }).notNull().default(false),
    source: text("source").notNull().default("LOCAL"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("model_file_folder_uniq").on(t.fileName, t.folder),
    index("model_type_idx").on(t.type),
    index("model_folder_idx").on(t.folder),
    index("model_avail_idx").on(t.isAvailable),
  ]
);

export const userModelConfig = sqliteTable(
  "userModelConfig",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    folder: text("folder").notNull(),
    label: text("label"),
    type: text("type").notNull(),
    types: text("types").notNull().default("[]"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    isCustom: integer("isCustom", { mode: "boolean" }).notNull().default(false),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("umc_user_folder_uniq").on(t.userId, t.folder),
    index("umc_user_idx").on(t.userId),
  ]
);

export const favorite = sqliteTable(
  "favorite",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    modelId: text("modelId")
      .notNull()
      .references(() => model.id, { onDelete: "cascade" }),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("fav_user_model_uniq").on(t.userId, t.modelId)]
);

export const task = sqliteTable(
  "task",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negativePrompt"),
    params: text("params", { mode: "json" }).notNull(),
    workflowName: text("workflowName").notNull(),
    workflowSnapshot: text("workflowSnapshot", { mode: "json" }),
    projectId: text("projectId"),
    referenceImages: text("referenceImages", { mode: "json" }),
    status: text("status").notNull().default("QUEUED"),
    promptId: text("promptId"),
    progress: integer("progress").notNull().default(0),
    resultImages: text("resultImages", { mode: "json" }),
    logs: text("logs", { mode: "json" }),
    error: text("error"),
    validationErrors: text("validationErrors"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    finishedAt: dateNull("finishedAt"),
  },
  (t) => [
    index("task_user_created_idx").on(t.userId, t.createdAt),
    index("task_project_idx").on(t.projectId),
  ]
);

export const taskImage = sqliteTable("taskImage", {
  id: cuid(),
  taskId: text("taskId")
    .notNull()
    .references(() => task.id, { onDelete: "cascade" }),
  localPath: text("localPath").notNull(),
  mediaType: text("mediaType").notNull().default("image"),
  seed: text("seed"),
  width: integer("width"),
  height: integer("height"),
  isCover: integer("isCover", { mode: "boolean" }).notNull().default(false),
  sortIndex: integer("sortIndex").notNull().default(0),
});

export const workflowTemplate = sqliteTable(
  "workflowTemplate",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    taskType: text("taskType").notNull().default("TXT2IMG"),
    modes: text("modes").notNull().default("[]"),
    defaultMode: text("defaultMode"),
    graph: text("graph", { mode: "json" }).notNull(),
    paramMap: text("paramMap", { mode: "json" }),
    workflowIO: text("workflowIO", { mode: "json" }),
    rawJson: text("rawJson", { mode: "json" }),
    positions: text("positions", { mode: "json" }),
    sourcePath: text("sourcePath"),
    sourceChecksum: text("sourceChecksum"),
    sourceMtime: integer("sourceMtime"),
    apiSource: text("apiSource"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("wt_user_idx").on(t.userId)]
);

export const workflowModelTag = sqliteTable(
  "workflowModelTag",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("wmt_user_name_uniq").on(t.userId, t.name),
    index("wmt_user_idx").on(t.userId),
  ]
);

// 显式多对多连接表（替代 Prisma 隐式 m2m；旧关联数据不迁移，影响仅工作流标签）
export const workflowModelTagToWorkflowTemplate = sqliteTable(
  "workflowModelTag_workflowTemplate",
  {
    workflowModelTag: text("workflowModelTag")
      .notNull()
      .references(() => workflowModelTag.id, { onDelete: "cascade" }),
    workflowTemplate: text("workflowTemplate")
      .notNull()
      .references(() => workflowTemplate.id, { onDelete: "cascade" }),
  },
  (t) => [index("wmtt_wt_idx").on(t.workflowTemplate)]
);

export const llmConfig = sqliteTable("llmConfig", {
  id: text("id").primaryKey(), // "singleton"
  provider: text("provider").notNull().default("local"),
  baseUrl: text("baseUrl").notNull().default(OLLAMA_DEFAULT_BASE_URL),
  model: text("model").notNull().default(""),
  /** 本地 Ollama 候选模型名（JSON，纯名字字符串数组）：设置页可勾选多个，
   *  供工坊本地组切换使用。本地模型不持有 apiKey；远端独立模型见 remoteModel 表。 */
  extraModels: text("extraModels", { mode: "json" }),
  apiKey: text("apiKey"),
  temperature: real("temperature").notNull().default(0.7),
  temperatureByTask: text("temperatureByTask", { mode: "json" }),
  maxTokens: integer("maxTokens").notNull().default(2048),
  updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
});

/**
 * 远端独立模型表（option C：与本地 Ollama 候选彻底分开存放）。
 * 设置页配置的「远端模型」落这里，不再与本地候选混在 llmConfig.extraModels。
 * 每个条目可带独立 baseUrl / apiKey —— apiKey 仅远端模型才有，本地模型没有。
 */
export const remoteModel = sqliteTable(
  "remoteModel",
  {
    id: cuid(),
    /** 模型名，唯一（同名重复添加会被唯一索引拒绝） */
    name: text("name").notNull(),
    /** 独立接口地址；空 = 跟随 llmConfig.baseUrl（远端全局默认） */
    baseUrl: text("baseUrl"),
    /** 独立密钥；仅远端模型持有。密文(enc:v1:...)或历史明文。 */
    apiKey: text("apiKey"),
    /** 用途：chat / image / video */
    kind: text("kind").notNull().default("chat"),
    /** 工坊按模式的输入/输出适配器（JSON 数组字符串；RemoteModeAdapter[]）。
     *  配置后工坊按该模型在对应模式下的字段映射发起请求，替代统一猜测。 */
    workshopAdapters: text("workshopAdapters"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("remoteModel_name_uniq").on(t.name),
    index("remoteModel_kind_idx").on(t.kind),
  ]
);

export const skill = sqliteTable(
  "skill",
  {
    id: cuid(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description").notNull(),
    icon: text("icon").notNull().default("✨"),
    category: text("category").notNull().default("style"),
    promptTemplate: text("promptTemplate").notNull(),
    negativePrompt: text("negativePrompt"),
    defaultParams: text("defaultParams", { mode: "json" }),
    recommendedModel: text("recommendedModel"),
    tags: text("tags").default("[]"),
    coverUrl: text("coverUrl"),
    isBuiltIn: integer("isBuiltIn", { mode: "boolean" }).notNull().default(false),
    sortOrder: integer("sortOrder").notNull().default(0),
    isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("skill_cat_idx").on(t.category),
    index("skill_active_idx").on(t.isActive),
    index("skill_builtin_idx").on(t.isBuiltIn),
  ]
);

export const loraTrainingJob = sqliteTable(
  "loraTrainingJob",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    baseModel: text("baseModel").notNull(),
    triggerWord: text("triggerWord").notNull(),
    classWord: text("classWord"),
    datasetImages: text("datasetImages", { mode: "json" }).notNull(),
    resolution: integer("resolution").notNull().default(512),
    steps: integer("steps").notNull().default(1500),
    batchSize: integer("batchSize").notNull().default(4),
    learningRate: real("learningRate").notNull().default(0.0001),
    rankDim: integer("rankDim").notNull().default(32),
    networkAlpha: integer("networkAlpha").notNull().default(16),
    optimizer: text("optimizer").notNull().default("AdamW8bit"),
    scheduler: text("scheduler").notNull().default("cosine"),
    seed: integer("seed").notNull().default(0),
    status: text("status").notNull().default("QUEUED"),
    progress: integer("progress").notNull().default(0),
    outputName: text("outputName"),
    logs: text("logs", { mode: "json" }),
    error: text("error"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  },
  (t) => [index("lora_user_created_idx").on(t.userId, t.createdAt)]
);

export const filmProject = sqliteTable(
  "filmProject",
  {
    id: cuid(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    script: text("script").notNull(),
    type: text("type").notNull().default("short_video"),
    styleSlug: text("styleSlug"),
    size: text("size").notNull().default("1280x720"),
    fps: integer("fps").notNull().default(16),
    framesPerShot: integer("framesPerShot").notNull().default(49),
    subtitleOn: integer("subtitleOn", { mode: "boolean" }).notNull().default(true),
    bgmName: text("bgmName"),
    status: text("status").notNull().default("PARSING"),
    progress: integer("progress").notNull().default(0),
    finalVideo: text("finalVideo"),
    logs: text("logs", { mode: "json" }),
    error: text("error"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  },
  (t) => [index("film_user_created_idx").on(t.userId, t.createdAt)]
);

export const filmShot = sqliteTable(
  "filmShot",
  {
    id: cuid(),
    filmId: text("filmId")
      .notNull()
      .references(() => filmProject.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    heading: text("heading"),
    prompt: text("prompt").notNull(),
    negative: text("negative"),
    params: text("params", { mode: "json" }),
    taskId: text("taskId"),
    status: text("status").notNull().default("IDLE"),
    progress: integer("progress").notNull().default(0),
    videoPath: text("videoPath"),
    duration: real("duration"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  },
  (t) => [index("film_shot_film_order_idx").on(t.filmId, t.order)]
);

export const auditLog = sqliteTable(
  "auditLog",
  {
    id: cuid(),
    event: text("event").notNull(),
    userId: text("userId"),
    ip: text("ip"),
    meta: text("meta"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (t) => [
    index("audit_event_idx").on(t.event),
    index("audit_user_idx").on(t.userId),
    index("audit_created_idx").on(t.createdAt),
  ]
);

// ── 工坊 MCP 会话（AI 驱动的流水线状态，服务端持久化，与界面共享同一项目）──
// userId 允许为空：MCP 会话通常是系统（AI）所有，不绑定登录用户。
export const workshopSession = sqliteTable(
  "workshopSession",
  {
    id: text("id").$defaultFn(() => createId()).primaryKey(),
    userId: text("userId"),
    title: text("title").notNull().default("未命名工坊项目"),
    type: text("type").notNull().default("short_video"),
    tone: text("tone").notNull().default(""),
    logline: text("logline").notNull().default(""),
    idea: text("idea").notNull().default(""),
    scriptMarkdown: text("scriptMarkdown").notNull().default(""),
    scenes: text("scenes", { mode: "json" }).notNull().default("[]"),
    characters: text("characters", { mode: "json" }).notNull().default("[]"),
    shots: text("shots", { mode: "json" }).notNull().default("[]"),
    stage: text("stage").notNull().default("script"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  },
  (t) => [
    index("workshop_session_user_idx").on(t.userId),
    index("workshop_session_updated_idx").on(t.updatedAt),
  ]
);

// ── 工坊前端项目草稿的服务端镜像（防丢持久化）──────────────────
// 工坊界面编辑的剧本/角色/分镜/镜头草稿默认只落在浏览器 localStorage，
// 清缓存 / 隐私模式 / webview 存储重置即丢。此表把每个前端项目
// （id 即前端生成的 wsp_* 项目 id）按行落库到本地 db.sqlite，
// 启动时由 drizzle-kit push 自动建表（与 workshopSession 并列，互不污染）。
export const workshopDraft = sqliteTable(
  "workshopDraft",
  {
    id: text("id").primaryKey(), // = 前端项目 id（wsp_*），应用启动后稳定不变
    userId: text("userId"),
    title: text("title").notNull().default("未命名工坊项目"),
    type: text("type").notNull().default("short_video"),
    tone: text("tone").notNull().default(""),
    logline: text("logline").notNull().default(""),
    scriptMarkdown: text("scriptMarkdown").notNull().default(""),
    scenes: text("scenes", { mode: "json" }).notNull().default("[]"),
    characters: text("characters", { mode: "json" }).notNull().default("[]"),
    shots: text("shots", { mode: "json" }).notNull().default("[]"),
    createdAt: dateNotNull("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: dateNotNull("updatedAt").notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date()),
  },
  (t) => [
    index("workshop_draft_user_updated_idx").on(t.userId, t.updatedAt),
  ]
);

// ── 关系（仅 include 用到：task.images / filmProject.shots）────────
export const taskRelations = relations(task, ({ many }) => ({
  images: many(taskImage),
}));
export const taskImageRelations = relations(taskImage, ({ one }) => ({
  task: one(task, { fields: [taskImage.taskId], references: [task.id] }),
}));
export const filmProjectRelations = relations(filmProject, ({ many }) => ({
  shots: many(filmShot),
}));
export const filmShotRelations = relations(filmShot, ({ one }) => ({
  film: one(filmProject, { fields: [filmShot.filmId], references: [filmProject.id] }),
}));

// ── 推断行类型（替代原 generated/prisma 的模型类型）──────────────
export type User = InferSelectModel<typeof user>;
export type Session = InferSelectModel<typeof session>;
export type Account = InferSelectModel<typeof account>;
export type Verification = InferSelectModel<typeof verification>;
export type Post = InferSelectModel<typeof post>;
export type Project = InferSelectModel<typeof project>;
export type Model = InferSelectModel<typeof model>;
export type UserModelConfig = InferSelectModel<typeof userModelConfig>;
export type Favorite = InferSelectModel<typeof favorite>;
export type Task = InferSelectModel<typeof task>;
export type TaskImage = InferSelectModel<typeof taskImage>;
export type WorkflowTemplate = InferSelectModel<typeof workflowTemplate>;
export type WorkflowModelTag = InferSelectModel<typeof workflowModelTag>;
export type LlmConfig = InferSelectModel<typeof llmConfig>;
export type RemoteModel = InferSelectModel<typeof remoteModel>;
export type RemoteModelInsert = InferInsertModel<typeof remoteModel>;
export type Skill = InferSelectModel<typeof skill>;
export type LoraTrainingJob = InferSelectModel<typeof loraTrainingJob>;
export type FilmProject = InferSelectModel<typeof filmProject>;
export type FilmShot = InferSelectModel<typeof filmShot>;
export type AuditLog = InferSelectModel<typeof auditLog>;
export type WorkshopSession = InferSelectModel<typeof workshopSession>;
export type WorkshopSessionInsert = InferInsertModel<typeof workshopSession>;

export type WorkshopDraft = InferSelectModel<typeof workshopDraft>;
export type WorkshopDraftInsert = InferInsertModel<typeof workshopDraft>;

export type UserInsert = InferInsertModel<typeof user>;
export type TaskInsert = InferInsertModel<typeof task>;
export type ProjectInsert = InferInsertModel<typeof project>;
export type SkillInsert = InferInsertModel<typeof skill>;
export type LoraTrainingJobInsert = InferInsertModel<typeof loraTrainingJob>;
export type FilmProjectInsert = InferInsertModel<typeof filmProject>;
export type WorkflowTemplateInsert = InferInsertModel<typeof workflowTemplate>;
