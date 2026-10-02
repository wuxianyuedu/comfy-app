// ── 工坊共享类型 ─────────────────────────────────────────
// 全链路创作流水线：剧本 → 角色 → 分镜 → 生成

import { z } from "zod";

/* 整条流水线的项目元数据。 */
export interface ProjectMeta {
  title: string;
  type: ProjectType;
  tone: string; // e.g. "温暖治愈", "悬疑紧张"
  logline: string; // 一句话的卖点概述
  /** 用 Markdown 写的自由剧本全文（在剧本编辑器里可见）。 */
  scriptMarkdown?: string;
}

export type ProjectType =
  | "short_video" // 短视频
  | "micro_film" // 微电影
  | "animation" // 动画
  | "ad" // 广告
  | "comic" // 漫画/漫剧
  | "other";

/* 剧本里的一个场景。 */
export interface Scene {
  id: string;
  heading: string; // 场景标题 e.g. "场景1 · 清晨的咖啡馆"
  location: string; // 地点
  time: string; // 时间
  action: string; // 画面/动作描述
  dialogue: string; // 台词/旁白
  shotCount: number; // suggested number of shots
}

/* 一份能产出 ComfyUI 提示词的角色设定。 */
export interface Character {
  id: string;
  name: string;
  ageGender: string; // 年龄/性别
  appearance: string; // 外貌特征
  costume: string; // 服装
  personality: string; // 性格
  temperament: string; // 气质
  styleTags: string[]; // free style keywords (e.g. ["皮克斯", "厚涂"])
  skillSlug?: string; // linked Skill for art style
  positivePrompt: string; // generated ComfyUI positive prompt
  negativePrompt: string; // generated negative prompt
  params: Record<string, unknown>; // recommended generation params
  /** 定妆照候选（多次生成 / 外部导入累积，供挑选；上限见 character-portrait.ts）。
   *  存在角色本身而非独立表 —— 角色随草稿 JSON 列一起持久化，新增字段无需迁移。 */
  portraits?: CharacterPortrait[];
  /** 已选定的定妆照（portraits 里的一张），后续分镜图以此作为参考图。 */
  portraitUrl?: string;
}

/** 定妆照来源通道：本机 ComfyUI 工作流 / 远端 API 直连 / 外部导入的现成图。 */
export type PortraitSource = "local" | "remote" | "import";

/** 一张角色定妆照候选。 */
export interface CharacterPortrait {
  /** 浏览器可直接引用的图片地址（本机产物走 /api/generated，导入走素材库）。 */
  url: string;
  source: PortraitSource;
  /** 生成时使用的模型（本机 checkpoint / 远端 API 模型名），导入来源没有。 */
  model?: string;
  /** 本机通道的 ComfyUI 任务 id，便于回溯任务历史。 */
  taskId?: string;
  /** 生成/导入时间戳（ms），用于排序与同图去重。 */
  createdAt: number;
}

/* 一个分镜镜头，对应一次图片生成任务（之后还会对应一段视频片段）。 */
/**
 * 生成状态（图片与视频片段共用同一套）。写成联合类型三遍就是三份事实
 * （§12.12）：`Shot.status`、`Shot.clipStatus`、`Asset.status` 现在都指向这里，
 * 而写侧契约要按**同一份**枚举校验取值。
 */
export const SHOT_STATUSES = [
  "idle",
  "queued",
  "running",
  "done",
  "failed",
  "stale",
] as const;
export type ShotStatus = (typeof SHOT_STATUSES)[number];

export interface Shot {
  id: string;
  index: number; // 镜号
  sceneId: string; // source scene
  sceneHeading: string;
  shotType: ShotType; // 景别
  description: string; // 画面描述
  characterIds: string[]; // linked characters
  skillSlug?: string; // style skill
  prompt: string; // final ComfyUI prompt
  negativePrompt: string;
  params: Record<string, unknown>;
  status: ShotStatus;
  taskId?: string;
  imageUrl?: string;
  // ── 视频生成计划 ──
  dialogue?: string; // 对白 / 字幕文本
  motion?: MotionLevel; // 运动强度（I2V）
  duration?: number; // 镜头时长（秒）
  transition?: Transition; // 与下一镜的转场
  clipStatus?: ShotStatus;
  clipUrl?: string; // 生成的视频片段地址
  /** 本机视频任务的 id（同 `taskId`：随草稿持久化，重挂载后据此恢复失联任务）。
   *  API 直连通道的 remoteTaskId 是另一套体系，不落这里。 */
  clipTaskId?: string;
}

export const MOTION_LEVELS = ["low", "medium", "high"] as const;
export type MotionLevel = (typeof MOTION_LEVELS)[number];
export const TRANSITIONS = ["cut", "dissolve", "fade"] as const;
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
export const SHOT_TYPES = [
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
  return (SHOT_TYPES as readonly string[]).includes(
    typeof raw === "string" ? raw : "",
  )
    ? (raw as ShotType)
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
export interface StyleRef {
  slug: string;
  name: string;
  icon: string;
  promptTemplate: string;
  negativePrompt?: string;
  defaultParams?: Record<string, unknown>;
}

// ── 全链路流水线的阶段 ─────────────────────────────────

export type PipelineStageId =
  | "script"
  | "character"
  | "storyboard"
  | "shot_generation"
  | "video_generation"
  | "final_edit";

export type StageStatus = "locked" | "pending" | "ready" | "done" | "stale";

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  status: StageStatus;
  count: number; // e.g. scenes / characters / shots / completed shots
  total: number; // total expected items; 0 means not estimable yet
}

export type AssetKind =
  | "script"
  | "storyboard_script"
  | "character_card"
  | "scene_image"
  | "video_clip"
  | "audio"
  | "final_video";

export interface Asset {
  id: string;
  kind: AssetKind;
  title: string;
  /** 可选：关联的实体 id（场景 / 镜头 / 角色）。 */
  entityId?: string;
  /** 媒体素材的 URL 或路径。 */
  url?: string;
  createdAt: string;
  /** 生成类媒体专用的生成状态。 */
  status?: ShotStatus;
}

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

/** 可选枚举：认不出的值一律当成「没给」（见上方口径第三条）。 */
function optionalEnum<const T extends readonly string[]>(values: T) {
  return z
    .unknown()
    .optional()
    .transform((value) =>
      values.includes(value as string) ? (value as T[number]) : undefined,
    );
}

/** 只收对象：`params` 是必填字段，非对象（含缺省）一律换成空对象。 */
function paramsObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const characterPortraitInputSchema = z.object({
  url: z.string().min(1),
  source: z.enum(["local", "remote", "import"]),
  model: z.string().optional(),
  taskId: z.string().optional(),
  /** 缺省时补当下时间戳（0 会让它永远排在最前，排序是这张卡的用途之一）。 */
  createdAt: z.number().int().nonnegative().optional(),
});

export const characterInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    ageGender: z.string().default(""),
    appearance: z.string().default(""),
    costume: z.string().default(""),
    personality: z.string().default(""),
    temperament: z.string().default(""),
    styleTags: stringList.default([]),
    skillSlug: z.string().optional(),
    portraits: z.array(characterPortraitInputSchema).optional(),
    portraitUrl: z.string().optional(),
    params: z.unknown().optional().transform(paramsObject),
  })
  .transform((character) => ({
    ...character,
    positivePrompt: "",
    negativePrompt: "",
    portraits: character.portraits?.map((portrait) => ({
      ...portrait,
      createdAt: portrait.createdAt ?? Date.now(),
    })),
  }));

export const shotInputSchema = z
  .object({
    id: z.string().min(1),
    index: z.number().int(),
    sceneId: z.string().default(""),
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
    description: z.string().default(""),
    characterIds: stringList.default([]),
    skillSlug: z.string().optional(),
    status: z.enum(SHOT_STATUSES).default("idle"),
    taskId: z.string().optional(),
    imageUrl: z.string().optional(),
    dialogue: z.string().optional(),
    motion: optionalEnum(MOTION_LEVELS),
    duration: z.number().optional(),
    transition: optionalEnum(TRANSITIONS),
    clipStatus: optionalEnum(SHOT_STATUSES),
    clipUrl: z.string().optional(),
    clipTaskId: z.string().optional(),
    params: z.unknown().optional().transform(paramsObject),
  })
  .transform((shot) => ({ ...shot, prompt: "", negativePrompt: "" }));

/** 一份角色卡数组（MCP `workshop_set_characters` 的入参形状）。 */
export const characterListInputSchema = z.array(characterInputSchema);
/** 一份镜头数组（MCP `workshop_set_storyboard` 的入参形状）。 */
export const shotListInputSchema = z.array(shotInputSchema);
