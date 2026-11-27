"use client";

/**
 * `FaceLibrary` — 角色脸库页（ISSUE #5087）。
 *
 * 取数 / 复制 / 生成 / 取消仍在 `hooks/use-face-library`，视图布局与服饰库 / 装饰库
 * 共用 `research/ResearchLibraryView`（不再写第二套逐行重合的页面），本文件只给
 * 脸库自己的文案、分类和 controller 适配（规范 17 §17.2 第④层）。
 */
import {
  ResearchLibraryView,
  type ResearchLibraryViewConfig,
} from "~/components/studio/research/ResearchLibraryView";
import type { ResearchLibraryController } from "~/components/studio/research/hooks/use-research-library";

import { buildFaceNegative, buildFacePrompt, FACE_PRESETS } from "./face-presets";
import type { FacePreset } from "./face-presets";
import { useFaceLibrary } from "./hooks/use-face-library";

const config: ResearchLibraryViewConfig<FacePreset> = {
  buildPrompt: buildFacePrompt,
  category: "character",
  emptyHint: "先勾选至少一张脸",
  footnote: "脸部词库与生图链路都与风格库共用；勾选多张脸即可一次入队批量生成。",
  itemLabel: "脸部形象",
  negative: buildFaceNegative,
  presets: FACE_PRESETS,
  searchPlaceholder: "搜索脸型 / 瞳色 / 气质 / 题材",
  view: "face",
};

export function FaceLibrary() {
  const c = useFaceLibrary();
  const controller: ResearchLibraryController<FacePreset> = {
    cancelOne: c.cancelOne,
    clearAll: c.clearAll,
    copy: c.copy,
    filtered: c.filtered,
    generate: c.generate,
    generating: c.generating,
    modelSelection: c.modelSelection,
    notice: c.notice,
    prompt: c.prompt,
    query: c.query,
    results: c.results,
    selectAll: c.selectAll,
    selectedIds: c.selectedIds,
    selectedPresets: c.selectedPresets,
    setModelSelection: c.setModelSelection,
    setQuery: c.setQuery,
    togglePreset: c.toggleFace,
  };
  return <ResearchLibraryView config={config} controller={controller} />;
}
