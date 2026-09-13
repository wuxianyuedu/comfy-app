"use client";

/** 镜头生图「比例 + 像素」两段选择器。
 *
 *  复用画布 IO 表单的 MultiSegmentPopover（比例 / 清晰度），换算与摘要逻辑
 *  全部在 shot-size-config.ts（纯函数），本组件只做 props → 弹层段落 的映射
 *  与选中态回显。
 *
 *  没有「对齐倍数」段落：倍数只影响 W/H 吸附到哪个网格（ComfyUI 常用 64），
 *  不是用户要决策的东西 —— 固定用 `DEFAULT_ALIGN_MULTIPLE`。 */

import { useMemo } from "react";

import {
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
} from "~/components/studio/shared/workflow-io";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/studio/shared/MultiSegmentPopover";
import { shotSizeSummary, type ShotSizeState } from "./shot-size-config";

export function ShotSizePicker({
  value,
  onChange,
  disabled,
}: {
  value: ShotSizeState;
  onChange: (next: ShotSizeState) => void;
  disabled?: boolean;
}) {
  const state = value;

  const sections = useMemo<SegmentSection<string>[]>(
    () => [
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
        options: DIM_CLARITY_PRESETS.map((preset) => ({
          value: preset.label,
          label: preset.label,
          subgroup: preset.kind === "megapixel" ? "百万像素" : "像素",
        })),
        onChange: (clarity) => onChange({ ...state, clarity }),
      },
    ],
    [state, onChange],
  );

  return (
    <MultiSegmentPopover
      ariaLabel="选择生图比例与像素"
      triggerContent={shotSizeSummary(state)}
      sections={sections}
      align="right"
      disabled={disabled}
    />
  );
}
