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
 *  「百万像素」那一组下面还有一条「自定义」步进器（`MegapixelStepper`）——
 *  百万像素在端口上是 FLOAT，档位（1M/2M/4M）之外还要能填 2.5 这类任意值。
 *
 *  弹层脚注给出尺寸表入口（可查看 / 修改各场景 1k/2k/4k 的具体宽高）。
 *
 *  换算与摘要逻辑全部在 shot-size-config.ts（纯函数），本组件只做
 *  props → 弹层段落 的映射与选中态回显。 */

import { useMemo, useState } from "react";

import {
  ALIGN_MULTIPLE_OPTIONS,
  CLARITY_SUBGROUP_LABELS,
  SIZE_CLARITY_PRESETS,
  SIZE_RATIO_PRESETS,
  SIZE_SCENE_LABELS,
  clarityKindOfLabel,
  megapixelLabel,
  megapixelTierOfLabel,
  normalizeAlignMultiple,
  sizeSpecMegapixels,
  type SizeScene,
} from "~/lib/media/size-presets";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/ui/segment-popover";
import { SizePresetTableModal } from "~/components/studio/workflow-form/SizePresetTableModal";
import { MegapixelStepper } from "~/components/studio/workflow-form/MegapixelStepper";
import { Button } from "~/components/ui/button";
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

  /* 步进器的起始值：当前已是百万像素档就用档位值；分辨率档用该档**换算出的
   *  实际总像素** —— 用户点一下 +/- 就从眼前这个值开始调，而不是从 1M 跳一下
   *  （选了 4k 再点 + 却变成 1.1M 是说不通的）。 */
  const currentMegapixels = useMemo(
    () =>
      megapixelTierOfLabel(state.clarity) ?? sizeSpecMegapixels(state, scene),
    [state, scene],
  );

  const sections = useMemo<SegmentSection<string>[]>(() => {
    const list: SegmentSection<string>[] = [
      {
        label: "比例",
        value: state.ratio,
        options: SIZE_RATIO_PRESETS.map((preset) => ({
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
        options: SIZE_CLARITY_PRESETS.map((preset) => ({
          value: preset.label,
          label: preset.label,
          subgroup: CLARITY_SUBGROUP_LABELS[preset.kind],
        })),
        onChange: (clarity) => onChange({ ...state, clarity }),
        /* 百万像素是连续量：档位之外再给一个能填任意值的步进器（挨着它的选项
         *  渲染，属于「百万像素」这一组）。写出去的 label 与档位同形（"2.5M"），
         *  所以换算 / 摘要 / 下发都不需要为「自由值」多认一种形状。 */
        extra: (
          <MegapixelStepper
            value={currentMegapixels}
            disabled={disabled}
            onChange={(megapixels) =>
              onChange({ ...state, clarity: megapixelLabel(megapixels) })
            }
          />
        ),
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
          onChange({
            ...state,
            multiple: normalizeAlignMultiple(Number(multiple)),
          }),
      });
    }
    return list;
  }, [state, onChange, clarityKind, currentMegapixels, disabled]);

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
            <Button
              variant="outline"
              size="xs"
              onClick={() => setTableOpen(true)}
              className="border-border-strong text-ink-muted hover:bg-subtle hover:text-ink-bright text-3xs h-auto rounded-md px-2 py-1"
            >
              尺寸表（{SIZE_SCENE_LABELS[scene]}场景）…
            </Button>
            <span className="text-ink-faint text-3xs">
              {clarityKind === "megapixel"
                ? "总像素预算，宽高按倍数对齐"
                : "宽高按场景尺寸表取值"}
            </span>
          </div>
        }
      />
      {tableOpen && (
        <SizePresetTableModal
          scene={scene}
          onClose={() => setTableOpen(false)}
        />
      )}
    </>
  );
}
