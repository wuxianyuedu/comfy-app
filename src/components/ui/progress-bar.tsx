"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ReactNode } from "react";

import { ProgressTrack } from "~/components/ui/progress";
import { clampPct, pctToWidth } from "~/lib/progress";
import { cn } from "~/lib/utils";

/**
 * ProgressBar —— 「异步动作的进度条」的唯一出口（形态侧，规范 16 §16.2.4.19；基于 `~/components/ui/progress` 二次封装）。`value` 收算好的百分比（0..100），`null` 为不确定态；`minVisible` 把 `0<x<minVisible` 抬到下限，填充因此自绘（base-ui Indicator 不吃这条语义），ARIA 由 `ProgressPrimitive.Root` 给全。
 * 外部 API 向后兼容（`value` / `label` / `showValue` / `className` / `trackClassName` / `fillClassName` / `minVisible`），新增可选 `ariaLabel` 给条上无可见文字的用法；不传时行为与旧版一致。
 * DOM 契约：`data-slot="progress-bar-track"` 挂 base-ui Root（测试读 role / aria-valuenow / aria-valuetext / aria-label），`progress-bar-fill` 与 `progress-bar-indeterminate` 仍是自绘 `<div>`。
 */
export function ProgressBar({
  value,
  label,
  showValue = true,
  className,
  trackClassName,
  fillClassName,
  minVisible,
  ariaLabel,
}: {
  /**
   * 可访问名。只在**条上没有可见文字**时给（如分段健康度：一根细条代表一段
   * 阶段，字都在别处）。可见文案 `label` 不构成命名关系，故两者不互相替代。
   */
  ariaLabel?: string;
  className?: string;
  fillClassName?: string;
  /** 左侧文案。给了才渲染标题行（右侧同时给百分比，`showValue` 控制）。 */
  label?: ReactNode;
  /** 可见下限宽度（%）：`0 < pct < minVisible` 时抬到 minVisible，0 仍为 0。 */
  minVisible?: number;
  /** 是否在标题行右侧显示百分比。不确定态恒不显示。 */
  showValue?: boolean;
  trackClassName?: string;
  /** 0..100；**`null` = 不确定态**（总数未知 / 算不出来）。 */
  value: number | null;
}) {
  const indeterminate = value === null;
  /* 百分比**先夹取再取整**：接口 / SSE 给的数不可信（`-1` / `120`），
   * `aria-valuenow` 与显示文字都该是夹取后的值，不是原始数。base-ui 内部
   * 也会再夹一次（`clamp(value, min, max)`），传夹好的值不改变行为、但让
   * 我们自己那一份 `pct` 与 base-ui 挂的 `aria-valuenow` 完全对齐。 */
  const pct = indeterminate ? null : clampPct(value);
  const width = indeterminate ? 0 : pctToWidth(value, { minVisible });

  return (
    <ProgressPrimitive.Root
      aria-label={ariaLabel}
      aria-valuetext={indeterminate ? "进行中" : undefined}
      className={cn("w-full", className)}
      /* data-slot 沿用「progress-bar-track」这一旧命名挂在 ARIA 宿主上——
       * 不是 shadcn ProgressTrack 的 visual track（那个在下一层）；
       * 之所以不叫 root 是为了让 progress-bar.test.tsx 与 SettingsParts
       * 的 DOM 契约保持不变、`getAttribute("role") === "progressbar"` 的
       * 断点不动。 */
      data-slot="progress-bar-track"
      max={100}
      value={pct}
    >
      {label !== undefined && (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-ink-muted truncate">{label}</span>
          {showValue && !indeterminate && (
            <span className="text-primary shrink-0 font-medium tabular-nums">{pct}%</span>
          )}
        </div>
      )}
      <ProgressTrack
        className={cn("bg-subtle h-1.5 w-full overflow-hidden rounded-full", trackClassName)}
      >
        {indeterminate ? (
          <div
            className={cn("bg-primary h-full w-1/3", fillClassName)}
            data-slot="progress-bar-indeterminate"
            style={{ animation: "progressStripe 1.4s ease-in-out infinite" }}
          />
        ) : (
          <div
            className={cn("bg-primary h-full rounded-full transition-transform", fillClassName)}
            data-slot="progress-bar-fill"
            style={{ transform: `translateX(${width - 100}%)` }}
          />
        )}
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}
