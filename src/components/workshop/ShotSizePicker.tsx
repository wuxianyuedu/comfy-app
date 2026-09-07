"use client";

/** 镜头生图「比例 + 像素 + 对齐」三段选择器。
 *
 *  复用画布 IO 表单的 MultiSegmentPopover（比例 / 清晰度 / 对齐倍数），
 *  换算与摘要逻辑全部在 shot-size-config.ts（纯函数），本组件只做
 *  props → 弹层段落 的映射与选中态回显。 */

import { useMemo } from "react";

import {
  DIM_CLARITY_PRESETS,
  DIM_RATIO_PRESETS,
  DEFAULT_ALIGN_MULTIPLE,
} from "~/components/studio/shared/workflow-io";
import {
  MultiSegmentPopover,
  RatioIcon,
  shortRatioLabel,
  type SegmentSection,
} from "~/components/studio/shared/MultiSegmentPopover";
import { AlignMultipleStepper } from "~/components/studio/shared/AlignMultipleStepper";
import {
  normalizeShotSize,
  shotSizeSummary,
  type ShotSizeState,
} from "./shot-size-config";

export function ShotSizePicker({
  value,
  onChange,
  disabled,
}: {
  value: ShotSizeState;
  onChange: (next: ShotSizeState) => void;
  disabled?: boolean;
}) {
  const state = useMemo(() => normalizeShotSize(value), [value]);

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
      footer={
        <AlignMultipleStepper
          value={state.align}
          onChange={(align) => onChange({ ...state, align })}
          disabled={disabled}
        />
      }
    />
  );
}

export { DEFAULT_ALIGN_MULTIPLE };
