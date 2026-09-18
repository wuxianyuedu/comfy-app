import type { Character, Shot, Scene, StyleRef } from "./types";

/* 依据角色设定表与风格，拼出这个角色的 ComfyUI 正向提示词。
 */
export function buildCharacterPrompt(c: Character, style?: StyleRef): string {
  const parts: string[] = [];

  // 核心身份特征
  const identity = [c.ageGender, c.appearance, c.costume]
    .filter(Boolean)
    .join(", ");
  if (identity) parts.push(identity);

  // 性格 / 气质，作为氛围关键词
  const mood = [c.personality, c.temperament].filter(Boolean).join(", ");
  if (mood) parts.push(`mood: ${mood}`);

  // 风格标签
  if (c.styleTags.length) parts.push(c.styleTags.join(", "));

  // 关联的技能模板（充当美术指导的外包装）
  if (style?.promptTemplate) {
    parts.push(style.promptTemplate);
  } else if (c.skillSlug && style?.promptTemplate) {
    parts.push(style.promptTemplate);
  }

  return parts.filter(Boolean).join(", ");
}

export function buildCharacterNegative(c: Character, style?: StyleRef): string {
  const base = [
    "ugly",
    "deformed",
    "extra limbs",
    "bad anatomy",
    "blurry",
    "low quality",
    "watermark",
    "text",
  ];
  if (style?.negativePrompt) base.push(style.negativePrompt);
  return base.join(", ");
}

/* 依据场景 + 角色 + 风格，拼出分镜镜头的提示词。 */
export function buildShotPrompt(
  shot: Pick<Shot, "description" | "shotType">,
  scene: Scene | undefined,
  characters: Character[],
  style?: StyleRef,
): string {
  const parts: string[] = [];

  // 镜头构图关键词
  const shotKw = SHOT_KEYWORDS[shot.shotType] ?? "";
  if (shotKw) parts.push(shotKw);

  // 场景氛围
  if (scene) {
    const sceneBits = [scene.location, scene.time, scene.action]
      .filter(Boolean)
      .join(", ");
    if (sceneBits) parts.push(sceneBits);
  }

  // 该镜头特有的描述
  if (shot.description) parts.push(shot.description);

  // Character prompts
  const charPrompts = characters
    .map((character) => buildCharacterPrompt(character, style))
    .filter(Boolean);
  if (charPrompts.length) parts.push(`characters: ${charPrompts.join("; ")}`);

  // Style wrapper
  if (style?.promptTemplate) parts.push(style.promptTemplate);

  return parts.filter(Boolean).join(", ");
}

export function buildShotNegative(
  characters: Character[],
  style?: StyleRef,
): string {
  const neg = [
    "ugly",
    "deformed",
    "bad anatomy",
    "blurry",
    "lowres",
    "watermark",
    "text",
    "extra fingers",
  ];
  characters.forEach((character) => {
    if (character.negativePrompt) neg.push(character.negativePrompt);
  });
  if (style?.negativePrompt) neg.push(style.negativePrompt);
  return Array.from(new Set(neg)).join(", ");
}

const SHOT_KEYWORDS: Record<string, string> = {
  extreme_wide: "extreme wide shot, vast landscape, epic scale",
  wide: "wide shot, full environment",
  full: "full body shot",
  medium: "medium shot, waist-up",
  close: "close-up shot",
  extreme_close: "extreme close-up, detailed face",
  poi: "low angle shot, looking up",
  pod: "high angle shot, looking down",
};

/* 合并风格与角色各自的推荐参数；冲突时以角色为准。 */
export function mergeParams(
  style?: StyleRef,
  character?: Character,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (style?.defaultParams) Object.assign(out, style.defaultParams);
  if (character?.params) Object.assign(out, character.params);
  return out;
}
