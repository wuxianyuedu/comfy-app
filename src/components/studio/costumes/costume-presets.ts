/**
 * 服饰库的纯函数出口（规范 17 §17.2 ①配置层：常量 + 纯派生，无 React / 副作用）。
 *
 * 108 条预设按美术分类拆成 6 个静态文件（中式 / 日韩 / 西式历史 / 现代休闲 /
 * 职业功能 / 奇幻科幻）汇总，规避单文件超长门禁；新增一款只在对应文件加一条。
 */
import {
  buildResearchNegative,
  buildResearchPrompt,
  COSTUME_PREFIX,
  searchResearchPresets,
} from "~/components/studio/research/research-prompt";
import type { ResearchPreset } from "~/components/studio/research/research-preset-types";

import { costumePresetsChina } from "./costume-presets-china";
import { costumePresetsFantasy } from "./costume-presets-fantasy";
import { costumePresetsJapanKorea } from "./costume-presets-japan-korea";
import { costumePresetsModern } from "./costume-presets-modern";
import { costumePresetsProfession } from "./costume-presets-profession";
import { costumePresetsWestern } from "./costume-presets-western";

export type CostumePreset = ResearchPreset;

/** 全部分类预设（108 条；分类文件自身保序，汇总顺序即界面顺序）。 */
export const COSTUME_PRESETS: ReadonlyArray<CostumePreset> = [
  ...costumePresetsChina,
  ...costumePresetsJapanKorea,
  ...costumePresetsWestern,
  ...costumePresetsModern,
  ...costumePresetsProfession,
  ...costumePresetsFantasy,
];

/** 分类名 → 该分类预设（侧栏按分类筛选用）。 */
export const COSTUME_CATEGORIES = ["中式", "日韩", "西式", "现代", "职业", "奇幻"] as const;

export function findCostumePreset(id: string): CostumePreset | null {
  return COSTUME_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function searchCostumePresets(
  query: string,
  presets: ReadonlyArray<CostumePreset> = COSTUME_PRESETS,
): Array<CostumePreset> {
  return searchResearchPresets(query, presets);
}

export function buildCostumePrompt(preset: CostumePreset): string {
  return buildResearchPrompt(COSTUME_PREFIX, preset);
}

export function buildCostumeNegative(): string {
  return buildResearchNegative();
}
