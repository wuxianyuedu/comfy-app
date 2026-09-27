"use client";

/**
 * SelectMenu —— 深色主题的下拉选择（替换原生 `<select>`）。
 *
 * 为什么不能直接用原生控件：Chromium / Windows 上原生 `<option>` 忽略
 * CSS `background-color`（它是 OS 级控件），深色主题里会闪出一块白底列表。
 *
 * ## 浮层与 a11y 都交给 base-ui Select 原语（P67 §12.18 系列尾单）
 *
 * 此前这里用 `~/components/ui/popover` 手写了 combobox 语义
 * （`role="combobox"` + `aria-controls` + `role="listbox"` + `role="option"`
 * + `aria-selected` + 键盘 ←/→ / Enter + 高亮滚入 + mouseenter 高亮 +
 * 局部 open state 与滚动 ref），与 `~/components/ui/select`（shadcn
 * Select、base-ui 版）**是同一件事的第二份实现**——popover 只是浮层，
 * combobox 语义还得本件自己拼。base-ui Select 的 Trigger 天生就是
 * combobox（`role="combobox"` + `aria-expanded` + `aria-controls`），
 * List / Item 带 `role="listbox"` / `role="option"` / `aria-selected`，
 * 键盘 ←/→ / Home / End / Enter 与滚入视野都是内置；`data-highlighted`
 * / `data-selected` / `data-disabled` 三条数据属性把视觉状态从 JS 里
 * 挪进 CSS。本件因此从 285 行降到 ~130 行、且读屏器与浏览器兼容性
 * 都比手拼更稳。
 *
 * ## 富 ReactNode 标签（原文件头的核心动机、依然成立且被基元原生支持）
 *
 * `labels` 是 `Record<string, ReactNode>`（不是 `string`），调用处才能在
 * 每行挂彩色圆点 /「本机」/「在线」徽标 —— `string` 本身是合法 ReactNode，
 * 因此这个签名向后兼容。**base-ui 对这一档原生支持**：
 *   · 触发器显示：`<SelectPrimitive.Value>{ReactNode}</SelectPrimitive.Value>`
 *     或 render prop `(value: string | null) => ReactNode`（其 .d.ts 行 28
 *     的官方示例正是 `{(v) => v ? labels[v] : 'No value'}`）；
 *   · 选项行：`<SelectPrimitive.Item value={opt}><SelectPrimitive.ItemText>
 *     {ReactNode}</SelectPrimitive.ItemText></SelectPrimitive.Item>`；
 *   · Root 的 `items?: Record<string, ReactNode>` 还能整表映射（本件不用、
 *     直接走 children 更贴合 `labels[value] ?? value` 的回退语义）。
 * 之前**没有**迁到 Select 的顾虑「富 ReactNode 撑不住」实证不成立。
 *
 * ## 视觉契约（33 处消费点的观感与 PR 之前完全一致）
 *
 * 深色定制定向覆盖到 base-ui 各件：
 *   · Trigger：`border-border bg-subtle text-ink-bright rounded-md px-2.5
 *     py-1.5 text-[12px]` + 自定义 chevron（`group-data-[open]:rotate-180`）；
 *     默认 `w-auto`（**刻意不 `w-full`**，见 `TRIGGER_BASE` 上方原注释——
 *     一排筛选控件里 `w-auto` 覆盖 `w-full` 会被 Tailwind 输出顺序决胜、
 *     导致每个都铺满整行；工作流库页头三个下拉曾撞这条）。
 *   · Content：`bg-card border-border-strong shadow-lg` +
 *     `p-1 max-h-60 overflow-y-auto`（List 层滚动）；`min-w` 走原
 *     `autoFitFromOptions` 算法（按最长字符串标签估宽、上限 720）；
 *   · Item：`text-[12px] rounded-sm px-2.5 py-1` + 三态样式
 *     （`text-ink-faint` 默认 / `data-[highlighted]` 高亮 /
 *     `data-[selected]` 选中；同现时 selected 后写胜、与旧三元一致）。
 *     **无 check 图标**（旧实现就没有、base-ui 允许不引 ItemIndicator）。
 *   · Footer：与旧一致，作为 List 的**兄弟节点**渲染在 Popup 底部
 *     （`mt-1 border-t pt-1`）、不参与滚动。
 *
 * 外部 props 一字未改（`value` / `onChange` / `options` / `labels` /
 * `placeholder` / `disabled` / `className` / `fullWidth` 四个常用项 /
 * `popoverMinWidth` 弹层最小宽 / `autoFitFromOptions` / `footer` / `onOpenChange`
 * 全保留），33 处消费点 0 改动。
 */

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import React, { useMemo } from "react";

import { cn } from "~/lib/utils";

interface SelectMenuProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** 选项值 → 显示文案的映射；缺省时回退到原始值。 */
  labels?: Record<string, React.ReactNode>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * a11y 转发口 · 挂在 Trigger（真正可交互的按钮元素）上。
   * `<FormField>` 的 render prop 会 spread `{ id, "aria-describedby",
   * "aria-invalid" }` 给控件、`<label htmlFor>` 也靠 `id` 关联；此前调用点
   * 用原生 `<select>` 天然吃这些属性、迁 SelectMenu 需要显式开这一层。
   * `title` 也一并转（虽然不推荐用它替代 Tooltip · 存量调用点保留行为）。
   */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  title?: string;
  /**
   * 浮层最小宽度（px），默认 480 —— 装饰较丰富的行
   *（圆点 + 名称 + 任务类型 + 本机/在线徽标）在窄触发器里也能舒展；
   *  触发器本身比这个下限宽时，浮层仍会回落到 `--anchor-width`。
   *  并按视口做上限裁剪 + 自动左移，保证不会溢出右边缘。
   *
   * 开启 `autoFitFromOptions` 时，**生效**的下限为
   * `max(popoverMinWidth, 最长标签字符数 × 8 + 56)`，好让较长的模型文件名 /
   * workflowIO 标签在窄画布节点里也放得下，不必每个调用处各调一遍；
   *  上限封顶 720，免得单个异常长的字符串把浮层顶出屏幕。
   */
  popoverMinWidth?: number;
  /**
   * 触发器取**固定宽度**（铺满容器）而不是「随内容自适应」。缺省是自适应。
   */
  fullWidth?: boolean;
  /**
   * 自动加宽浮层以容纳最长的选项标签。
   *  只测量字符串 / 数字标签 —— 富 ReactNode 标签（如徽标、图标）会被跳过。默认 true。
   */
  autoFitFromOptions?: boolean;
  /**
   * 可选页脚，渲染在浮层底部（可滚动的选项列表之外）——
   *  用于分组空态提示：无论有多少选项，它都必须始终可见。
   */
  footer?: React.ReactNode;
  /**
   * 浮层打开 / 关闭时调用。打开状态由 base-ui Select 内部持有；
   *  调用方借此在列表即将可见时惰性加载选项。
   */
  onOpenChange?: (open: boolean) => void;
}

/* 触发器：与 PR 之前 Popover+Trigger 版本逐字对齐的深色样式。
 * 基础里**没有** `w-full`：默认宽度由调用处决定（`w-full` 用在需要铺满
 * 容器的地方、`w-auto` 用在并排的筛选控件里）。基础样式带 `w-full` 时，
 * 调用处的 `w-auto` 覆盖不掉（同族 utility 按 Tailwind 输出顺序决胜），
 * 会出现「写 `w-auto` 却每个都占整行」——工作流库页头三个筛选下拉曾因此翻车。 */
const TRIGGER_BASE =
  "group flex w-auto items-center justify-between gap-x-2 rounded-md border border-border bg-subtle px-2.5 py-1.5 text-[12px] text-ink-bright outline-none transition-colors focus:border-primary-500/40 disabled:cursor-not-allowed disabled:opacity-60";

/* 浮层容器：与 PR 之前的 PopoverContent 视觉一致。Popup 本身带 base-ui 的
 * `--anchor-width` 变量，`w-(--anchor-width)` 让浮层至少跟触发器同宽；
 * `min-w` / `max-w` 通过 style 传入。 */
const CONTENT_BASE =
  "relative isolate flex max-h-96 flex-col overflow-hidden rounded-md border border-border-strong bg-card p-1 text-[12px] shadow-lg shadow-black/5 outline-none dark:shadow-black/40";

/* 可滚动区（旧 <ul role="listbox">）；max-h-60 与旧一致。base-ui 的 List
 * 会自己管 `data-` 属性与滚动条按钮，不需要我们手挂 role。 */
const LIST_BASE = "max-h-60 w-full overflow-y-auto outline-none";

/* 选项行三态。旧实现在此顺序上写「selected ? A : highlighted ? B : C」，
 * 转 CSS 后靠 tailwind-merge 的属性族决胜——把 selected 写在 highlighted
 * 之后，两者同现时 selected 胜。 */
const ITEM_BASE =
  "flex cursor-default items-center gap-1.5 truncate rounded-sm px-2.5 py-1 text-[12px] text-ink-faint outline-none transition-colors data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink-bright data-[selected]:bg-primary-500/20 data-[selected]:font-medium data-[selected]:text-primary-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

/** 浮层自动加宽的四条常量口径与 PR 之前一致（详见文件头注释）。 */
const POPOVER_AUTO_MAX = 720;
const POPOVER_AUTO_HEADROOM = 56; // 24px 内边距 + 圆点/箭头一行约 32px
const POPOVER_PER_CHAR_PX = 8; // Inter 字体 text-[12px] 下每个字符约 8px
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
  const effectiveMinWidth = useMemo(() => {
    if (!autoFitFromOptions) return popoverMinWidth;
    let longest = 0;
    for (const opt of options) {
      const node = labels?.[opt];
      const text =
        typeof node === "string" || typeof node === "number"
          ? String(node)
          : opt;
      if (text.length > longest) longest = text.length;
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
    ? (labels?.[value] ??
      options.find((option) => option === value) ??
      placeholder)
    : placeholder;

  return (
    <SelectPrimitive.Root
      /* base-ui Select 的 value 允许 null 表示「未选」；空串不当 null 处理，
       * 显式转 null 让 placeholder 正常显示（与旧实现的行为一致：`value=""`
       * 时 trigger 显示 placeholder）。 */
      value={value || null}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      onOpenChange={(next) => onOpenChange?.(next)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        title={title}
        className={cn(TRIGGER_BASE, fullWidth && "w-full", className)}
      >
        <SelectPrimitive.Value className="flex min-w-0 flex-1 items-center truncate">
          {display}
        </SelectPrimitive.Value>
        <ChevronDown
          className={cn(
            /* 与旧实现同款：12×12 自绘箭头 + open 时旋转 180°；
             * `group` 挂在 Trigger 上、这里靠 `group-data-[open]:` 反应。 */
            "text-ink-muted size-3 shrink-0 transition-transform group-data-[open]:rotate-180",
          )}
        />
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          align="start"
          sideOffset={4}
          /* base-ui Select 的 `alignItemWithTrigger` **默认为 true**：弹层会把
             「已选项」对齐到触发器上，于是弹层位置随选中项上下移动 —— 选中末尾项
             时弹层被顶到视口上方、前半截出屏（用户实测）。显式关掉后弹层恒从
             触发器下方展开，位置与选中项无关。与 `ui/select` 的默认口径一致。 */
          alignItemWithTrigger={false}
          className="z-popup isolate outline-none"
        >
          <SelectPrimitive.Popup
            data-align-trigger={false}
            className={cn(CONTENT_BASE)}
            style={{
              width: `min(${effectiveMinWidth}px, 92vw)`,
            }}
          >
            <SelectPrimitive.List className={LIST_BASE}>
              {options.map((opt) => (
                <SelectPrimitive.Item
                  key={opt}
                  value={opt}
                  className={ITEM_BASE}
                >
                  <SelectPrimitive.ItemText>
                    {labels?.[opt] ?? opt}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
            {footer ? (
              <div className="border-border-strong mt-1 border-t pt-1">
                {footer}
              </div>
            ) : null}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
