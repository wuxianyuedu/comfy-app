"use client";

/* 百万像素自由值步进器 —— 档位之外自己填一个值。「百万像素」在端口上是连续量（FLOAT），
 * 1M/2M/4M 只是常用档位，用户要 2.5 这种值时档位按钮给不了，这个控件直接写一个数。
 * 值统一写成 `<数值>M`（与档位标签同形状，见 lib/size-presets 的 megapixelLabel/parseMegapixelLabel），
 * 于是自由值与档位在存储上是同一种东西，消费端无需多一条分支。
 * 工坊尺寸选择器与工作流表单共用这一个实现，否则两处会在步进量/上限/小数位分叉。 */

import { NumberField } from "~/components/ui/number-field";
import { MAX_SIZE } from "~/lib/media/size-presets";

/** 步进量 0.1M ≈ 10 万像素 —— 比宽高网格（对齐倍数最小 8，即 64 像素）能分辨的
 *  差异还细一档，所以 +/- 的粒度不会成为精度瓶颈；要更细直接在框里打字。 */
export const MEGAPIXEL_STEP = 0.1;
/** 下限 0.1M（约 316×316）。 */
export const MEGAPIXEL_MIN = 0.1;
/** 上限由尺寸上界反推（`MAX_SIZE` 的平方，≈16.78M）：再大没有意义 —— 宽高会被
 *  `snapSize` 钳到 4096，用户看到的是「填了没生效」。 */
export const MEGAPIXEL_MAX = (MAX_SIZE * MAX_SIZE) / 1_000_000;
/** 显示小数位：1 位（与步进量同档），避免 1.024 这类长尾把框撑开。 */
const MEGAPIXEL_DECIMALS = 1;

export function MegapixelStepper({
  value,
  onChange,
  disabled = false,
  className,
}: {
  className?: string;
  disabled?: boolean;
  /** 用新的（已 clamp 的）百万像素值调用。 */
  onChange: (megapixels: number) => void;
  /** 当前百万像素值。 */
  value: number;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 ${className ?? ""}`}
      /* 与同一块控件里的宽/高 `NumberField` 区分开（它们的步进按钮 title 长得
         一样，按 title 查会同时命中三个）。 */
      data-testid="megapixel-stepper"
    >
      <span className="text-ink-faint text-3xs shrink-0">自定义</span>
      <NumberField
        className="h-6 w-26"
        decimalPlaces={MEGAPIXEL_DECIMALS}
        disabled={disabled}
        max={MEGAPIXEL_MAX}
        min={MEGAPIXEL_MIN}
        onChange={onChange}
        step={MEGAPIXEL_STEP}
        value={value}
      />
      <span className="text-ink-faint text-3xs shrink-0">M</span>
    </div>
  );
}
