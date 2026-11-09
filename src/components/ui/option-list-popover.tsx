"use client";

import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

/**
 * OptionListPopover —— 「一个可滚动的浮层选项列表」的唯一实现（规范 16 §16.2.4.14）。收口前画布节点四个 chip 各写一份逐行同形的浮层，选中配色还各写各的（不受主题 token 控制）。
 * 本基元负责壳与行（触发器含 `▾` 与旋转、可滚动内容区、选项行的 `role` / `aria-selected` / 选中态配色 / 勾标记、Escape 与外点关闭）。不做成 `ui/select-menu` 的别名：那个是 combobox 语义，本件是轻量「点一项切换」，行内容更自由。
 */
export type OptionListItem = {
  /** 行文案。 */
  label: string;
  /** 行左侧的装饰（颜色点 / 状态点），可为空。 */
  prefix?: ReactNode;
  /** 行右侧的附加内容（计数 / 类型章），可为空。 */
  suffix?: ReactNode;
  /** 行 `title`（悬停提示）。 */
  title?: string;
  /** 选项值（与 `value` 比较判定选中）。 */
  value: string;
};

export function OptionListPopover({
  value,
  items,
  onSelect,
  /** 触发器内容（chip 的外观与当前值回显）。 */
  trigger,
  /** 浮层内容区的宽度类（如 `w-72`）。 */
  contentClassName,
  /** 触发器 class。调用处给 chip 的外观（配色 / 尺寸 / 圆角）。 */
  triggerClassName,
  /** 触发器 `title`。 */
  triggerTitle,
  /** 浮层（含滚动上限）的额外 class。默认 `max-h-72 overflow-y-auto`。 */
  listClassName,
  /** 列表为空时显示的提示。 */
  emptyHint,
  /** 浮层开合（受控）。用于「画布一变换就关掉」这类外部联动。 */
  onOpenChange,
  /** 禁用触发器（不可点开）。 */
  disabled,
  align = "start",
}: {
  align?: "start" | "center" | "end";
  contentClassName?: string;
  disabled?: boolean;
  emptyHint?: ReactNode;
  items: Array<OptionListItem>;
  listClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onSelect: (value: string) => void;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  /* 内部 state 与外部回调一起用：外部只想「被通知」时（如画布变换后关闭）
   * 不必自己持有 state。 */
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        className={cn(
          "group/popover-trigger nodrag nopan flex items-center gap-1.5",
          triggerClassName,
        )}
        disabled={disabled}
        title={triggerTitle}
        type="button"
      >
        {trigger}
        {/* 展开指示：两个形态由 `group-aria-expanded` 切换 —— 与
         *  `ui/disclosure` 同一个思路（旋转由 CSS 变体给，不靠 JS 条件类）。 */}
        <span
          aria-hidden
          className={cn(
            "text-ink-icon shrink-0 transition-transform",
            "group-data-popup-open/popover-trigger:rotate-180",
          )}
          style={{ fontFamily: "var(--font-sans)", fontSize: 9 }}
        >
          ▾
        </span>
      </PopoverTrigger>

      <PopoverContent
        align={align}
        aria-label={typeof triggerTitle === "string" ? triggerTitle : undefined}
        className={cn(
          "border-border-strong bg-card gap-0 py-1 shadow-2xl shadow-black/10 dark:shadow-black/40",
          listClassName ?? "max-h-72 overflow-y-auto",
          contentClassName,
        )}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <Button
              aria-selected={selected}
              className={cn(
                "text-2xs flex h-auto w-full items-center gap-2 rounded-none px-3 py-1.5 text-left font-normal transition-colors",
                selected
                  ? "bg-primary-500/20 text-primary-strong"
                  : "text-ink-soft hover:bg-subtle",
              )}
              key={item.value}
              onClick={() => {
                onSelect(item.value);
                setOpen(false);
              }}
              role="option"
              title={item.title}
              variant="ghost"
            >
              {item.prefix}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.suffix}
              {selected && (
                <span aria-hidden className="text-primary-strong">
                  ✓
                </span>
              )}
            </Button>
          );
        })}
        {items.length === 0 && emptyHint !== null && emptyHint !== undefined && (
          <div className="text-ink-muted text-3xs px-3 py-2">{emptyHint}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
