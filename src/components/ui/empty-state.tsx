import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * EmptyState — 空状态占位（**全库唯一实现**，规范 16 §16.2.4）。
 *
 * 为什么合并：此前「空态」有三份并行实现 —— `ui/empty-state.tsx`（居中
 * 虚线卡片）、`studio/ui/EmptyState.tsx`（图标方块 + 警告色 + min-h 变体）、
 * `DynamicWorkflowForm/sections/EmptyStateHint.tsx`（行内小提示条）。props 与
 * 形态都不一样，于是「改一处空态样式」要改三处，且同一句话在三处措辞不同。
 * 现在按**取并集**收敛：
 *
 * - `variant`：`page`（居中虚线卡片，默认）/ `hint`（行内提示条，贴在一个
 *   小区域里说明「这里为什么是空的、下一步做什么」）/ `error`（居中卡片 +
 *   警告色，供「加载失败」复用同一形态，规范 10.5）；
 * - `icon` 收 `LucideIcon` 或已渲染的 `ReactNode`（历史两种调用都有）：
 *   传组件时统一按 `size` 渲染，传节点时原样使用。
 *
 * `variant="page"` 的骨架刻意保持「居中 + 虚线边框 + 标题/说明/操作」，
 * 不让逐页漂移；`hint` 不带图标位，只做一段说明文字。
 */
export type EmptyStateVariant = "page" | "error" | "hint";

export interface EmptyStateProps {
  /** 主文案：一句话说明当前是什么状态（如「未找到匹配的工作流」）。 */
  title?: string;
  /** 补充说明：为什么是空的 / 下一步做什么（规范 10.5）。 */
  description?: ReactNode;
  /** 图标：传 lucide 组件（按 `size` 渲染）或已渲染节点。 */
  icon?: LucideIcon | ReactNode;
  /** 形态（见组件注释）。 */
  variant?: EmptyStateVariant;
  /** 操作区（按钮等），居中渲染在主文案下方。 */
  action?: ReactNode;
  /** `page` 形态的最小高度类，默认 `min-h-[220px]`。 */
  minHeightClass?: string;
  className?: string;
}

/**
 * 图标形参的判据：`React.forwardRef` 产物也带 `$$typeof`，而它同时有 `render`；
 * 已渲染的元素同样是对象 —— 两者靠「有没有 `render`」区分，
 * 这也是 `typeof x === "function"` 接不住 lucide 图标的原因。
 */
function isIconComponent(value: LucideIcon | ReactNode): value is LucideIcon {
  return (
    typeof value === "function" ||
    (typeof value === "object" &&
      value !== null &&
      "render" in value &&
      typeof (value as { render?: unknown }).render === "function")
  );
}

export function EmptyState({
  title,
  description,
  icon,
  variant = "page",
  action,
  minHeightClass = "min-h-[220px]",
  className,
}: EmptyStateProps) {
  if (variant === "hint") {
    return (
      <div
        className={cn(
          "border-border-strong bg-subtle text-ink-soft rounded-lg border border-dashed px-3 py-3 text-[11px] leading-relaxed",
          className,
        )}
      >
        {description ?? title}
      </div>
    );
  }

  const error = variant === "error";
  /* 传节点时原样渲染，传 lucide 组件时按统一尺寸渲染（历史两种调用都有，
   * 取并集才不会逼调用方先看一遍 props）。 */
  let renderedIcon: ReactNode = null;
  if (isIconComponent(icon)) {
    /* 组件形参必须渲染成 `<Icon …/>` 而不是 `{icon}`：lucide 图标是
       `React.forwardRef` 的产物（对象），直接当子节点会被 React 判成
       「非法子节点」并抛错 —— 而它 `typeof` 恰好是 `"object"`，
       `typeof icon === "function"` 的判据接不住它。 */
    const Icon = icon;
    renderedIcon = <Icon size={32} aria-hidden />;
  } else if (icon) {
    renderedIcon = icon;
  }

  return (
    <div
      className={cn(
        "grid place-items-center rounded-2xl border border-dashed px-4 text-center",
        minHeightClass,
        error ? "border-destructive/30" : "border-border",
        className,
      )}
    >
      <div className="max-w-sm">
        {renderedIcon && (
          <span
            className={cn(
              "mx-auto mb-2 block w-fit",
              error ? "text-destructive" : "text-primary",
            )}
          >
            {renderedIcon}
          </span>
        )}
        {title && (
          <p
            className={cn(
              "text-sm font-medium",
              error ? "text-destructive" : "text-ink-strong",
            )}
          >
            {title}
          </p>
        )}
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
