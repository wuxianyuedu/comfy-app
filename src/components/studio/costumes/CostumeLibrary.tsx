"use client";

/**
 * 服饰库页（ISSUE #5125）：108 条动漫服饰预设的可搜索提示词库。
 * 取数 / 生图 / 入库全部走 research 域共用实现，本页只给文案与分类。
 */
import { useResearchLibrary } from "~/components/studio/research/hooks/use-research-library";
import {
  ResearchLibraryView,
  type ResearchLibraryViewConfig,
} from "~/components/studio/research/ResearchLibraryView";
import type { CostumePreset } from "./costume-presets";
import { buildCostumeNegative, buildCostumePrompt, COSTUME_PRESETS } from "./costume-presets";

const config: ResearchLibraryViewConfig<CostumePreset> = {
  buildPrompt: buildCostumePrompt,
  category: "character",
  emptyHint: "先勾选至少一件服饰",
  footnote: "服饰库用于找版型与材质；勾选多件即可一次入队对比，成品可加入资产库。",
  itemLabel: "服饰",
  negative: buildCostumeNegative,
  presets: COSTUME_PRESETS,
  searchPlaceholder: "搜索中式 / 日韩 / 职业 / 奇幻服饰",
  view: "costumes",
};

export function CostumeLibrary() {
  const controller = useResearchLibrary(config);
  return <ResearchLibraryView config={config} controller={controller} />;
}
