"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Disclosure —— 「点一行标题、把一段内容折叠 / 展开」的**唯一实现**
 * （规范 16 §16.2.4.13）。
 *
 * 为什么收口：库里此前有**三种**写法在做同一件事 ——
 *   ① 原生 `<details>` / `<summary>` 六处（`ErrorPanel` ×2、`HistoryDetailModal`、
 *      `CharacterDesigner`、`CharacterPortraitStudio`、`ExtractToolbar` ×2）；
 *   ② 自绘「一个布尔 state + 条件渲染 + ▸/▾ 或 Chevron 切换」四处
 *      （`SettingsLoadError`、`LlmLocalSection`、`ErrorPanel` 的展开按钮、
 *      `NodesTab` 的 `role="button"` 分组头）；
 *   ③ 树形结构的 `expandedParents` / `expandedNodeList` 两份映射（同 `NodesTab`）。
 * 三者的差别不是「风格」，而是**无障碍语义各写各的**：`<details>` 天生带
 * `role`/`aria-expanded`/键盘切换/浏览器「页内查找时自动展开」，自绘那份基本
 * 只有 `onClick`（`NodesTab` 还为此专门补了 `role="button"` + Enter/Space —— 而
 * 注释里写着「不能用原生 button，因为嵌在 button 里非法」，这正是自绘外壳
 * 逼出来的绕路）。
 *
 * 形态取 **base-ui `Collapsible`** 而不是原生 `<details>`：
 *   · `CollapsiblePanel` 的 `hiddenUntilFound` 用 `hidden="until-found"` 隐藏，
 *     所以**保留了 `<details>` 最值钱的那条**（浏览器页内查找会自动展开命中内容）；
 *   · 同时把触发器的 `aria-expanded` / `aria-controls` / 键盘语义收进基元，
 *     调用处不必自己补 `role="button"` 与 `onKeyDown`；
 *   · 受控 / 非受控都支持 —— 需要「外部状态驱动」（如 `ErrorPanel` 的
 *     `errExpanded` 会被运行状态重置、`CharacterPortraitStudio` 的 `open={busy}`）
 *     时传 `open` + `onOpenChange`，否则 `defaultOpen` 交给基元自己管。
 *
 * 验收口径同 §16.2.4.2 第 9 条：**渲染结果不变** —— 触发方式的 chrome
 * （`▸/▾` 或 `Chevron`）由 `marker` 选，行样式与内边距一律由调用处经
 * `className` / `panelClassName` 给。
 */
export type DisclosureMarker = "none" | "caret" | "chevron";

const MARKER_BASE = "shrink-0 transition-transform";

export function Disclosure({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  /** 触发行的内容（标题 / 摘要）。 */
  trigger,
  /**
   * 与触发行同排、排在触发开关**之前**的内容。
   * 用途：一排按钮里只有一个是折叠开关时（如设置页的「重试 / 完整错误 /
   * 复制」），把非开关的那几个放这里 —— 基元的 trigger 是 `<button>`，
   * 往它里面塞 `<Button>` 在 HTML 里非法。
   *
   * ⚠️「同排」是**布局**，不是把内容塞进 trigger：`leading` / `trailing` 是
   * Root 的子元素、与 trigger **并列**。要让它们真排成一行，得给 Root 传
   * `rootClassName="flex items-center gap-2"`（见 `rootClassName`）。
   */
  leading,
  /** 与触发行**同排、排在触发开关之后**的内容（布局说明同 `leading`）。 */
  trailing,
  /** 展开的内容。 */
  children,
  /**
   * 折叠标记的形态。
   * - `none`：调用处自己在 `trigger` 里画标记（如 `ErrorPanel` 的 `▼/▲`）；
   * - `caret`：`▸/▾` 字符（`ErrorPanel` 的错误串、`NodesTab` 的分组头）；
   * - `chevron`：lucide 的 `ChevronRight`，展开时转 90°（`SettingsLoadError`）。
   * @default "caret"
   */
  marker = "caret",
  /**
   * 触发按钮的 class（标记与 `trigger` 内容的排布）。
   * 整排（`leading` + 触发开关 + `trailing` + 面板）的排布是 **Root** 的事，
   * 用 `rootClassName`（如 `flex flex-wrap items-center gap-2`）。
   */
  className,
  /**
   * Root（整排的容器）的 class —— 需要 `leading` / `trailing` 与触发开关
   * **排成一行**时在这里给 `flex` 一族；面板若要独占一行，配
   * `panelClassName="basis-full"`。
   */
  rootClassName,
  /** 展开面板的 class。 */
  panelClassName,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  trigger: React.ReactNode;
  children?: React.ReactNode;
  /**
   * 与触发行**同排、排在触发开关之前**的内容。
   * 用途：一排按钮里只有一个是折叠开关时（如设置页的「重试 / 完整错误 /
   * 复制」），把非开关的那几个放这里 —— 基元的 trigger 是 `<button>`，
   * 往它里面塞 `<Button>` 在 HTML 里非法。
   */
  leading?: React.ReactNode;
  /** 与触发行**同排、排在触发开关之后**的内容（同 `leading` 的用途）。 */
  trailing?: React.ReactNode;
  marker?: DisclosureMarker;
  className?: string;
  rootClassName?: string;
  panelClassName?: string;
}) {
  return (
    <CollapsiblePrimitive.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      data-slot="disclosure"
      /* 整排的容器：调用处要 `leading` / `trailing` 与触发开关同排时，
       * 布局类（`flex` 一族）加在这里 —— 见 `rootClassName`。 */
      className={rootClassName}
    >
      {leading}
      <CollapsiblePrimitive.Trigger
        data-slot="disclosure-trigger"
        className={cn(
          /* 触发行：默认「标记 + 内容」贴左、整行可点。调用处要两端对齐
           *  （标题左、状态右）时传 `className` 覆盖为 `justify-between`。 */
          "group/disclosure flex w-full cursor-pointer items-center gap-1.5 text-left select-none",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        {marker === "caret" && (
          <span
            aria-hidden
            data-slot="disclosure-marker"
            className={cn(MARKER_BASE, "group-aria-expanded/disclosure:hidden")}
          >
            ▸
          </span>
        )}
        {marker === "caret" && (
          <span
            aria-hidden
            data-slot="disclosure-marker"
            className={cn(
              MARKER_BASE,
              "hidden group-aria-expanded/disclosure:inline",
            )}
          >
            ▾
          </span>
        )}
        {marker === "chevron" && (
          <ChevronRight
            aria-hidden
            size={13}
            data-slot="disclosure-marker"
            className={cn(
              MARKER_BASE,
              "group-aria-expanded/disclosure:rotate-90",
            )}
          />
        )}
        {trigger}
      </CollapsiblePrimitive.Trigger>
      {trailing}
      <CollapsiblePrimitive.Panel
        data-slot="disclosure-panel"
        /* `hiddenUntilFound`：用 `hidden="until-found"` 而非移除 DOM ——
         * 浏览器页内查找（Ctrl+F）命中折叠内容时会自动展开它。这正是原生
         * `<details>` 的行为，换成自绘「条件渲染」就丢了。 */
        hiddenUntilFound
        /* `w-full`：Root 是 flex 行时面板仍是「独占一行」的那块（配
         * `panelClassName="basis-full"`），不随内容宽度收缩。 */
        className={cn("w-full", panelClassName)}
      >
        {children}
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
