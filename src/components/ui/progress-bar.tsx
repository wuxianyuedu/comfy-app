"use client";

import type { ReactNode } from "react";

import { clampPct, pctToWidth } from "~/lib/progress";
import { cn } from "~/lib/utils";

/**
 * ProgressBar —— 「异步动作的进度条」的唯一出口（形态侧）（规范 16 §16.2.4.19）。
 *
 * 此前全库有 **10 处**各写一遍「track div + 内层 width:X% + 百分比文字」，
 * 写法四派（见 `~/lib/progress` 文件头）。这里收的是**形态**：
 * 轨道、填充、百分比文字、a11y 语义；**数值**怎么算由 `~/lib/progress` 负责。
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
 * 三条口径：
 *
 * 1. **`value === null` 是不确定态**，不是 0 —— 用 `progressStripe` 动画的
 *    滑动条纹表示「在跑，但不知道还剩多少」。此前 `ParseProgressBanner`
 *    手写了这条动画；其余各处的初态一律画成 0%，看起来像「卡住没动」。
 * 2. **百分比文字与 a11y 语义由本组件给出**，不在调用处各写一份 ——
 *    收口前 10 处里**只有 2 处**声明了 `role="progressbar"` 与
 *    `aria-valuenow`，其余 8 处对读屏器完全不可见。
 * 3. **填充的观感差异走 `fillClassName`**（品牌实心 / 渐变），不由调用处
 *    重画 track —— 换主题时轨道色只有一处。
 *
 * 宽度下限见 `~/lib/progress` 的 `pctToWidth`：**0 恒为 0**，
 * `minVisible` 只抬「刚开始但还没到一格」的那一段。
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
   * `aria-valuenow` 与显示文字都该是夹取后的值，不是原始数。 */
  const pct = indeterminate ? 0 : clampPct(value);
  const width = indeterminate ? 0 : pctToWidth(value, { minVisible });

  return (
    <div className={cn("w-full", className)}>
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
      <div
        data-slot="progress-bar-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(indeterminate
          ? { "aria-valuetext": "进行中" }
          : { "aria-valuenow": pct })}
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
              "bg-primary h-full rounded-full transition-all",
              fillClassName,
            )}
            style={{ width: `${width}%` }}
          />
        )}
      </div>
    </div>
  );
}
