// ── 工坊共享类型 ─────────────────────────────────────────
// 全链路创作流水线：剧本 → 角色 → 分镜 → 生成

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
  status: "idle" | "queued" | "running" | "done" | "failed" | "stale";
  taskId?: string;
  imageUrl?: string;
  // ── 视频生成计划 ──
  dialogue?: string; // 对白 / 字幕文本
  motion?: MotionLevel; // 运动强度（I2V）
  duration?: number; // 镜头时长（秒）
  transition?: Transition; // 与下一镜的转场
  clipStatus?: "idle" | "queued" | "running" | "done" | "failed" | "stale";
  clipUrl?: string; // 生成的视频片段地址
}

export type MotionLevel = "low" | "medium" | "high";
export type Transition = "cut" | "dissolve" | "fade";

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

export type ShotType =
  | "extreme_wide" // 大远景
  | "wide" // 远景
  | "full" // 全景
  | "medium" // 中景
  | "close" // 近景
  | "extreme_close" // 特写
  | "poi" // 仰拍
  | "pod"; // 俯拍

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
  status?: "idle" | "queued" | "running" | "done" | "failed" | "stale";
}
