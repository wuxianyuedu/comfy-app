// ── Workshop shared types ─────────────────────────────────
// Full-chain creative pipeline: Script → Character → Storyboard → Generate

/** Project metadata for the whole pipeline */
export interface ProjectMeta {
  title: string;
  type: ProjectType;
  tone: string; // e.g. "温暖治愈", "悬疑紧张"
  logline: string; // one-line pitch
}

export type ProjectType =
  | "short_video" // 短视频
  | "micro_film" // 微电影
  | "animation" // 动画
  | "ad" // 广告
  | "comic" // 漫画/漫剧
  | "other";

/** A single script scene */
export interface Scene {
  id: string;
  heading: string; // 场景标题 e.g. "场景1 · 清晨的咖啡馆"
  location: string; // 地点
  time: string; // 时间
  action: string; // 画面/动作描述
  dialogue: string; // 台词/旁白
  shotCount: number; // suggested number of shots
}

/** A character sheet that yields ComfyUI prompts */
export interface Character {
  id: string;
  name: string;
  ageGender: string; // 年龄/性别
  appearance: string; // 外貌特征
  costume: string; // 服装
  personality: string; // 性格
  styleTags: string[]; // free style keywords (e.g. ["皮克斯", "厚涂"])
  skillSlug?: string; // linked Skill for art style
  positivePrompt: string; // generated ComfyUI positive prompt
  negativePrompt: string; // generated negative prompt
  params: Record<string, unknown>; // recommended generation params
}

/** A storyboard shot that maps to one image-generation task (and later a video clip) */
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
  // ── Video generation plan ──
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

/** A style preset pulled from the Skill system (subset of SkillData) */
export interface StyleRef {
  slug: string;
  name: string;
  icon: string;
  promptTemplate: string;
  negativePrompt?: string;
  defaultParams?: Record<string, unknown>;
}

// ── Full-chain pipeline stages ─────────────────────────────────

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
  /** Optional linked entity id (scene / shot / character) */
  entityId?: string;
  /** URL/path for media assets */
  url?: string;
  createdAt: string;
  /** For generated media: generation status */
  status?: "idle" | "queued" | "running" | "done" | "failed" | "stale";
}
