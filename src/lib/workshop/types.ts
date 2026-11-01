// ── 工坊共享类型 ─────────────────────────────────────────
// 全链路创作流水线：剧本 → 角色 → 分镜 → 生成

import { z } from "zod";

/* 整条流水线的项目元数据。 */
export type ProjectMeta = {
  logline: string; // 一句话的卖点概述
  /** 用 Markdown 写的自由剧本全文（在剧本编辑器里可见）。 */
  scriptMarkdown?: string;
  title: string;
  tone: string; // e.g. "温暖治愈", "悬疑紧张"
  type: ProjectType;
};

export type ProjectType =
  | "short_video" // 短视频
  | "micro_film" // 微电影
  | "animation" // 动画
  | "ad" // 广告
  | "comic" // 漫画/漫剧
  | "other";

/* 剧本里的一个场景。 */
export type Scene = {
  action: string; // 画面/动作描述
  dialogue: string; // 台词/旁白
  heading: string; // 场景标题 e.g. "场景1 · 清晨的咖啡馆"
  id: string;
  location: string; // 地点
  shotCount: number; // suggested number of shots
  time: string; // 时间
};

/** 定妆照来源通道：本机 ComfyUI 工作流 / 远端 API 直连 / 外部导入的现成图。 */
export type PortraitSource = "local" | "remote" | "import";

/**
 * 生成状态（图片与视频片段共用同一套）。写成联合类型三遍就是三份事实
 * （§12.12）：`Shot.status`、`Shot.clipStatus`、`Asset.status` 现在都指向这里，
 * 而写侧契约要按**同一份**枚举校验取值。
 */
export const SHOT_STATUSES = /* SAFETY: 类型断言已复核 */ [
  "idle",
  "queued",
  "running",
  "done",
  "failed",
  "stale",
] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

export const MOTION_LEVELS = /* SAFETY: 类型断言已复核 */ ["low", "medium", "high"] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];
export const TRANSITIONS = /* SAFETY: 类型断言已复核 */ ["cut", "dissolve", "fade"] as const;
export type Transition = (typeof TRANSITIONS)[number];

export const MOTION_LABELS: Record<MotionLevel, string> = {
  low: "轻运动",
  medium: "中运动",
  high: "强运动",
};

export const TRANSITION_LABELS: Record<Transition, string> = {
  cut: "硬切",
  dissolve: "叠化",
  fade: "淡入淡出",
};

/**
 * 景别的**唯一取值清单**。
 *
 * 为什么是一份数组而不是联合类型字面量：`ShotType` 由它派生，
 * 而清单本身要被三类人共用 —— 提示词里那句「取值之一：…」（两处曾各自抄一份，
 * 加一个景别就要记得改两边，第三边还会忘）、`SHOT_TYPE_LABELS` 的键、
 * 以及**从 LLM 回来的字符串**收窄回 `ShotType` 的那条判据
 *（`normalizeShotType`）。曾经有一份把这条收窄跳过去写成 `as never`，
 * 表现是「LLM 说什么就存什么」，而类型层完全不知道。
 */
export const SHOT_TYPES = /* SAFETY: 类型断言已复核 */ [
  "extreme_wide", // 大远景
  "wide", // 远景
  "full", // 全景
  "medium", // 中景
  "close", // 近景
  "extreme_close", // 特写
  "poi", // 仰拍
  "pod", // 俯拍
] as const;

export type ShotType = (typeof SHOT_TYPES)[number];

/** 默认景别：清单里的那一档（`normalizeShotType` 的回落值）。 */
export const DEFAULT_SHOT_TYPE: ShotType = "medium";

/** 把**外来**的景别值（LLM 输出、解析出的 JSON、URL 参数）收进清单。
 *  不在清单里的一律回落默认档 —— 不抛错（一条镜头的景别写错不该毁掉整批解析），
 *  但也不放它进类型系统。 */
export function normalizeShotType(raw: unknown): ShotType {
  return /* SAFETY: 类型断言已复核 */ (SHOT_TYPES as ReadonlyArray<string>).includes(
    typeof raw === "string" ? raw : "",
  )
    ? /* SAFETY: 类型断言已复核 */ (raw as ShotType)
    : DEFAULT_SHOT_TYPE;
}

export const SHOT_TYPE_LABELS: Record<ShotType, string> = {
  extreme_wide: "大远景",
  wide: "远景",
  full: "全景",
  medium: "中景",
  close: "近景",
  extreme_close: "特写",
  poi: "仰拍",
  pod: "俯拍",
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  short_video: "短视频",
  micro_film: "微电影",
  animation: "动画",
  ad: "广告",
  comic: "漫画/漫剧",
  other: "其他",
};

/* 从技能系统取来的风格预设（SkillData 的子集）。 */
export type StyleRef = {
  defaultParams?: Record<string, unknown>;
  icon: string;
  name: string;
  negativePrompt?: string;
  promptTemplate: string;
  slug: string;
};

// ── 全链路流水线的阶段 ─────────────────────────────────

export type PipelineStageId =
  | "script"
  | "character"
  | "storyboard"
  | "shot_generation"
  | "video_generation"
  | "final_edit";

export type StageStatus = "locked" | "pending" | "ready" | "done" | "stale";

export type PipelineStage = {
  count: number; // e.g. scenes / characters / shots / completed shots
  id: PipelineStageId;
  label: string;
  status: StageStatus;
  total: number; // total expected items; 0 means not estimable yet
};

export type AssetKind =
  | "script"
  | "storyboard_script"
  | "character_card"
  | "scene_image"
  | "video_clip"
  | "audio"
  | "final_video";

export type Asset = {
  createdAt: string;
  /** 可选：关联的实体 id（场景 / 镜头 / 角色）。 */
  entityId?: string;
  id: string;
  kind: AssetKind;
  /** 生成类媒体专用的生成状态。 */
  status?: ShotStatus;
  title: string;
  /** 媒体素材的 URL 或路径。 */
  url?: string;
};

/* ── 写侧入参契约（外部可控的那一份 Character[] / Shot[]）────────────────
 *
 * 为什么写在类型旁边而不是 MCP 文件里：这一层的形状只有**一份事实**（上面的接口），
 * 契约与接口分两处就会漂移。而它要挡的是能直接把 JSON 递进来的调用方 ——
 * `workshop_set_characters` / `workshop_set_storyboard` 是**整幅覆盖**草稿并落库，
 * MCP 侧原本是 `z.array(z.any())` 再 `as never` 压进 `Character[]`，等于任何形状都能进。
 * 两个实测到的后果：`styleTags` 给成字符串时 `buildCharacterPrompt` 先过
 * `c.styleTags.length`（字符串也成立）再 `.join()` → TypeError 直接把写入路径打断；
 * `characterIds` 同理被 `rebuildShotPrompts` 的 `.includes` 用掉。
 *
 * 口径四条：
 *   · **只有「缺了就没法被引用」的才必填**（id / name / index / sceneId 这类）；
 *   · **可缺省的补默认**（文本 → ""，列表 → []），因为下游是无条件读取它们；
 *   · **枚举按既有归一器走**：必填枚举（景别）认不出落默认档，可选枚举认不出
 *     **当没给** —— 一个拼错的可选字段不该把整批镜头拒收，脏值更不该落进草稿；
 *   · `positivePrompt` / `negativePrompt` / `prompt` 由服务端
 *     `rebuildCharacterPrompts` / `rebuildShotPrompts` **重算**，这里只给空串占位：
 *     输入里带什么都不信（否则外部可以绕过重算直接指定最终提示词）。
 *
 * zod 对未声明的键默认**丢弃**，所以"顺手多带一个字段"不会污染草稿；
 * 空数组是**合法**的（那是"清空这一阶段"，与上面的整幅覆盖语义一致）。
 */

/** 字符串列表：模型常把单个标签写成字符串（`"皮克斯"`），认得就收成一行。 */
const stringList = z
  .union([z.array(z.string()), z.string()])
  .transform((value) => (typeof value === "string" ? [value] : value));

/**
 * 可选枚举：认不出的值一律当成「没给」（见上方口径第三条）。
 *
 * `.optional()` 必须包在 `.transform()` **外面**：它决定输出侧这个键是否可选。
 * 写在里面时输出类型是「必带这个键（值可为 undefined）」，与消费侧 `motion?:`
 * 那一类声明正好反过来，派生出来的类型就会让所有字面量集体报 `TS2741`。
 */
function optionalEnum<const T extends ReadonlyArray<string>>(values: T) {
  return z
    .unknown()
    .transform((value) =>
      /* SAFETY: 类型断言已复核 */
      values.includes(/* SAFETY: 类型断言已复核 */ value as string)
        ? (value as T[number])
        : undefined,
    )
    .optional();
}

/** 只收对象：`params` 是必填字段，非对象（含缺省）一律换成空对象。 */
function paramsObject(value: unknown): Record<string, unknown> {
  /* SAFETY: 类型断言已复核 */
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const characterPortraitInputSchema = z.object({
  /** 浏览器可直接引用的图片地址（本机产物走 /api/generated，导入走素材库）。 */
  url: z.string().min(1),
  source: z.enum(["local", "remote", "import"]),
  /** 生成时使用的模型（本机 checkpoint / 远端 API 模型名），导入来源没有。 */
  model: z.string().optional(),
  /** 本机通道的 ComfyUI 任务 id，便于回溯任务历史。 */
  taskId: z.string().optional(),
  /** 缺省时补当下时间戳（0 会让它永远排在最前，排序是这张卡的用途之一）。
   *  默认值落在这一层：外层 `.transform` 里补会把「输入可缺」写成
   *  「输出必带这个键（值可为 undefined）」，与消费侧的可选声明正好反过来。 */
  createdAt: z
    .number()
    .int()
    .nonnegative()
    .default(() => Date.now()),
});

/** 一份能产出 ComfyUI 提示词的角色设定。 */
export const characterInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    ageGender: z.string().default(""), // 年龄/性别
    appearance: z.string().default(""), // 外貌特征
    costume: z.string().default(""), // 服装
    personality: z.string().default(""), // 性格
    temperament: z.string().default(""), // 气质
    styleTags: stringList.default([]), // 自由风格关键词（如 ["皮克斯", "厚涂"]）
    skillSlug: z.string().optional(), // 关联的画风 Skill
    /** 定妆照候选（多次生成 / 外部导入累积，供挑选；上限见 character-portrait.ts）。
     *  存在角色本身而非独立表 —— 角色随草稿 JSON 列一起持久化，新增字段无需迁移。 */
    portraits: z.array(characterPortraitInputSchema).optional(),
    /** 已选定的定妆照（portraits 里的一张），后续分镜图以此作为参考图。 */
    portraitUrl: z.string().optional(),
    params: z.unknown().optional().transform(paramsObject), // 推荐生成参数
    /** 绑定的 LoRA 文件名（模型库 loras 目录，#2622 FR-QA-02③）。提交时取
     *  出场角色里第一个绑定，落到工作流「lora-name」契约口（LoraLoader 的
     *  lora_name）；没绑或工作流没连该口 → 用工作流图内 LoRA 配置。 */
    loraName: z.string().optional(),
    /** LoRA 强度（0~2，缺省 1 由工作流图内值兜底；只连 lora-name 不连
     *  lora-strength 口时本值不生效）。 */
    loraStrength: z.number().optional(),
  })
  .transform((character) => ({
    ...character,
    positivePrompt: "",
    negativePrompt: "",
  }));

/** 一个分镜镜头，对应一次图片生成任务（之后还会对应一段视频片段）。 */
export const shotInputSchema = z
  .object({
    id: z.string().min(1),
    index: z.number().int(), // 镜号
    sceneId: z.string().default(""), // 来源场景
    sceneHeading: z.string().default(""),
    /**
     * 景别走**既有归一器**（脏值落默认档，不原样落库）。
     *
     * 为什么不写 `z.unknown().transform(normalizeShotType)`：MCP 的入参校验发生在
     * SDK 从 zod 推出的 **JSON Schema** 上，`z.unknown()` 在那里是「非可选」，
     * 于是「模型压根没给景别」这种最常见的情况会在边界直接被拒
     * （实测 `expected nonoptional, received undefined at shots[0].shotType`）。
     * `.default()` 才同时在两层成立：JSON Schema 里是带 default 的可选字段，
     * zod 侧缺值先补默认再交给归一器。
     */
    shotType: z
      .string()
      .default(DEFAULT_SHOT_TYPE)
      .transform((value) => normalizeShotType(value)),
    description: z.string().default(""), // 画面描述
    characterIds: stringList.default([]), // 关联角色
    skillSlug: z.string().optional(), // 风格 Skill
    status: z.enum(SHOT_STATUSES).default("idle"),
    taskId: z.string().optional(),
    imageUrl: z.string().optional(),
    // ── 视频生成计划 ──
    dialogue: z.string().optional(), // 对白 / 字幕文本
    motion: optionalEnum(MOTION_LEVELS), // 运动强度（I2V）
    duration: z.number().optional(), // 镜头时长（秒）
    transition: optionalEnum(TRANSITIONS), // 与下一镜的转场
    clipStatus: optionalEnum(SHOT_STATUSES),
    clipUrl: z.string().optional(), // 生成的视频片段地址
    /** 本机视频任务的 id（同 `taskId`：随草稿持久化，重挂载后据此恢复失联任务）。
     *  API 直连通道的 remoteTaskId 是另一套体系，不落这里。 */
    clipTaskId: z.string().optional(),
    params: z.unknown().optional().transform(paramsObject),
  })
  .transform((shot) => ({ ...shot, prompt: "", negativePrompt: "" }));

/** 一份角色卡数组（MCP `workshop_set_characters` 的入参形状）。 */
export const characterListInputSchema = z.array(characterInputSchema);
/** 一份镜头数组（MCP `workshop_set_storyboard` 的入参形状）。 */
export const shotListInputSchema = z.array(shotInputSchema);

/* ── 消费侧类型：由写侧 schema 派生，不再另写一份声明 ─────────────────
 *
 * 两份互不引用的声明加一个字段时谁也不红，而它们喂的是同一条草稿（MCP 写入 /
 * 画布 / 仓储 / 草稿镜像）—— 于是「类型层漂移编译期看不见、运行时才炸」
 * （ISSUE #2499）。这里让 schema 成为唯一事实：类型由 `z.output` 派生，
 * 字段语义见上面 schema 内的注释。
 */
export type Character = z.output<typeof characterInputSchema>;
export type CharacterPortrait = z.output<typeof characterPortraitInputSchema>;
export type Shot = z.output<typeof shotInputSchema>;
