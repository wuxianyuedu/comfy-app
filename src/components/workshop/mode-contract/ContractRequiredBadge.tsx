"use client";

// ── 契约口的「必填 / 可选」徽标（ISSUE #4072）──────────────────────────
// 形态只有这一份，两个落点共用：
//   · 模式契约编辑器 —— **可点的开关**（点一下改这个口的「必备」状态）；
//   · 工作流库「工坊封装」的一览行 —— 只读状态。
// 配色走语义 token（§3.6.2）：必填 = 红底（缺了它这条流在工坊里驱动不起来），
// 可选 = 灰底带描边。此前两处各写一份胶囊类名，改一处漏一片。
//
// 为什么不用 `ui/badge`：那一族是「独立徽标」（三轴 variant × size × tone、
// **不可点**），这里的形态是**行内条件标记**（跟在口名后面），且有一处要能
// 点（§16.2.4.5 的分工：判据是「出现在哪里」，不是「长什么样」）。可点的那
// 一份走 `ui/toggle` —— base-ui 的 Toggle 自己管 `aria-pressed` 与键盘语义，
// 视图层手写 `aria-pressed=` 是被门禁挡着的事（§16.2.3 P77）。

import { Toggle } from "~/components/ui/toggle";
import { cn } from "~/lib/utils";

/** 徽标的共同形态（两处共用，字号与内边距与「工坊封装」那一行一致）。 */
const BADGE_CLASS = "text-3xs shrink-0 rounded px-1.5 py-0.5 font-medium";

/** 必填：红底（缺件状态，一眼可见）。 */
const REQUIRED_CLASS = "border-0 bg-destructive/15 text-destructive";

/** 可选：灰底带描边（常态，不抢视线）。 */
const OPTIONAL_CLASS = "border border-border-strong bg-subtle text-muted-foreground/80";

/** 某个口的必填 / 可选状态（只读徽标）。 */
export function ContractRequiredBadge({ required }: { required: boolean }) {
  return (
    <span className={cn(BADGE_CLASS, required ? REQUIRED_CLASS : OPTIONAL_CLASS)}>
      {required ? "必填" : "可选"}
    </span>
  );
}

/**
 * 某个口的必填 / 可选状态（**可点**：点一下改这个口的「必备」状态）。
 *
 * 徽标本身兼作开关，取代此前「一个勾选框 + 一句固定的『必备』」—— 那一格
 * 勾上时写「必备」、没勾时也写「必备」，读的人看不出「没勾 = 可选」。徽标
 * 把两种状态都写在脸上（必填 / 可选），点它就翻面。
 *
 * 底座用 `ui/toggle`（base-ui Toggle 自己管 `aria-pressed` 与键盘语义）：
 * 视图层手写 `aria-pressed=` 是一件被门禁挡着的事（§16.2.3 P77），单按钮
 * 这一档的出口就是 `Toggle`。
 *
 * `srLabel` 给读屏器补口名（可见文案只有「必填 / 可选」，同一屏多行时靠它
 * 分辨是哪一口）；可见文字仍在可访问名里（WCAG 2.5.3「label in name」）。
 */
export function ContractRequiredToggle({
  onToggle,
  required,
  srLabel,
}: {
  /** 翻面（勾上 / 取消勾选这个口的「必备」）。 */
  onToggle: () => void;
  required: boolean;
  /** 读屏器用的口名（可见文案之外的一句）。 */
  srLabel: string;
}) {
  return (
    <Toggle
      className={cn(
        BADGE_CLASS,
        "h-auto min-w-0 gap-0",
        required
          ? cn(
              REQUIRED_CLASS,
              "aria-pressed:border-transparent aria-pressed:bg-destructive/25 aria-pressed:text-destructive",
              "data-pressed:border-transparent data-pressed:bg-destructive/25 data-pressed:text-destructive",
            )
          : cn(OPTIONAL_CLASS, "aria-pressed:bg-subtle data-pressed:bg-subtle"),
      )}
      onPressedChange={() => {
        onToggle();
      }}
      pressed={required}
      size="sm"
      variant="chip"
    >
      {required ? "必填" : "可选"}
      <span className="sr-only">{srLabel}</span>
    </Toggle>
  );
}
