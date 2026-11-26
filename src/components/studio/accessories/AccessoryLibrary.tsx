"use client";

/**
 * 装饰库页（ISSUE #5126）：108 条角色配饰预设的可搜索提示词库。
 * 与服饰库共用 research 域的视图 / hook / 入库链路，不新造第二套。
 */
import { useResearchLibrary } from "~/components/studio/research/hooks/use-research-library";
import {
  ResearchLibraryView,
  type ResearchLibraryViewConfig,
} from "~/components/studio/research/ResearchLibraryView";
import {
  buildAccessoryNegative,
  buildAccessoryPrompt,
  ACCESSORY_PRESETS,
} from "./accessory-presets";
import type { AccessoryPreset } from "./accessory-presets";

const config: ResearchLibraryViewConfig<AccessoryPreset> = {
  buildPrompt: buildAccessoryPrompt,
  category: "character",
  emptyHint: "先勾选至少一件装饰",
  footnote: "装饰库用于找佩戴位置与材质；勾选多件即可一次入队对比，成品可加入资产库。",
  itemLabel: "装饰",
  negative: buildAccessoryNegative,
  presets: ACCESSORY_PRESETS,
  searchPlaceholder: "搜索发饰 / 面饰 / 颈饰 / 手饰 / 道具",
  view: "accessories",
};

export function AccessoryLibrary() {
  const controller = useResearchLibrary(config);
  return <ResearchLibraryView config={config} controller={controller} />;
}
