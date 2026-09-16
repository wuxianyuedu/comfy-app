"use client";

/**
 * 通用空态视图（规范 17 §17.2 第③层：纯展示，props + ui 原语，无 IO）。
 *
 * 规范 10.5 要求空态必须说清「为什么是空的」+「下一步做什么」；
 * 此前每个列表各写一份内联空态，措辞与形态各异，且「加载中」与「空」的
 * 区分靠各处自己记得加——漏掉一处就退化成「有问题的空列表看起来和正常
 * 空列表一模一样」。这里把它收成一个组件：
 *   - `variant="error"` 时用警告色，供「加载失败」复用同一套形态；
 *   - 居中 + 虚线边框的骨架保持一致，避免逐页漂移。
 */

import { AlertTriangle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** 主文案：一句话说明当前是什么状态（如「未找到匹配的工作流」）。 */
  title: string;
  /** 补充说明：为什么是空的 / 下一步做什么（规范 10.5）。 */
  description?: ReactNode;
  /** 图标；省略时不渲染图标位。 */
  icon?: LucideIcon;
  /** 图标色调，默认暗色；失败态传 "warning"。 */
  tone?: "muted" | "warning";
  /** 操作区（按钮等），居中渲染在主文案下方。 */
  action?: ReactNode;
  /** 最小高度类，默认 min-h-[220px]（列表区）。 */
  minHeightClass?: string;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  tone = "muted",
  action,
  minHeightClass = "min-h-[220px]",
  className = "",
}: EmptyStateProps) {
  const warning = tone === "warning";
  return (
    <div
      className={`grid ${minHeightClass} place-items-center rounded-2xl border border-dashed px-4 text-center ${
        warning ? "border-amber-500/30" : "border-border"
      } ${className}`}
    >
      <div className="max-w-sm">
        {Icon && (
          <Icon
            size={32}
            aria-hidden
            className={`mx-auto mb-2 ${
              warning
                ? "text-amber-600 dark:text-amber-500/80"
                : "text-ink-faint"
            }`}
          />
        )}
        <p
          className={`text-sm font-medium ${
            warning ? "text-amber-700 dark:text-amber-600" : "text-ink-strong"
          }`}
        >
          {title}
        </p>
        {description && (
          <p className="text-ink-muted mt-1 text-xs leading-relaxed">
            {description}
          </p>
        )}
        {action && (
          <div className="mt-3 flex justify-center gap-2">{action}</div>
        )}
      </div>
    </div>
  );
}

/** 空态与失败态共用的图标（`AlertTriangle` 在这里转出去，避免各页各 import lucide）。 */
export { AlertTriangle };
