"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ReactNode } from "react";

import { ProgressTrack } from "~/components/ui/progress";
import { clampPct, pctToWidth } from "~/lib/progress";
import { cn } from "~/lib/utils";

/**
 * ProgressBar —— 「异步动作的进度条」的唯一出口（形态侧）（规范 16 §16.2.4.19；
 * 本次 PR-3 起改为基于 `~/components/ui/progress` 官方基元的二次封装）。
 *
 * 此前全库有 **10 处**各写一遍「track div + 内层 width:X% + 百分比文字」，
 * 写法四派（见 `~/lib/progress` 文件头）。这里收的是**形态**：轨道、填充、
 * 百分比文字、a11y 语义；**数值**怎么算由 `~/lib/progress` 负责。
 *
 * 三种用法：
 *
 * - 确定进度：`<ProgressBar value={toPct(done, total)} label="正在解析节点包" />`
 * - 不确定进度（总数还没算出来，条纹来回滑动）：
 *   `<ProgressBar value={null} label="正在扫描…" />`
 * - 0% 也留一格可见（个别面板的观感选择，显式传）：传**算好的百分比**加
 *   `minVisible={4}`（一般来自 `~/lib/progress` 的 `toPct(done, total)`）。
 *
 * 也就是说 `value` 收的是**算好的百分比**，`minVisible` 给一个可见下限。
 *
 * ## P67 治理（§16.2.3 / §12.18）
 *
 * 此前外层是**手写 `<div role="progressbar">` + 手挂 `aria-valuenow` /
 * `aria-valuemin` / `aria-valuemax` / `aria-valuetext`** 的裸 DOM 拼装
 * （P67 b 判据的锚点形态）。`ui/progress.tsx`（shadcn 官方 Progress）
 * 早已装、却没用上——它的 `ProgressPrimitive.Root` 会**替我们**给全这一
 * 组 ARIA（`role="progressbar"` / 夹取后的 `aria-valuenow` /
 * `aria-valuemin` / `aria-valuemax` 都自动挂），并把 `value: null`
 * 直接映射为 indeterminate（`aria-valuenow` 自然被 omit）。所以：
 *
 *   · **外层**换成 `ProgressPrimitive.Root`（base-ui 直连，与项目 shadcn
 *     `ui/progress.tsx` 内部同款）；
 *   · **视觉轨道**用 shadcn `ProgressTrack`（是 base-ui `Progress.Track`
 *     的薄 cva），`trackClassName` 走 cn 覆盖项目档色板；
 *   · **填充**仍由本件自绘 `<div data-slot="progress-bar-fill">` +
 *     手算 `pctToWidth(value, {minVisible})`：base-ui 的 Indicator 只
 *     按 `percentageValue` 直接给宽、不吃 `minVisible` 语义（「0 恒
 *     为 0、0<x<minVisible 抬到 minVisible」是本档项目的观感选择）——
 *     这是**正当差值**，符合 §12.18「有等价就 import，缺的差异用参数
 *     或薄封装补」。基元的 Track 是容器、Indicator 是可选子件，塞自己
 *     画的 fill div 不违语义。
 *
 * **外部 API 完全不变**（`value` / `label` / `showValue` / `className`
 * / `trackClassName` / `fillClassName` / `minVisible`）——15 处消费点
 * （`FilmStudio` / `WorkshopHeader` / `WorkshopEncapsulationPanel` /
 * `TrainingStudio` / `CanvasProgressIndicator` 等）零改动。
 *
 * ## DOM 契约（回归测试锁的形状）
 *
 *   · `data-slot="progress-bar-track"` 挂在 base-ui Root 上（与旧实现
 *     同名，测试继续拿它读 role/aria-valuenow/aria-valuetext）；
 *   · `data-slot="progress-bar-fill"` 与 `data-slot="progress-bar-indeterminate"`
 *     仍在原位置（本件自绘的两个 `<div>`）；
 *   · 视觉轨道 `<ProgressTrack>` 挂 `data-slot="progress-track"`（shadcn
 *     ProgressTrack 自带、无测试依赖）。
 */
export function ProgressBar({
  value,
  label,
  showValue = true,
  className,
  trackClassName,
  fillClassName,
  minVisible,
}: {
  /** 0..100；**`null` = 不确定态**（总数未知 / 算不出来）。 */
  value: number | null;
  /** 左侧文案。给了才渲染标题行（右侧同时给百分比，`showValue` 控制）。 */
  label?: ReactNode;
  /** 是否在标题行右侧显示百分比。不确定态恒不显示。 */
  showValue?: boolean;
  className?: string;
  trackClassName?: string;
  fillClassName?: string;
  /** 可见下限宽度（%）：`0 < pct < minVisible` 时抬到 minVisible，0 仍为 0。 */
  minVisible?: number;
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
      value={pct}
      max={100}
      /* data-slot 沿用「progress-bar-track」这一旧命名挂在 ARIA 宿主上——
       * 不是 shadcn ProgressTrack 的 visual track（那个在下一层）；
       * 之所以不叫 root 是为了让 progress-bar.test.tsx 与 SettingsParts
       * 的 DOM 契约保持不变、`getAttribute("role") === "progressbar"` 的
       * 断点不动。 */
      data-slot="progress-bar-track"
      className={cn("w-full", className)}
      aria-valuetext={indeterminate ? "进行中" : undefined}
    >
      {label !== undefined && (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
          <span className="text-ink-muted truncate">{label}</span>
          {showValue && !indeterminate && (
            <span className="text-primary shrink-0 font-medium tabular-nums">
              {pct}%
            </span>
          )}
        </div>
      )}
      <ProgressTrack
        className={cn(
          "bg-subtle h-1.5 w-full overflow-hidden rounded-full",
          trackClassName,
        )}
      >
        {indeterminate ? (
          <div
            data-slot="progress-bar-indeterminate"
            className={cn("bg-primary h-full w-1/3", fillClassName)}
            style={{ animation: "progressStripe 1.4s ease-in-out infinite" }}
          />
        ) : (
          <div
            data-slot="progress-bar-fill"
            className={cn(
              "bg-primary h-full rounded-full transition-transform",
              fillClassName,
            )}
            style={{ transform: `translateX(${width - 100}%)` }}
          />
        )}
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}
