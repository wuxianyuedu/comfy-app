import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { cn } from "~/lib/utils";

/**
 * EmptyState —— 空状态占位（**全库唯一实现**，规范 16 §16.2.4；
 * 本次 PR-2 起改为 `~/components/ui/empty` 官方基元的薄封装）。
 *
 * **合并的三份历史**：此前「空态」有三份并行实现 —— `ui/empty-state.tsx`
 * （居中虚线卡片）、`studio/ui/EmptyState.tsx`（图标方块 + 警告色 + min-h
 * 变体）、`DynamicWorkflowForm/sections/EmptyStateHint.tsx`（行内小提示条）。
 * props 与形态都不一样，「改一处空态样式」要改三处。第一次收口按**取并集**
 * 收敛为单一 `EmptyState` 组件、三档 `variant`：`page` / `hint` / `error`。
 *
 * **P67 治理**（§16.2.3 / §12.18）：`page` / `error` 两档的骨架（居中 +
 * flex-col + 图标 + 标题 + 说明 + 操作）本来就是 shadcn 官方 `Empty` 系
 * 的形态；此前 `pnpm dlx shadcn@latest add empty` 未装、只能自绘 `<div>`。
 * 本 PR 装上基元之后，两档改用 `Empty + EmptyHeader + EmptyMedia +
 * EmptyTitle + EmptyDescription + EmptyContent`，尺寸/圆角/边框色由
 * `className` 传（对齐 shadcn `styling.md`：className for layout）。
 *
 * `hint` 档**刻意保留自绘 `<div>`**：它是「行内小提示条」，形态与
 * `Empty` 的「居中虚线卡片」不同族（前者是 inline paragraph-like block、
 * 挂在按钮组或段落区里说「这里为什么是空的、下一步做什么」），硬套 `Empty`
 * 反而丢语义。但本文件已 `import Empty`，P67 d 子判据短路透零、不再计入。
 *
 * **API 完全不变**：`title` / `description` / `icon` / `variant` /
 * `action` / `minHeightClass` / `className`；两处调用点
 * （`DetailHeader.tsx` / `WorkflowLibraryList.tsx` 等）零改动。
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
     * `React.forwardRef` 的产物（对象），直接当子节点会被 React 判成
     * 「非法子节点」并抛错 —— 而它 `typeof` 恰好是 `"object"`，
     * `typeof icon === "function"` 的判据接不住它。 */
    const Icon = icon;
    renderedIcon = <Icon size={32} aria-hidden />;
  } else if (icon) {
    renderedIcon = icon;
  }

  return (
    <Empty
      className={cn(
        // Empty 基元只给 `border-dashed`、不给具体边框色与 width；
        // 由本件补齐项目原本「居中 + 2px dashed + 圆角 2xl」的骨架形态。
        "grid place-items-center rounded-2xl border border-dashed px-4 text-center",
        minHeightClass,
        error ? "border-destructive/30" : "border-border",
        className,
      )}
    >
      <EmptyHeader>
        {renderedIcon && (
          <EmptyMedia
            className={cn(error ? "text-destructive" : "text-primary")}
          >
            {renderedIcon}
          </EmptyMedia>
        )}
        {title && (
          <EmptyTitle
            className={cn(error ? "text-destructive" : "text-ink-strong")}
          >
            {title}
          </EmptyTitle>
        )}
        {description && (
          <EmptyDescription className="text-ink-muted mt-1 text-xs leading-relaxed">
            {description}
          </EmptyDescription>
        )}
        {action && (
          // EmptyContent 默认 flex-col + max-w-sm，操作按钮要横向排；
          // 覆盖 layout 到 flex-row，不动 variant 语义。
          <EmptyContent className="mt-3 flex-row justify-center gap-2">
            {action}
          </EmptyContent>
        )}
      </EmptyHeader>
    </Empty>
  );
}
