/**
 * 角色脸库的纯函数出口（规范 17 §17.2 ①配置层：常量 + 纯派生函数，无 React / 副作用）。
 *
 * 预设数据按美术分类拆成 5 个静态文件（脸型眼型 / 表情瞳色 / 发型 / 气质题材 / 代表形象，
 * 共 108 条），避免单文件超长；本文件只做汇总与搜索 / 拼接。
 * 用词与 `workshop/character-options.ts`、`character/tag-extract.ts` 的受控词表一致，
 * 不另造第二套；新增一种脸只在对应数据文件加一条。
 */
import {
  PORTRAIT_NEGATIVE_PROMPT,
  PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE,
} from "~/lib/character/portrait-prompt";
import { matchesNeedle, normalizeNeedle } from "~/lib/list-filter";

import { facePresetsExpression } from "./face-presets-expression";
import { facePresetsFeatures } from "./face-presets-features";
import { facePresetsHair } from "./face-presets-hair";
import { facePresetsPersona } from "./face-presets-persona";
import { facePresetsSignature } from "./face-presets-signature";

export type { FacePreset } from "./face-preset-types";
import type { FacePreset } from "./face-preset-types";

/** 脸部特写的统一前缀（与立绘全身像的 PORTRAIT_SUFFIX 分工不同，各留各的）。 */
export const FACE_CLOSEUP_PREFIX = "anime character face close-up, detailed facial features,";

/** 全部分类预设（108 条；分类文件自身保序，汇总顺序即界面顺序）。 */
export const FACE_PRESETS: ReadonlyArray<FacePreset> = [
  ...facePresetsSignature,
  ...facePresetsFeatures,
  ...facePresetsExpression,
  ...facePresetsHair,
  ...facePresetsPersona,
];

/** 按 id 找预设；id 为空或不存在都返回 null。 */
export function findFacePreset(id: string): FacePreset | null {
  return FACE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** 搜索：名字 / 说明 / 标签 / 提示词任一命中（大小写不敏感，归一化走唯一出口）。 */
export function searchFacePresets(
  query: string,
  presets: ReadonlyArray<FacePreset>,
): Array<FacePreset> {
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

/** 一条可直接复制 / 直接送进 T2I 的正向提示词（复用立绘的「无文字」正向约束）。 */
export function buildFacePrompt(preset: FacePreset): string {
  return [FACE_CLOSEUP_PREFIX, preset.prompt, PORTRAIT_TEXT_CONSTRAINT_AS_POSITIVE].join(", ");
}

/** 负向词沿用立绘唯一口径（刻意不含「文字」，避免连服饰装饰字一起禁掉）。 */
export function buildFaceNegative(): string {
  return PORTRAIT_NEGATIVE_PROMPT;
}
