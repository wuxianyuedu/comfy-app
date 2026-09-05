import type { ProjectMeta, Scene, ShotType } from "@/lib/workshop/types";
import { PROJECT_TYPE_LABELS } from "@/lib/workshop/types";
import type { LLMMessage } from "./types";
import { extractJson, extractJsonArray } from "./parse";

// ─────────────────────────────────────────────────────────────
// Script generation
// ─────────────────────────────────────────────────────────────
/** 将未知值安全转字符串：字符串原样返回，对象 JSON 序列化，避免 [object Object]。 */
function asText(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return fallback;
  if (typeof v === "object") return JSON.stringify(v) ?? fallback;
  if (typeof v === "function") return v.name || fallback;
  if (typeof v === "symbol" || typeof v === "bigint") return v.toString();
  if (typeof v === "number" || typeof v === "boolean") return `${v}`;
  return fallback;
}

/** 剧本工具「AI 生成剧本」系统提示:直接产出剧本 Markdown(不再是 JSON 场景数组)。 */
export const SCRIPT_MD_SYSTEM = `你是一位专业影视编剧助手。用户会提供项目信息（类型、基调、梗概）和一段灵感或粗稿。请直接写出一份完整的剧本 Markdown。
要求：
- 只输出剧本 Markdown 正文，不要任何解释、前言或代码围栏。
- 用「## 场景N · 地点（时间）」作为场景标题（内/外景可写在标题里）。
- 动作/画面描述用「Δ 」开头逐条列出；台词/旁白用「V1 角色名: 台词」格式（V 后为镜内序号）。
- 剧本篇幅与场景数量随素材合理展开（一般 2-6 个场景），开头-发展-高潮结构清晰。
- 全程使用中文，人物与动作要具体、可拍。`;

export function buildScriptMarkdownMessages(
  meta: Pick<ProjectMeta, "type" | "tone" | "logline">,
  idea: string
): LLMMessage[] {
  const user = `项目类型：${meta.type}
基调/情绪：${meta.tone || "未指定"}
一句话梗概：${meta.logline || "无"}
灵感/粗稿：
${idea}`;
  return [
    { role: "system", content: SCRIPT_MD_SYSTEM },
    { role: "user", content: user },
  ];
}

/** 模板生成（离线）：把灵感/粗稿按固定模板拼成可编辑的剧本骨架，不调用模型。 */
export function buildScriptTemplate(
  meta: Pick<ProjectMeta, "type" | "tone" | "logline">,
  idea: string
): string {
  const metaLines = [
    meta.tone?.trim() ? `- 基调：${meta.tone.trim()}` : "",
    meta.type ? `- 类型：${PROJECT_TYPE_LABELS[meta.type] ?? meta.type}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    `# 剧本草稿`,
    metaLines,
    "",
    idea.trim(),
    "",
    "## 场景1 · 未命名地点（未定时间）",
    "（待补充：内/外景、地点与时间）",
    "",
    "Δ （在此描述第一个画面/动作）",
    "",
    "V1 角色名: （在此填写台词或旁白）",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();
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

  const obj = (extractJson(text) as Record<string, unknown>) ?? {};

  return {

    appearance: asText(obj.appearance),

    costume: asText(obj.costume),

    personality: asText(obj.personality),

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

  const obj = (extractJson(text) as Record<string, unknown>) ?? {};

  return {

    name: asText(obj.name, "未命名角色"),

    appearance: asText(obj.appearance),

    costume: asText(obj.costume),

    personality: asText(obj.personality),

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
  const user = `艺术风格：${styleName ?? "默认"}
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
  return data.map((datum) =>
{

    const obj = (datum ?? {}) as Record<string, unknown>;

    const st = asText(obj.shotType, "medium") as ShotType;

    return {

      shotType: (SHOT_TYPES.includes(st) ? st : "medium"),

      description: asText(obj.description, ""),

      characterNames: Array.isArray(obj.characterNames)

        ? (obj.characterNames as unknown[]).map(String)

        : [],

    };

  });

}
