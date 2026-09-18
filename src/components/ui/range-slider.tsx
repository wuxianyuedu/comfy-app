"use client";

/* 滑块（range）—— 原先四处各写一份 `<input type="range" className="accent-violet-500">`
 * 加一处自绘渐变的实现，这里是它们的**唯一出口**（规范 16 §16.2.3 同族判据）。
 *
 * 为什么不用 `ui/slider`（base-ui 版）：那是**无原生 input 的复合控件**，
 * 键盘语义、拖动、无障碍全由 base-ui 自己搭，替换现有 `<input type="range">`
 * 等于换掉一套交互与 DOM 结构（快照与既有测试都会跟着动）。本组件的定位是
 * 「把原生 range 的外观收口到语义 token」——只接管取材，不接管行为。
 *
 * 两处刻意的口径：
 * ① **已填充段用 `background` 渐变画，不用 `accent-color`**：`accent-*` 在
 *    WebKit 只染色**轨道已填充部分与滑块**，而这里要的是「条上直接看出取值」
 *    的那条进度（`WorkflowCanvasSettings` 的 SliderRow 此前自绘过同一件事）。
 * ② **两态的轨道/进度色都从 token 现取**：`var()` 在渐变里按当前主题解析，
 *    token 换值（含深浅两态）组件不用改。
 */

import * as React from "react";

import { cn } from "~/lib/utils";

/** 滑块基元的轨道色与已填充色（语义 token，两态各自取值）。 */
const TRACK_COLOR = "var(--color-border)";
const FILL_COLOR = "var(--color-primary-500)";

/** 触发器：`--range-fill` 表示「已填充比例」，由 value / min / max 算出。 */
function fillPercent(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export interface RangeSliderProps extends Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "min" | "max" | "step" | "onChange"
> {
  /** 当前值（受控）。 */
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 取新值（已换算成 number）。 */
  onChange: (value: number) => void;
  /** 轨道额外类名（默认 `h-1`）。 */
  className?: string;
}

export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  className,
  ...props
}: RangeSliderProps) {
  const percent = fillPercent(value, min, max);
  return (
    <input
      {...props}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      style={{
        background: `linear-gradient(to right, ${FILL_COLOR} 0%, ${FILL_COLOR} ${percent}%, ${TRACK_COLOR} ${percent}%, ${TRACK_COLOR} 100%)`,
      }}
      className={cn(
        "h-1 w-full cursor-pointer appearance-none rounded-full outline-none",
        className,
      )}
    />
  );
}
