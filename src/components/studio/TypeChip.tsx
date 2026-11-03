import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

/**
 * 端口 / 参数的「类型 chip」—— 同一枚形状此前在 studio 的 6 个文件里各抄一份（共 10 处，8 处逐字相同）。颜色有**两条来路**，故 `tone` 必须可关：`neutral` = `bg-border-strong` + `text-ink-muted`；`none` = 一个颜色类都不加，整个交给调用点 `style`（`portChipStyle()` 的类型色）—— `chipStyle` 未必把 `background`/`color` 都给全，缺哪项缺省档就从 class 漏出来改渲染，故「由调用点全权上色」要显式成档。
 * `rounded-[3px]` 留在这里是刻意的：3px 不在圆角七档上（`rounded-xs` 是 2px、`rounded-sm` 是 8px），又不该变成公共档位 —— 它是这枚 chip 的形状细节，形状收在一处、调用点不再各写各的。
 * `fontFamily: var(--font-sans)` 也收在这里：十处原来每处手写同一行内样式（画布节点里父级带等宽字体，chip 要显式回到 sans），它是形状的一部分；调用点再传 `style` 排后面仍可覆盖。
 */
export function TypeChip({
  size = "sm",
  tone = "neutral",
  className,
  style,
  children,
}: {
  children?: React.ReactNode;
  className?: string;
  /**
   * `xs` = 10px 字 + 最紧内距（1 处）；`sm` = 10px 字（4 处，缺省档）；`md` = 12px 字（5 处），走 `text-xs`。
   * 原先写 `text-[12px]` 是为避开「`text-xs` 会把行高锁成 16px」；12px 已归一到 `text-xs`，
   * 这 5 处行盒从 18px 收到 16px 是有意变化，不是等价替换。
   */
  size?: "xs" | "sm" | "md";
  style?: CSSProperties;
  /** `none` = 不加任何颜色类，颜色全部由 `style` 决定。 */
  tone?: "neutral" | "none";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[3px] font-semibold",
        size === "md"
          ? "px-1.5 py-0.5 text-xs"
          : size === "xs"
            ? "text-3xs px-1 py-px"
            : "text-3xs px-1.5 py-0.5",
        tone === "neutral" && "bg-border-strong text-ink-muted",
        className,
      )}
      style={{ fontFamily: "var(--font-sans)", ...style }}
    >
      {children}
    </span>
  );
}
