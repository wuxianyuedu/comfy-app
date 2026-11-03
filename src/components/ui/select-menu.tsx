"use client";
/* ui-customized: 覆盖前先看 docs/standards/16 §16.8（本文件在 shadcn 官方版之上有改动） */

/**
 * SelectMenu —— 深色主题的下拉选择（替换原生 `<select>`；Chromium / Windows 上原生 `<option>` 忽略 CSS 背景色，深色主题会闪白底）。浮层与 a11y 交给 base-ui Select：Trigger 天生 combobox，List / Item 带 listbox / option / aria-selected，键盘与滚入内置，`data-*` 把视觉挪进 CSS。
 * `labels` 是 `Record<string, ReactNode>`（可挂圆点 / 徽标，`string` 向后兼容）。Trigger 刻意 `w-auto`（`w-full` 会被 Tailwind 输出顺序决胜、铺满整行）；Content `max-h-60` + `autoFitFromOptions`（上限 720）。
 * 外部 props 全保留（`value` / `onChange` / `options` / `labels` / `placeholder` / `disabled` / `className` / `fullWidth` / `popoverMinWidth` / `autoFitFromOptions` / `footer` / `onOpenChange`），33 处消费点零改动。
 */

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import React, { useMemo } from "react";

import { cn } from "~/lib/utils";
import { useOverlayBoundary } from "~/components/ui/use-overlay-boundary";

type SelectMenuProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /**
   * 自动加宽浮层以容纳最长的选项标签。
   *  只测量字符串 / 数字标签 —— 富 ReactNode 标签（如徽标、图标）会被跳过。默认 true。
   */
  autoFitFromOptions?: boolean;
  className?: string;
  disabled?: boolean;
  /**
   * 可选页脚，渲染在浮层底部（可滚动的选项列表之外）——
   *  用于分组空态提示：无论有多少选项，它都必须始终可见。
   */
  footer?: React.ReactNode;
  /**
   * 触发器取**固定宽度**（铺满容器）而不是「随内容自适应」。缺省是自适应。
   */
  fullWidth?: boolean;
  /**
   * a11y 转发口 · 挂在 Trigger（真正可交互的按钮元素）上。`<FormField>` 的 render prop 会 spread `{ id, "aria-describedby", "aria-invalid" }` 给控件、`<label htmlFor>` 也靠 `id` 关联。
   * 此前调用点用原生 `<select>` 天然吃这些属性、迁 SelectMenu 需要显式开这一层；`title` 也一并转（不推荐用它替代 Tooltip · 存量调用点保留行为）。
   */
  id?: string;
  /** 选项值 → 显示文案的映射；缺省时回退到原始值。 */
  labels?: Record<string, React.ReactNode>;
  onChange: (value: string) => void;
  /**
   * 浮层打开 / 关闭时调用。打开状态由 base-ui Select 内部持有；
   *  调用方借此在列表即将可见时惰性加载选项。
   */
  onOpenChange?: (open: boolean) => void;
  options: Array<string>;
  placeholder?: string;
  /**
   * 浮层最小宽度（px），默认 480 —— 装饰较丰富的行（圆点 + 名称 + 任务类型 + 本机/在线徽标）在窄触发器里也能舒展。触发器比下限宽时回落 `--anchor-width`，并按视口裁剪 + 左移。
   * 开启 `autoFitFromOptions` 时生效下限为 `max(popoverMinWidth, 最长标签字符数 × 8 + 56)`，上限封顶 720，免得单个异常长字符串把浮层顶出屏幕。
   */
  popoverMinWidth?: number;
  title?: string;
  value: string;
};

/* 触发器：与 PR 之前 Popover+Trigger 版本逐字对齐的深色样式。
 * 基础里**没有** `w-full`：默认宽度由调用处决定（`w-full` 用在需要铺满
 * 容器的地方、`w-auto` 用在并排的筛选控件里）。基础样式带 `w-full` 时，
 * 调用处的 `w-auto` 覆盖不掉（同族 utility 按 Tailwind 输出顺序决胜），
 * 会出现「写 `w-auto` 却每个都占整行」——工作流库页头三个筛选下拉曾因此翻车。 */
const TRIGGER_BASE =
  "group flex w-auto items-center justify-between gap-x-2 rounded-md border border-border bg-subtle px-2.5 py-1.5 text-xs text-ink-bright outline-none transition-colors focus:border-primary-500/40 disabled:cursor-not-allowed disabled:opacity-60";

/* 浮层容器：与 PR 之前的 PopoverContent 视觉一致。Popup 本身带 base-ui 的
 * `--anchor-width` 变量，`w-(--anchor-width)` 让浮层至少跟触发器同宽；
 * `min-w` / `max-w` 通过 style 传入。 */
const CONTENT_BASE =
  "relative isolate flex max-h-96 flex-col overflow-hidden rounded-md border border-border-strong bg-card p-1 text-xs shadow-lg shadow-black/5 outline-none dark:shadow-black/40";

/* 可滚动区（旧 <ul role="listbox">）；max-h-60 与旧一致。base-ui 的 List
 * 会自己管 `data-` 属性与滚动条按钮，不需要我们手挂 role。 */
const LIST_BASE = "max-h-60 w-full overflow-y-auto outline-none";

/* 选项行三态。旧实现在此顺序上写「selected ? A : highlighted ? B : C」，
 * 转 CSS 后靠 tailwind-merge 的属性族决胜——把 selected 写在 highlighted
 * 之后，两者同现时 selected 胜。 */
const ITEM_BASE =
  "flex cursor-default items-center gap-1.5 truncate rounded-sm px-2.5 py-1 text-xs text-ink-faint outline-none transition-colors data-highlighted:bg-surface-2 data-highlighted:text-ink-bright data-selected:bg-primary-500/20 data-selected:font-medium data-selected:text-primary-strong data-disabled:pointer-events-none data-disabled:opacity-50";

/** 浮层自动加宽的四条常量口径与 PR 之前一致（详见文件头注释）。 */
const POPOVER_AUTO_MAX = 720;
const POPOVER_AUTO_HEADROOM = 56; // 24px 内边距 + 圆点/箭头一行约 32px
const POPOVER_PER_CHAR_PX = 8; // Inter 字体 text-xs 下每个字符约 8px
const POPOVER_AUTO_MIN = 160;

export function SelectMenu({
  value,
  onChange,
  options,
  labels,
  placeholder = "选择…",
  disabled = false,
  className = "",
  fullWidth = false,
  popoverMinWidth = 480,
  autoFitFromOptions = true,
  footer,
  onOpenChange,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
  title,
}: SelectMenuProps) {
  /* 浮层可用区域：视口减去应用级标题行（壳态）—— 见 `useOverlayBoundary`。 */
  const boundary = useOverlayBoundary();
  const effectiveMinWidth = useMemo(() => {
    if (!autoFitFromOptions) {
      return popoverMinWidth;
    }
    let longest = 0;
    for (const opt of options) {
      const node = labels?.[opt];
      const text = typeof node === "string" || typeof node === "number" ? String(node) : opt;
      if (text.length > longest) {
        longest = text.length;
      }
    }
    const approx = longest * POPOVER_PER_CHAR_PX + POPOVER_AUTO_HEADROOM;
    const bounded = Math.max(POPOVER_AUTO_MIN, approx);
    const effective = Math.max(popoverMinWidth, bounded);
    return Math.min(POPOVER_AUTO_MAX, effective);
  }, [autoFitFromOptions, options, labels, popoverMinWidth]);

  /* 触发器显示：与 PR 之前的 `label` 表达式**完全一致**——有值时取
   * labels[value]、value 本身或 placeholder；空值直接落 placeholder。
   * base-ui 的 `<SelectPrimitive.Value>` 允许 children 为 ReactNode
   * （其 .d.ts 行 32）——不再需要 render prop。 */
  const display: React.ReactNode = value
    ? (labels?.[value] ?? options.find((option) => option === value) ?? placeholder)
    : placeholder;

  return (
    <SelectPrimitive.Root
      disabled={disabled}
      onOpenChange={(next) => onOpenChange?.(next)}
      onValueChange={(next) => {
        if (typeof next === "string") {
          onChange(next);
        }
      }}
      /* base-ui Select 的 value 允许 null 表示「未选」；空串不当 null 处理，
       * 显式转 null 让 placeholder 正常显示（与旧实现的行为一致：`value=""`
       * 时 trigger 显示 placeholder）。 */
      value={value || null}
    >
      <SelectPrimitive.Trigger
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        className={cn(TRIGGER_BASE, fullWidth && "w-full", className)}
        id={id}
        title={title}
      >
        <SelectPrimitive.Value className="flex min-w-0 flex-1 items-center truncate">
          {display}
        </SelectPrimitive.Value>
        <ChevronDown
          className={cn(
            /* 与旧实现同款：12×12 自绘箭头 + open 时旋转 180°；
             * `group` 挂在 Trigger 上、这里靠 `group-data-[open]:` 反应。 */
            "text-ink-muted size-3 shrink-0 transition-transform group-data-open:rotate-180",
          )}
        />
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          align="start"
          /* base-ui Select 的 `alignItemWithTrigger` **默认为 true**：弹层会把
             「已选项」对齐到触发器上，于是弹层位置随选中项上下移动 —— 选中末尾项
             时弹层被顶到视口上方、前半截出屏（用户实测）。显式关掉后弹层恒从
             触发器下方展开，位置与选中项无关。与 `ui/select` 的默认口径一致。 */
          alignItemWithTrigger={false}
          className="z-popup isolate outline-none"
          collisionBoundary={boundary ?? undefined}
          sideOffset={4}
        >
          <SelectPrimitive.Popup
            className={cn(CONTENT_BASE)}
            data-align-trigger={false}
            style={{
              width: `min(${effectiveMinWidth}px, 92vw)`,
            }}
          >
            <SelectPrimitive.List className={LIST_BASE}>
              {options.map((opt) => (
                <SelectPrimitive.Item className={ITEM_BASE} key={opt} value={opt}>
                  <SelectPrimitive.ItemText>{labels?.[opt] ?? opt}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
            {footer ? (
              <div className="border-border-strong mt-1 border-t pt-1">{footer}</div>
            ) : null}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
