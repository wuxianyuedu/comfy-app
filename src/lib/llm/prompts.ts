import {
  SHOT_TYPES,
  normalizeShotType,
  type ProjectMeta,
  type Scene,
  type ShotType,
} from "~/lib/workshop/types";
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
  idea: string,
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

// 从一句话简介生成一份完整的角色卡。
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
export const STORYBOARD_SYSTEM = `你是分镜师。给定一个场景描述和可选的角色名单、艺术风格，请把它拆成若干个镜头。
只输出严格 JSON 数组，不要额外文字或代码围栏。每个元素：
{ "shotType": "景别，取值之一：${SHOT_TYPES.join(" / ")}", "description": "该镜头画面描述（具象，含角色动作）", "characterNames": ["出场角色名，取自给定名单，可空数组"] }
镜头数 2-5，景别要有变化。全程使用中文。`;

export function buildStoryboardMessages(
  scene: Pick<Scene, "heading" | "location" | "time" | "action" | "dialogue">,
  characterNames: string[],
  styleName?: string,
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
  return data.map((datum) => {
    const obj = (datum ?? {}) as Record<string, unknown>;

    return {
      shotType: normalizeShotType(obj.shotType),

      description: asText(obj.description, ""),

      characterNames: Array.isArray(obj.characterNames)
        ? (obj.characterNames as unknown[]).map(String)
        : [],
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Content review (Phase 8 · P8-1a：文本评审 —— 分镜镜头 / 角色卡)
// ─────────────────────────────────────────────────────────────

/** 评审时的创作上下文（判断内容是否贴合项目意图）。字段都可能是空串，构建时兜底。 */
export interface ContentReviewContext {
  title: string;
  type: string;
  tone: string;
  logline: string;
  /** 剧本节选（判一致性用），已由调用方裁剪长度。 */
  scriptExcerpt: string;
}

export const REVIEW_SYSTEM = `你是严格的 AI 生成内容质检评审。用户会给出创作上下文（项目类型 / 基调 / 梗概 / 剧本节选）与一条待评审内容（分镜镜头或角色卡的文本）。判断它是否合格：
- 画面 / 设定是否**具象、可拍**（不是空泛套话）；
- 是否与剧本、基调、项目意图一致（不跑题、不自相矛盾）；
- 关键信息是否完整（镜头要有明确主体与动作，角色卡要有可视外貌/服装）。
只输出严格 JSON 对象，不要任何解释或代码围栏：
{ "pass": true 或 false, "issues": ["逐条列出具体缺陷，合格则给空数组"], "suggestion": "不合格时给一句话改进方向（合格可留空）" }
全程使用中文，判断从严但务实：能拍、贴合剧本即算合格，不因风格偏好判不合格。`;

/** 组装「评审一条内容」的消息。`kindLabel` 是人读实体名（"分镜镜头" / "角色卡"），
 *  `sourceText` 是该实体的可评审文本（由调用方从记录提炼，纯文本、不含结构）。 */
export function buildReviewMessages(
  kindLabel: string,
  sourceText: string,
  ctx: ContentReviewContext,
): LLMMessage[] {
  const user = `【创作上下文】
项目标题：${ctx.title || "未命名"}
类型：${ctx.type || "未指定"}
基调：${ctx.tone || "未指定"}
梗概：${ctx.logline || "无"}
剧本节选：
${ctx.scriptExcerpt || "（无）"}

【待评审的${kindLabel}】
${sourceText}

请评审这份${kindLabel}是否合格。`;
  return [
    { role: "system", content: REVIEW_SYSTEM },
    { role: "user", content: user },
  ];
}

export const REPROMPT_SYSTEM = `你是提示词改写助手。给定一条镜头的原提示词与评审意见，产出一版**改进后**的镜头画面提示词：保持原意与镜头定位，但具象化、修掉评审指出的缺陷（补主体/动作/光线，去掉含混或跑题的部分），用于 AI 文生图。
只输出严格 JSON 对象，不要任何解释或代码围栏：
{ "prompt": "改进后的镜头提示词（中文，具象、可拍）" }`;

/** 评审意见的最小形状（与 `ReviewVerdict` 结构兼容；这里不 import production 域，避免跨域耦合）。 */
export interface RepromptFeedback {
  issues: string[];
  suggestion: string;
}

/** 组装「据评审意见改写镜头提示词」的消息。`sourceText` 是原提示词 / 画面描述文本。 */
export function buildShotRepromptMessages(
  sourceText: string,
  feedback: RepromptFeedback,
  ctx: ContentReviewContext,
): LLMMessage[] {
  const defects =
    feedback.issues.length > 0
      ? feedback.issues.map((issue) => `- ${issue}`).join("\n")
      : "（未逐条列出）";
  const user = `【创作上下文】
类型：${ctx.type || "未指定"}
基调：${ctx.tone || "未指定"}
剧本节选：
${ctx.scriptExcerpt || "（无）"}

【原镜头提示词】
${sourceText}

【评审指出的缺陷】
${defects}
【改进建议】${feedback.suggestion || "（无）"}

请产出改进后的镜头提示词。`;
  return [
    { role: "system", content: REPROMPT_SYSTEM },
    { role: "user", content: user },
  ];
}
