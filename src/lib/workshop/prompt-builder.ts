import type { Character, Shot, Scene, StyleRef } from "./types";

/**
 * Build a ComfyUI positive prompt for a character from its sheet + style.
 */
export function buildCharacterPrompt(c: Character, style?: StyleRef): string {
  const parts: string[] = [];

  // Core identity
  const identity = [c.ageGender, c.appearance, c.costume]
    .filter(Boolean)
    .join(", ");
  if (identity) parts.push(identity);

  // Personality / temperament as mood keywords
  const mood = [c.personality, c.temperament].filter(Boolean).join(", ");
  if (mood) parts.push(`mood: ${mood}`);

  // Style tags
  if (c.styleTags.length) parts.push(c.styleTags.join(", "));

  // Linked skill template (acts as art-direction wrapper)
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

/** Build a storyboard shot prompt from scene + characters + style */
export function buildShotPrompt(
  shot: Pick<Shot, "description" | "shotType">,
  scene: Scene | undefined,
  characters: Character[],
  style?: StyleRef,
): string {
  const parts: string[] = [];

  // Shot composition keyword
  const shotKw = SHOT_KEYWORDS[shot.shotType] ?? "";
  if (shotKw) parts.push(shotKw);

  // Scene atmosphere
  if (scene) {
    const sceneBits = [scene.location, scene.time, scene.action]
      .filter(Boolean)
      .join(", ");
    if (sceneBits) parts.push(sceneBits);
  }

  // Shot-specific description
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

/** Merge recommended params from style + character, character wins ties */
export function mergeParams(
  style?: StyleRef,
  character?: Character,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (style?.defaultParams) Object.assign(out, style.defaultParams);
  if (character?.params) Object.assign(out, character.params);
  return out;
}
