"use client";

/** 镜头生图尺寸选择器（比例 + 像素 [+ 倍数]）。
 *
 *  与画布 / 库里的尺寸控件同一套口径（见 `studio/shared/DimensionControl`）：
 *    · 「比例」一段；
 *    · 「像素」一段，下分「分辨率」（1k/2k/4k，宽高按场景查尺寸表）与
 *      「百万像素」（1M/2M/4M）两个子类；
 *    · 选中百万像素时追加「倍数」一段（8/16/32/64）—— 宽高由总像素预算
 *      与这个对齐倍数共同决定，因此它在百万像素档是必选项，不能藏起来。
 *
 *  弹层脚注给出尺寸表入口（可查看 / 修改各场景 1k/2k/4k 的具体宽高）。
 *
 *  换算与摘要逻辑全部在 shot-size-config.ts（纯函数），本组件只做
 *  props → 弹层段落 的映射与选中态回显。 */

import { useMemo, useState } from "react";

import {
  ALIGN_MULTIPLE_OPTIONS,
  SIZE_SCENE_LABELS,
  normalizeAlignMultiple,
  type SizeScene,
} from "~/lib/size-presets";
import {
  CLARITY_SUBGROUP_OF_KIND,
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  clarityKindOfLabel,
} from "~/components/studio/shared/workflow-io";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/studio/shared/MultiSegmentPopover";
import { SizePresetTableModal } from "~/components/studio/shared/SizePresetTableModal";
import { shotSizeSummary, type ShotSizeState } from "./shot-size-config";

export function ShotSizePicker({
  value,
  onChange,
  disabled,
  scene = "image",
}: {
  value: ShotSizeState;
  onChange: (next: ShotSizeState) => void;
  disabled?: boolean;
  /** 尺寸表口径：生图走图片场景，视频走行业标准场景。 */
  scene?: SizeScene;
}) {
  const state = value;
  const [tableOpen, setTableOpen] = useState(false);
  const clarityKind = clarityKindOfLabel(state.clarity);

  const sections = useMemo<SegmentSection<string>[]>(() => {
    const list: SegmentSection<string>[] = [
      {
        label: "比例",
        value: state.ratio,
        options: DIM_RATIO_PRESETS.map((preset) => ({
          value: preset.label,
          label: shortRatioLabel(preset.label),
          render: <RatioIcon ratio={preset.ratio} />,
        })),
        onChange: (ratio) => onChange({ ...state, ratio }),
      },
      {
        label: "像素",
        value: state.clarity,
        /* 子类分组：「分辨率」（查场景表）与「百万像素」（总像素预算）各一行。 */
        options: DIM_CLARITY_PRESETS.map((preset) => ({
          value: preset.label,
          label: preset.label,
          subgroup: CLARITY_SUBGROUP_OF_KIND[preset.kind],
        })),
        onChange: (clarity) => onChange({ ...state, clarity }),
      },
    ];
    /* 倍数只对百万像素档有意义：那一档的宽高由总像素预算 × 对齐倍数共同决定。 */
    if (clarityKind === "megapixel") {
      list.push({
        label: "倍数",
        value: String(state.multiple),
        options: ALIGN_MULTIPLE_OPTIONS.map((option) => ({
          value: String(option),
          label: String(option),
        })),
        onChange: (multiple) =>
          onChange({ ...state, multiple: normalizeAlignMultiple(Number(multiple)) }),
      });
    }
    return list;
  }, [state, onChange, clarityKind]);

  return (
    <>
      <MultiSegmentPopover
        ariaLabel="选择生图比例与像素"
        triggerContent={shotSizeSummary(state)}
        sections={sections}
        align="right"
        disabled={disabled}
        footer={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTableOpen(true)}
              className="rounded-md border border-white/12 px-2 py-1 text-[10px] text-(--color-ink-muted) transition-colors hover:bg-white/6 hover:text-(--color-ink-bright)"
            >
              尺寸表（{SIZE_SCENE_LABELS[scene]}场景）…
            </button>
            <span className="text-[10px] text-(--color-ink-faint)">
              {clarityKind === "megapixel"
                ? "总像素预算，宽高按倍数对齐"
                : "宽高按场景尺寸表取值"}
            </span>
          </div>
        }
      />
      {tableOpen && (
        <SizePresetTableModal scene={scene} onClose={() => setTableOpen(false)} />
      )}
    </>
  );
}
