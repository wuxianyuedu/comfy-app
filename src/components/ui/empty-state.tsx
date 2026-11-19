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

/** EmptyState —— 空状态占位（全库唯一实现，规范 16 §16.2.4；PR-2 起改为 `~/components/ui/empty` 官方基元的薄封装）。
 * 合并三份历史实现（居中虚线卡片 / 图标方块 + 警告色 + min-h / 行内小提示条）为单组件，四档 variant：page / error / hint / panel（panel 为本次治理新增）。
 * P67 治理（§16.2.3 / §12.18）：page / error 两档本就是 shadcn `Empty` 系形态（此前基元未装、只能自绘 `<div>`），现改用 Empty + Header + Media + Title + Description + Content，尺寸/圆角/边框色由 className 传（对齐 shadcn styling.md）。
 * hint 与 panel 刻意保留自绘 `<div>`：hint 是行内提示条，与 `Empty` 的居中虚线卡片不同族，硬套会丢语义；panel 要的是不带框、不带内距、不改换行的铺满态，而 `Empty` 自带 p-6 / rounded-xl / border-dashed / text-balance（text-balance 会把长提示折行改形，是改外观不是收口）。弱化程度由该档自定（图标 30% 透明、文案 text-sm + text-ink-fainter），间距/图标走 className 或传已渲染节点，不要再抄整串类名（`tests/design-md-contract-sync.test.ts` 按同一 class 串全命中抓）。
 * API 完全不变：title / description / icon / variant / action / minHeightClass / className，现有调用点零改动。 */
export type EmptyStateVariant = "page" | "error" | "hint" | "panel";

export type EmptyStateProps = {
  /** 操作区（按钮等），居中渲染在主文案下方。 */
  action?: ReactNode;
  className?: string;
  /** 补充说明：为什么是空的 / 下一步做什么（规范 10.5）。 */
  description?: ReactNode;
  /** 图标：传 lucide 组件（按 `size` 渲染）或已渲染节点。 */
  icon?: LucideIcon | ReactNode;
  /** `page` 形态的最小高度类，默认 `min-h-55`。 */
  minHeightClass?: string;
  /** 主文案：一句话说明当前是什么状态（如「未找到匹配的工作流」）。 */
  title?: string;
  /** 形态（见组件注释）。 */
  variant?: EmptyStateVariant;
};

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
      /* SAFETY: 类型断言已复核 */
      typeof (value as { render?: unknown }).render === "function")
  );
}

export function EmptyState({
  title,
  description,
  icon,
  variant = "page",
  action,
  minHeightClass = "min-h-55",
  className,
}: EmptyStateProps) {
  if (variant === "hint") {
    return (
      <div
        className={cn(
          "border-border-strong bg-subtle text-ink-soft text-2xs rounded-lg border border-dashed px-3 py-3 leading-relaxed",
          className,
        )}
      >
        {description ?? title}
      </div>
    );
  }

  const error = variant === "error";
  const panel = variant === "panel";
  /* 传节点时原样渲染，传 lucide 组件时按统一尺寸渲染（历史两种调用都有，
   * 取并集才不会逼调用方先看一遍 props）。 */
  let renderedIcon: ReactNode = null;
  const hasIcon = Boolean(icon);
  if (isIconComponent(icon)) {
    /* 组件形参必须渲染成 `<Icon …/>` 而不是 `{icon}`：lucide 图标是
     * `React.forwardRef` 的产物（对象），直接当子节点会被 React 判成
     * 「非法子节点」并抛错 —— 而它 `typeof` 恰好是 `"object"`，
     * `typeof icon === "function"` 的判据接不住它。 */
    const Icon = icon;
    renderedIcon = panel ? (
      <Icon aria-hidden className="opacity-30" size={32} strokeWidth={1.5} />
    ) : (
      <Icon aria-hidden size={32} />
    );
  } else if (hasIcon) {
    renderedIcon = icon;
  }

  if (panel) {
    return (
      <div
        className={cn(
          "text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-sm",
          className,
        )}
      >
        {renderedIcon}
        {title ?? description}
      </div>
    );
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
        {Boolean(renderedIcon) && (
          <EmptyMedia className={cn(error ? "text-destructive" : "text-primary")}>
            {renderedIcon}
          </EmptyMedia>
        )}
        {title !== undefined && title !== "" && (
          <EmptyTitle className={cn(error ? "text-destructive" : "text-ink-strong")}>
            {title}
          </EmptyTitle>
        )}
        {Boolean(description) && (
          <EmptyDescription className="text-ink-muted mt-1 text-xs leading-relaxed">
            {description}
          </EmptyDescription>
        )}
        {Boolean(action) && (
          // EmptyContent 默认 flex-col + max-w-sm，操作按钮要横向排；
          // 覆盖 layout 到 flex-row，不动 variant 语义。
          <EmptyContent className="mt-3 flex-row justify-center gap-2">{action}</EmptyContent>
        )}
      </EmptyHeader>
    </Empty>
  );
}
