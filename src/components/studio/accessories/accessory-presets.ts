/**
 * 装饰库的纯函数出口（规范 17 §17.2 ①配置层：常量 + 纯派生，无 React / 副作用）。
 *
 * 108 条预设按佩戴 / 使用场景拆成 6 个静态文件（头饰发饰 / 面饰耳饰 / 颈饰胸饰 /
 * 手饰臂饰 / 腰饰挂件 / 道具特殊）汇总，规避单文件超长门禁；新增一件只在对应
 * 文件加一条。
 */
import {
  ACCESSORY_PREFIX,
  buildResearchNegative,
  buildResearchPrompt,
  searchResearchPresets,
} from "~/components/studio/research/research-prompt";
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

import { accessoryPresetsFace } from "./accessory-presets-face";
import { accessoryPresetsHand } from "./accessory-presets-hand";
import { accessoryPresetsHead } from "./accessory-presets-head";
import { accessoryPresetsNeck } from "./accessory-presets-neck";
import { accessoryPresetsProp } from "./accessory-presets-prop";
import { accessoryPresetsWaist } from "./accessory-presets-waist";

export type AccessoryPreset = ResearchPreset;

/** 全部分类预设（108 条；分类文件自身保序，汇总顺序即界面顺序）。 */
export const ACCESSORY_PRESETS: ReadonlyArray<AccessoryPreset> = [
  ...accessoryPresetsHead,
  ...accessoryPresetsFace,
  ...accessoryPresetsNeck,
  ...accessoryPresetsHand,
  ...accessoryPresetsWaist,
  ...accessoryPresetsProp,
];

export const ACCESSORY_CATEGORIES = ["发饰", "面饰", "颈饰", "手饰", "腰饰", "道具"] as const;

export function findAccessoryPreset(id: string): AccessoryPreset | null {
  return ACCESSORY_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function searchAccessoryPresets(
  query: string,
  presets: ReadonlyArray<AccessoryPreset> = ACCESSORY_PRESETS,
): Array<AccessoryPreset> {
  return searchResearchPresets(query, presets);
}

export function buildAccessoryPrompt(preset: AccessoryPreset): string {
  return buildResearchPrompt(ACCESSORY_PREFIX, preset);
}

export function buildAccessoryNegative(): string {
  return buildResearchNegative();
}
