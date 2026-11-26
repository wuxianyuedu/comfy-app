/**
 * 调研页提示词的唯一口径（配置层纯函数，规范 17 §17.2 ①）：
 * 正负词都复用 `lib/character/portrait-prompt` 的立绘口径，不另造第二套；
 * 各页只传自己的「画面前缀」——服饰看全身、装饰看半身特写。
 */
import {
  PORTRAIT_NEGATIVE_PROMPT,
  PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE,
} from "~/lib/character/portrait-prompt";

import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";

import type { ResearchPreset } from "./research-preset-types";

/** 服饰库：全身立绘，重点看衣服的版型 / 材质 / 层次。 */
export const COSTUME_PREFIX = "anime character full body, detailed costume design,";
/** 装饰库：半身特写，重点看配饰的佩戴位置 / 材质 / 细节。 */
export const ACCESSORY_PREFIX = "anime character upper body, detailed accessory close-up,";

/** 拼一条可直接复制 / 送 T2I 的正向词。 */
export function buildResearchPrompt(prefix: string, preset: ResearchPreset): string {
  return [prefix, preset.prompt, PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE].join(", ");
}

/** 负向词沿用立绘唯一口径（刻意不含「文字」，别把服饰 / 配饰上的装饰字一起禁掉）。 */
export function buildResearchNegative(): string {
  return PORTRAIT_NEGATIVE_PROMPT;
}

/** 搜索：名字 / 说明 / 标签 / 提示词任一命中（大小写不敏感，归一化走唯一出口）。 */
export function searchResearchPresets(
  query: string,
  presets: ReadonlyArray<ResearchPreset>,
): Array<ResearchPreset> {
  const needle = normalizeNeedle(query);
  if (needle === "") {
    return [...presets];
  }
  return presets.filter((preset) =>
    matchesNeedle(
      needle,
      [preset.name, preset.description, preset.prompt, ...preset.tags].join(" "),
    ),
  );
}
