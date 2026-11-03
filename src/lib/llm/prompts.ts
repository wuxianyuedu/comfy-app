import {
  SHOT_TYPES,
  normalizeShotType,
  type ProjectMeta,
  type Scene,
  type ShotType,
} from "~/lib/workshop/types";
import type { LLMContentPart, LLMMessage } from "./types";
import { extractJson, extractJsonArray } from "./parse";

// ─────────────────────────────────────────────────────────────
// Script generation
// ─────────────────────────────────────────────────────────────
/** 将未知值安全转字符串：字符串原样返回，对象 JSON 序列化，避免 [object Object]。 */
function asText(v: unknown, fallback = ""): string {
  if (typeof v === "string") {
    return v;
  }
  if (v === undefined || v === null) {
    return fallback;
  }
  if (typeof v === "object") {
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- 对象带 toJSON 返回 undefined 时 JSON.stringify 运行期确实返回 undefined
    return JSON.stringify(v) ?? fallback;
  }
  if (typeof v === "function") {
    return v.name || fallback;
  }
  if (typeof v === "symbol" || typeof v === "bigint") {
    return v.toString();
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return `${v}`;
  }
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
): Array<LLMMessage> {
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
  appearance?: string;
  costume?: string;
  name: string;
  personality?: string;
  skillName?: string;
  styleTags?: Array<string>;
}): Array<LLMMessage> {
  const brief = [
    c.name ? `名字：${c.name}` : "",
    c.appearance !== undefined && c.appearance !== "" ? `已有外貌：${c.appearance}` : "",
    c.costume !== undefined && c.costume !== "" ? `已有服装：${c.costume}` : "",
    c.personality !== undefined && c.personality !== "" ? `已有性格：${c.personality}` : "",
    c.styleTags !== undefined && c.styleTags.length > 0
      ? `风格标签：${c.styleTags.join("、")}`
      : "",
    c.skillName !== undefined && c.skillName !== "" ? `艺术风格：${c.skillName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [
    { role: "system", content: CHARACTER_SYSTEM },
    { role: "user", content: brief || "请帮我设计一个原创角色" },
  ];
}

export type RawCharacter = {
  appearance: string;
  costume: string;
  personality: string;
};

export function parseCharacter(text: string): RawCharacter {
  /* SAFETY: 类型断言已复核 */
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- extractJson 走 JSON.parse，回复是字面量 null 时运行期返回 null，`?? {}` 是唯一防线
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

export function buildCharacterFromBriefMessages(brief: string): Array<LLMMessage> {
  return [
    { role: "system", content: CHARACTER_FROM_BRIEF_SYSTEM },
    { role: "user", content: brief },
  ];
}

export type RawCharacterFull = {
  name: string;
} & RawCharacter;

export function parseCharacterFull(text: string): RawCharacterFull {
  /* SAFETY: 类型断言已复核 */
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- 同上：extractJson 遇 JSON 字面量 null 时返回 null，`?? {}` 是唯一防线
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
  characterNames: Array<string>,
  styleName?: string,
): Array<LLMMessage> {
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

export type RawShot = {
  characterNames: Array<string>;
  description: string;
  shotType: ShotType;
};

export function parseStoryboard(text: string): Array<RawShot> {
  const data = extractJsonArray(text);
  return data.map((datum) => {
    /* SAFETY: 类型断言已复核 */
    const obj = (datum ?? {}) as Record<string, unknown>;

    return {
      shotType: normalizeShotType(obj.shotType),

      description: asText(obj.description, ""),

      /* SAFETY: 类型断言已复核 */
      characterNames: Array.isArray(obj.characterNames)
        ? (obj.characterNames as Array<unknown>).map(String)
        : [],
    };
  });
}

// ─────────────────────────────────────────────────────────────
// Content review (Phase 8 · P8-1a：文本评审 —— 分镜镜头 / 角色卡)
// ─────────────────────────────────────────────────────────────

/** 评审时的创作上下文（判断内容是否贴合项目意图）。字段都可能是空串，构建时兜底。 */
export type ContentReviewContext = {
  logline: string;
  /** 剧本节选（判一致性用），已由调用方裁剪长度。 */
  scriptExcerpt: string;
  title: string;
  tone: string;
  type: string;
};

export const REVIEW_SYSTEM = `你是严格的 AI 生成内容质检评审。用户会给出创作上下文（项目类型 / 基调 / 梗概 / 剧本节选）与一条待评审内容（分镜镜头或角色卡的文本）。判断它是否合格：
- 画面 / 设定是否**具象、可拍**（不是空泛套话）；
- 是否与剧本、基调、项目意图一致（不跑题、不自相矛盾）；
- 关键信息是否完整（镜头要有明确主体与动作，角色卡要有可视外貌/服装）。
只输出严格 JSON 对象，不要任何解释或代码围栏：
{ "pass": true 或 false, "issues": ["逐条列出具体缺陷，合格则给空数组"], "suggestion": "不合格时给一句话改进方向（合格可留空）" }
全程使用中文，判断从严但务实：能拍、贴合剧本即算合格，不因风格偏好判不合格。`;

/**
 * 评分加段（FR-QA-07）：给了 rubric 文本时追加到评审系统提示词之后，要求模型按
 * 维度打分并输出 `scores`。分数与 `pass` 相互独立（低分但勉强可用可 pass=true）。
 * rubric 文本由调用方用 `renderRubricForPrompt` 渲染（本文件不 import production 域，
 * 避免跨域耦合——与 `RepromptFeedback` 同一口径）。
 */
export function scoringAddendum(rubricText: string): string {
  if (!rubricText.trim()) {
    return "";
  }
  return `

另外，按下面的评分量表（rubric）逐维度打分：scores 的键必须用维度 key，每个维度给 1~5 分与一句打分依据。分数与 pass 相互独立——低分但勉强可用仍可 pass=true，每档按锚点描述对号入座。
scores 形状：
{ "scores": { "<维度key>": { "score": 1到5的整数, "note": "打分依据一句话" } } }
【评分量表】
${rubricText}`;
}

/** 组装「评审一条内容」的消息。`kindLabel` 是人读实体名（"分镜镜头" / "角色卡"），
 *  `sourceText` 是该实体的可评审文本（由调用方从记录提炼，纯文本、不含结构）。
 *  `rubricText` 可选：传入时系统提示词追加维度评分要求（FR-QA-07）。 */
export function buildReviewMessages(
  kindLabel: string,
  sourceText: string,
  ctx: ContentReviewContext,
  rubricText?: string,
): Array<LLMMessage> {
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
    {
      role: "system",
      content: REVIEW_SYSTEM + scoringAddendum(rubricText ?? ""),
    },
    { role: "user", content: user },
  ];
}

// ─────────────────────────────────────────────────────────────
// Script review（FR-QA-07 ②：剧本评审 —— production.scriptReview 列）
// ─────────────────────────────────────────────────────────────

export const SCRIPT_REVIEW_SYSTEM = `你是严格的剧本质检评审。用户会给出项目信息（类型 / 基调 / 梗概）与一份完整剧本 Markdown。判断它是否合格：
- 结构：场景齐全、开头-发展-高潮清晰，场景交代可拍；
- 具象：动作 / 画面描述具体可执行，不是空泛套话；
- 一致：贴合项目类型、基调与梗概，不自相矛盾；
- 台词：口语、有信息量、能区分人物。
只输出严格 JSON 对象，不要任何解释或代码围栏：
{ "pass": true 或 false, "issues": ["逐条列出具体缺陷，合格则给空数组"], "suggestion": "不合格时给一句话改进方向（合格可留空）" }
全程使用中文，判断从严但务实：能拍、贴合项目意图即算合格，不因风格偏好判不合格。`;

/** 组装「评审整份剧本」的消息。`sourceText` 是完整剧本 Markdown（调用方裁长）。 */
export function buildScriptReviewMessages(
  sourceText: string,
  ctx: ContentReviewContext,
  rubricText?: string,
): Array<LLMMessage> {
  const user = `【项目信息】
项目标题：${ctx.title || "未命名"}
类型：${ctx.type || "未指定"}
基调：${ctx.tone || "未指定"}
梗概：${ctx.logline || "无"}

【待评审的剧本】
${sourceText || "（空）"}

请评审这份剧本是否合格。`;
  return [
    {
      role: "system",
      content: SCRIPT_REVIEW_SYSTEM + scoringAddendum(rubricText ?? ""),
    },
    { role: "user", content: user },
  ];
}

export const REPROMPT_SYSTEM = `你是提示词改写助手。给定一条镜头的原提示词与评审意见，产出一版**改进后**的镜头画面提示词：保持原意与镜头定位，但具象化、修掉评审指出的缺陷（补主体/动作/光线，去掉含混或跑题的部分），用于 AI 文生图。
只输出严格 JSON 对象，不要任何解释或代码围栏：
{ "prompt": "改进后的镜头提示词（中文，具象、可拍）" }`;

// ─────────────────────────────────────────────────────────────
// Script revision（FR-QA-07 ④ · #2478：剧本定向改写 —— 消费低分维度意见产出新版剧本）
// ─────────────────────────────────────────────────────────────

export const SCRIPT_REVISION_SYSTEM = `你是剧本打磨助手。用户会给出项目信息、一份**当前剧本** Markdown 与一轮评审意见（逐条缺陷、低分维度及其打分依据、总建议）。请产出一版**定向改进后**的完整剧本：
- 只动评审点名的部分：低分维度与逐条缺陷是必改项，其余结构、场次、台词尽量保留原样；
- 打分依据（note）说的是「为什么低分」，改法要对着它来，不要笼统重写；
- 保持剧本 Markdown 格式：「## 场景N · 地点（时间）」场景标题、「Δ 」动作行、「V1 角色名: 台词」台词行；
- 改完的剧本必须仍是完整可拍的成稿，不要输出修改说明。
只输出改写后的剧本 Markdown 正文，不要任何解释、前言或代码围栏。全程使用中文。`;

/**
 * 剧本改写消费的评审意见（与 `ReviewVerdict` 结构兼容；本文件不 import production 域，
 * 避免跨域耦合——与 `RepromptFeedback` 同一口径）。`lowScores` 由调用方从判定里
 * 挑出低分维度（`~/lib/production/review-types` 的 `weakScoreEntries`），按分升序。
 */
export type ScriptRevisionFeedback = {
  issues: Array<string>;
  /** 低分维度：key + 分 + 打分依据；未评分（旧判定）时为空数组。 */
  lowScores: Array<{ key: string; note: string; score: number }>;
  suggestion: string;
};

/** 组装「按评审意见定向改写剧本」的消息。`sourceText` 是完整剧本 Markdown（调用方裁长）。 */
export function buildScriptRevisionMessages(
  sourceText: string,
  feedback: ScriptRevisionFeedback,
  ctx: ContentReviewContext,
): Array<LLMMessage> {
  const defects =
    feedback.issues.length > 0
      ? feedback.issues.map((issue) => `- ${issue}`).join("\n")
      : "（未逐条列出）";
  const lowScores =
    feedback.lowScores.length > 0
      ? feedback.lowScores
          .map((item) => `- ${item.key}：${item.score} 分${item.note ? `（${item.note}）` : ""}`)
          .join("\n")
      : "（本判定未带维度评分）";
  const user = `【项目信息】
项目标题：${ctx.title || "未命名"}
类型：${ctx.type || "未指定"}
基调：${ctx.tone || "未指定"}
梗概：${ctx.logline || "无"}

【当前剧本】
${sourceText || "（空）"}

【评审指出的缺陷】
${defects}
【低分维度】
${lowScores}
【总建议】${feedback.suggestion || "（无）"}

请产出定向改进后的完整剧本。`;
  return [
    { role: "system", content: SCRIPT_REVISION_SYSTEM },
    { role: "user", content: user },
  ];
}

// ─────────────────────────────────────────────────────────────
// Shot image review（P8-2：生图视觉评审 —— 多模态，看图 + 定妆照）
// ─────────────────────────────────────────────────────────────

/**
 * 生图视觉评审系统提示：看一张（或几张）图，对照提示词与角色定妆照给判定。
 * 维度与 `shotImage` rubric 对齐（与提示词对齐 / 角色一致性 / 构图景别 / 画面瑕疵），
 * 但**只看图**——文本提示词的对错由文本评审负责，这里评「图本身对不对题、崩没崩」。
 */
export const SHOT_IMAGE_REVIEW_SYSTEM = `你是严格的 AI 生图质检评审（多模态）。用户会给你一张生成的镜头图（可能还有该镜头出场角色的定妆照作参照），以及该镜头的提示词与景别设定。请**只看图**判断它是否合格：
- 与提示词对齐：画面是否还原了提示词的主体、动作、风格与关键元素；
- 角色一致性：出镜角色是否与定妆照一致（外貌 / 服装 / 发色等）；
- 构图景别：景别是否与设定相符、构图是否合格（主体出框 / 比例失调即不合格）；
- 画面瑕疵：是否有崩坏（手部 / 肢体畸形、多余肢体、可读文字水印、明显模糊）。
只输出严格 JSON 对象，不要任何解释或代码围栏：
{ "pass": true 或 false, "issues": ["逐条列出具体缺陷，合格则给空数组"], "suggestion": "不合格时给一句话改进方向（合格可留空）" }
全程使用中文，判断从严但务实：主题清楚、角色认得出、没崩即可算合格，不因风格偏好判不合格。`;

/** 视觉评审输入：图（镜头图 + 角色定妆照）+ 该镜的文本上下文。 */
export type ShotImageReviewInput = {
  /** 出场角色名（用于角色一致性对照说明）。 */
  characterNames: Array<string>;
  /** 镜头产物图 URL（HTTP / data: base64）。 */
  imageUrl: string;
  /** 该镜出场角色的生效定妆照 URL（可能为空数组）。 */
  portraitUrls: Array<string>;
  /** 镜头提示词（文本评审评它写得好不好，这里只作对照）。 */
  prompt: string;
  /** 景别（如「中景」「特写」）。 */
  shotType: string;
};

/**
 * 组装「看图评审生图」的消息：system = 视觉评审系统提示 + 维度评分加段（rubric）；
 * user = 文本上下文（提示词 / 景别 / 角色名）+ 图块（镜头图 + 定妆照）。多模态内容块
 * 由 `messagesToWire` 按 provider 落地（OpenAI content 数组 / Ollama images）。
 */
export function buildShotImageReviewMessages(
  input: ShotImageReviewInput,
  rubricText?: string,
): Array<LLMMessage> {
  const context = `【镜头设定】
提示词：${input.prompt || "（无）"}
景别：${input.shotType || "未指定"}
出场角色：${input.characterNames.join("、") || "（无）"}

请对照上面的提示词与定妆照，评审这张图是否合格（重点看：对不对题、角色认不认得出、景别对不对、有没有崩）。`;
  const imageParts: Array<LLMContentPart> = [
    { type: "image_url", image_url: { url: input.imageUrl } },
    ...input.portraitUrls
      .filter((url) => url.trim() !== "")
      .map((url) => ({
        /* SAFETY: 类型断言已复核 */
        type: "image_url" as const,
        image_url: { url },
      })),
  ];
  return [
    {
      role: "system",
      content: SHOT_IMAGE_REVIEW_SYSTEM + scoringAddendum(rubricText ?? ""),
    },
    {
      role: "user",
      // 文本上下文在前、图在后：多数多模态模型按「先读文再读图」理解更稳定。
      content: [{ type: "text", text: context }, ...imageParts],
    },
  ];
}

/** 评审意见的最小形状（与 `ReviewVerdict` 结构兼容；这里不 import production 域，避免跨域耦合）。 */
export type RepromptFeedback = {
  issues: Array<string>;
  suggestion: string;
};

/** 组装「据评审意见改写镜头提示词」的消息。`sourceText` 是原提示词 / 画面描述文本。 */
export function buildShotRepromptMessages(
  sourceText: string,
  feedback: RepromptFeedback,
  ctx: ContentReviewContext,
): Array<LLMMessage> {
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
