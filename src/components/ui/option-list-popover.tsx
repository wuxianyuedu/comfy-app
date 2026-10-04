"use client";

import { useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

/**
 * OptionListPopover —— 「一个可滚动的浮层选项列表」的**唯一实现**
 * （规范 16 §16.2.4.14）。
 *
 * 为什么收口：画布节点上的四个 chip（工作流名 / 形态 / 来源 / 模型标签）各自
 * 写了一份**逐行同形**的浮层 —— 触发器 `h-6 … rounded-lg` 配一个 `▾`
 * （`open` 时 `rotate-180`）、内容 `max-h-* overflow-y-auto` 的可滚动列表、
 * 每行 `<Button role="option" aria-selected>` 配「选中高亮 + 勾」。四份的
 * 「当前项」配色还各写各的（`violet-500/20` / `fuchsia-500/20` /
 * `primary-soft` / `bg-accent`）—— 改一处漏三片，且都不受主题 token 控制。
 *
 * 本基元负责**壳与行**：触发器（含 `▾` 与旋转）、可滚动内容区、选项行的
 * `role` / `aria-selected` / 选中态配色 / 勾标记、`Escape` 与外点关闭
 * （由 `ui/popover` 的 base-ui Positioner 给，调用处不再自绘）。
 * 调用处只提供：当前值、选项数组、`重新渲染一行左侧装饰` 与 `onSelect`。
 *
 * **不做成 `ui/select-menu` 的别名**：`select-menu` 是 `combobox` 语义
 * （有 listbox id / 键盘高亮索引 / `aria-controls`），用于表单里的「选一个值」；
 * 本基元是画布上的轻量「点一项切换」，没有高亮索引，行内容也更自由
 * （计数、类型章、颜色点）。两者语义不同，硬合会把 combobox 的 a11y 契约
 * 塞进 chip。
 */
export interface OptionListItem {
  /** 选项值（与 `value` 比较判定选中）。 */
  value: string;
  /** 行文案。 */
  label: string;
  /** 行右侧的附加内容（计数 / 类型章），可为空。 */
  suffix?: ReactNode;
  /** 行左侧的装饰（颜色点 / 状态点），可为空。 */
  prefix?: ReactNode;
  /** 行 `title`（悬停提示）。 */
  title?: string;
}

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
  value: string;
  items: OptionListItem[];
  onSelect: (value: string) => void;
  trigger: ReactNode;
  contentClassName?: string;
  triggerClassName?: string;
  triggerTitle?: string;
  listClassName?: string;
  emptyHint?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  /* 内部 state 与外部回调一起用：外部只想「被通知」时（如画布变换后关闭）
   * 不必自己持有 state。 */
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        title={triggerTitle}
        className={cn(
          "group/popover-trigger nodrag nopan flex items-center gap-1.5",
          triggerClassName,
        )}
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
              key={item.value}
              variant="ghost"
              role="option"
              aria-selected={selected}
              title={item.title}
              onClick={() => {
                onSelect(item.value);
                setOpen(false);
              }}
              className={cn(
                "text-2xs flex h-auto w-full items-center gap-2 rounded-none px-3 py-1.5 text-left font-normal transition-colors",
                selected
                  ? "bg-primary-500/20 text-primary-strong"
                  : "text-ink-soft hover:bg-subtle",
              )}
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
        {items.length === 0 && emptyHint != null && (
          <div className="text-ink-muted text-3xs px-3 py-2">{emptyHint}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
