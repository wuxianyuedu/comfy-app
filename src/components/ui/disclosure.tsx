"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";

import { cn } from "~/lib/utils";

/**
 * Disclosure —— 「点一行标题、把一段内容折叠 / 展开」的**唯一实现**（规范 16 §16.2.4.13）：收口库里三种写法（原生 `<details>`、自绘布尔 state + ▸/▾、树形 `expandedParents` / `expandedNodeList` 映射），它们的差别是**无障碍语义各写各的**。
 * 形态取 **base-ui `Collapsible`** 而非原生 `<details>`：`CollapsiblePanel` 的 `hiddenUntilFound` 用 `hidden="until-found"`（保留「页内查找自动展开」），触发的 `aria-expanded` / `aria-controls` / 键盘语义收进基元，且受控（`open` + `onOpenChange`）/ 非受控（`defaultOpen`）都支持。
 * 验收口径同 §16.2.4.2 第 9 条：**渲染结果不变** —— 触发方式的 chrome（`▸/▾` 或 `Chevron`）由 `marker` 选，行样式与内边距一律由调用处经 `className` / `panelClassName` 给。
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
   * 与触发行同排、排在触发开关**之前**的内容（用途：一排按钮里只有一个是折叠开关时，把非开关的那几个放这里）。
   * ⚠️「同排」是**布局**：`leading` / `trailing` 是 Root 的子元素、与 trigger **并列**；基元的 trigger 是 `<button>`，往它里面塞 `<Button>` 在 HTML 里非法。要让它们真排成一行，得给 Root 传 `rootClassName="flex items-center gap-2"`（见 `rootClassName`）。
   */
  leading,
  /** 与触发行**同排、排在触发开关之后**的内容（布局说明同 `leading`）。 */
  trailing,
  /** 展开的内容。 */
  children,
  /**
   * 折叠标记的形态（`none`：调用处自己在 `trigger` 里画标记；`caret`：`▸/▾` 字符；`chevron`：lucide `ChevronRight`，展开时转 90°）。
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
  children?: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  /**
   * 与触发行**同排、排在触发开关之前**的内容（用途同 `leading`：基元的 trigger 是 `<button>`，往它里面塞 `<Button>` 在 HTML 里非法）。
   */
  leading?: React.ReactNode;
  marker?: DisclosureMarker;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  panelClassName?: string;
  rootClassName?: string;
  /** 与触发行**同排、排在触发开关之后**的内容（同 `leading` 的用途）。 */
  trailing?: React.ReactNode;
  trigger: React.ReactNode;
}) {
  return (
    <CollapsiblePrimitive.Root
      /* 整排的容器：调用处要 `leading` / `trailing` 与触发开关同排时，
       * 布局类（`flex` 一族）加在这里 —— 见 `rootClassName`。 */
      className={rootClassName}
      data-slot="disclosure"
      defaultOpen={defaultOpen}
      disabled={disabled}
      onOpenChange={onOpenChange}
      open={open}
    >
      {leading}
      <CollapsiblePrimitive.Trigger
        className={cn(
          /* 触发行：默认「标记 + 内容」贴左、整行可点。调用处要两端对齐
           *  （标题左、状态右）时传 `className` 覆盖为 `justify-between`。 */
          "group/disclosure flex w-full cursor-pointer items-center gap-1.5 text-left select-none",
          disabled === true && "cursor-not-allowed opacity-50",
          className,
        )}
        data-slot="disclosure-trigger"
      >
        {marker === "caret" && (
          <span
            aria-hidden
            className={cn(MARKER_BASE, "group-aria-expanded/disclosure:hidden")}
            data-slot="disclosure-marker"
          >
            ▸
          </span>
        )}
        {marker === "caret" && (
          <span
            aria-hidden
            className={cn(MARKER_BASE, "hidden group-aria-expanded/disclosure:inline")}
            data-slot="disclosure-marker"
          >
            ▾
          </span>
        )}
        {marker === "chevron" && (
          <ChevronRight
            aria-hidden
            className={cn(MARKER_BASE, "group-aria-expanded/disclosure:rotate-90")}
            data-slot="disclosure-marker"
            size={13}
          />
        )}
        {trigger}
      </CollapsiblePrimitive.Trigger>
      {trailing}
      <CollapsiblePrimitive.Panel
        /* `w-full`：Root 是 flex 行时面板仍是「独占一行」的那块（配
         * `panelClassName="basis-full"`），不随内容宽度收缩。 */
        className={cn("w-full", panelClassName)}
        data-slot="disclosure-panel"
        /* `hiddenUntilFound`：用 `hidden="until-found"` 而非移除 DOM ——
         * 浏览器页内查找（Ctrl+F）命中折叠内容时会自动展开它。这正是原生
         * `<details>` 的行为，换成自绘「条件渲染」就丢了。 */
        hiddenUntilFound
      >
        {children}
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
