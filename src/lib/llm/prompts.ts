import type { ProjectMeta, Scene, Character, ShotType } from "@/lib/workshop/types";
import type { LLMMessage } from "./types";
import { extractJson, extractJsonArray } from "./parse";

// ─────────────────────────────────────────────────────────────
// Script generation
// ─────────────────────────────────────────────────────────────
export const SCRIPT_SYSTEM = `你是一位专业影视编剧助手。用户会提供项目信息（类型、基调、梗概）和一段灵感或粗稿。请将其扩展为结构化的分镜脚本。
要求：
- 只输出严格的 JSON 数组，不要任何额外文字、解释或代码围栏。
- 每个元素是场景对象：{ "heading": "场景标题", "location": "地点", "time": "时间", "action": "画面/动作描述（2-4句，具象、可视觉化）", "dialogue": "关键台词或旁白（可空字符串）", "shotCount": 该场景建议镜头数(整数1-6) }
- 场景数量根据素材合理拆分为 2-6 个，开头-发展-高潮结构清晰。
- 全程使用中文，人物与动作要具体、可拍。`;

export function buildScriptMessages(meta: Pick<ProjectMeta, "type" | "tone" | "logline">, idea: string): LLMMessage[] {
  const user = `项目类型：${meta.type}
基调/情绪：${meta.tone || "未指定"}
一句话梗概：${meta.logline || "无"}
灵感/粗稿：
${idea}`;
  return [
    { role: "system", content: SCRIPT_SYSTEM },
    { role: "user", content: user },
  ];
}

export interface RawScene {
  heading: string;
  location?: string;
  time?: string;
  action: string;
  dialogue?: string;
  shotCount?: number;
}

export function parseScriptScenes(text: string): RawScene[] {
  const data = extractJsonArray(text);
  return data.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    return {
      heading: String(o.heading ?? "未命名场景"),
      location: o.location ? String(o.location) : "",
      time: o.time ? String(o.time) : "",
      action: String(o.action ?? ""),
      dialogue: o.dialogue ? String(o.dialogue) : "",
      shotCount: Math.min(6, Math.max(1, Number(o.shotCount) || 2)),
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Character design
// ─────────────────────────────────────────────────────────────
export const CHARACTER_SYSTEM = `你是角色设定助手。用户会给出一个角色的名字和（可选的）已有描述或风格。请补全该角色的视觉设定，用于 AI 绘画。
只输出严格 JSON 对象，不要额外文字或代码围栏：
{ "appearance": "外貌特征（发型、五官、身材、肤色等，具象）", "costume": "服装（具象，含颜色与材质）", "personality": "性格/气质关键词（用于画面情绪，逗号分隔）" }
全程使用中文。`;

export function buildCharacterMessages(c: {
  name: string;
  appearance?: string;
  costume?: string;
  personality?: string;
  styleTags?: string[];
  skillName?: string;
}): LLMMessage[] {
  const brief = [
    c.name ? `名字：${c.name}` : "",
    c.appearance ? `已有外貌：${c.appearance}` : "",
    c.costume ? `已有服装：${c.costume}` : "",
    c.personality ? `已有性格：${c.personality}` : "",
    c.styleTags?.length ? `风格标签：${c.styleTags.join("、")}` : "",
    c.skillName ? `艺术风格：${c.skillName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: CHARACTER_SYSTEM },
    { role: "user", content: brief || "请帮我设计一个原创角色" },
  ];
}

export interface RawCharacter {
  appearance: string;
  costume: string;
  personality: string;
}

export function parseCharacter(text: string): RawCharacter {
  const o = (extractJson(text) as Record<string, unknown>) ?? {};
  return {
    appearance: o.appearance ? String(o.appearance) : "",
    costume: o.costume ? String(o.costume) : "",
    personality: o.personality ? String(o.personality) : "",
  };
}

// Generate a full character card from a one-line brief.
export const CHARACTER_FROM_BRIEF_SYSTEM = `你是角色设定助手。用户会给一句角色设定或灵感，请生成一个完整的、可用于 AI 绘画的视觉角色卡。
只输出严格 JSON 对象，不要额外文字或代码围栏：
{ "name": "角色名", "appearance": "外貌特征（发型、五官、身材、肤色等，具象）", "costume": "服装（具象，含颜色与材质）", "personality": "性格/气质关键词（逗号分隔）" }
全程使用中文。`;

export function buildCharacterFromBriefMessages(brief: string): LLMMessage[] {
  return [
    { role: "system", content: CHARACTER_FROM_BRIEF_SYSTEM },
    { role: "user", content: brief },
  ];
}

export interface RawCharacterFull extends RawCharacter {
  name: string;
}

export function parseCharacterFull(text: string): RawCharacterFull {
  const o = (extractJson(text) as Record<string, unknown>) ?? {};
  return {
    name: o.name ? String(o.name) : "未命名角色",
    appearance: o.appearance ? String(o.appearance) : "",
    costume: o.costume ? String(o.costume) : "",
    personality: o.personality ? String(o.personality) : "",
  };
}

// ─────────────────────────────────────────────────────────────
// Storyboard planning
// ─────────────────────────────────────────────────────────────
const SHOT_TYPES: ShotType[] = [
  "extreme_wide",
  "wide",
  "full",
  "medium",
  "close",
  "extreme_close",
  "poi",
  "pod",
];

export const STORYBOARD_SYSTEM = `你是分镜师。给定一个场景描述和可选的角色名单、艺术风格，请把它拆成若干个镜头。
只输出严格 JSON 数组，不要额外文字或代码围栏。每个元素：
{ "shotType": "景别，取值之一：${SHOT_TYPES.join(" / ")}", "description": "该镜头画面描述（具象，含角色动作）", "characterNames": ["出场角色名，取自给定名单，可空数组"] }
镜头数 2-5，景别要有变化。全程使用中文。`;

export function buildStoryboardMessages(
  scene: Pick<Scene, "heading" | "location" | "time" | "action" | "dialogue">,
  characterNames: string[],
  styleName?: string
): LLMMessage[] {
  const user = `艺术风格：${styleName || "默认"}
可选角色名单：${characterNames.join("、") || "（无）"}

场景：
标题：${scene.heading}
地点：${scene.location}
时间：${scene.time}
画面：${scene.action}
台词：${scene.dialogue}`;
  return [
    { role: "system", content: STORYBOARD_SYSTEM },
    { role: "user", content: user },
  ];
}

export interface RawShot {
  shotType: ShotType;
  description: string;
  characterNames: string[];
}

export function parseStoryboard(text: string): RawShot[] {
  const data = extractJsonArray(text);
  return data.map((d) => {
    const o = (d ?? {}) as Record<string, unknown>;
    const st = String(o.shotType ?? "medium") as ShotType;
    return {
      shotType: (SHOT_TYPES.includes(st) ? st : "medium") as ShotType,
      description: String(o.description ?? ""),
      characterNames: Array.isArray(o.characterNames)
        ? (o.characterNames as unknown[]).map(String)
        : [],
    };
  });
}
