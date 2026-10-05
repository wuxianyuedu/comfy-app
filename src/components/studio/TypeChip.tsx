import type { CSSProperties } from "react";

import { cn } from "~/lib/utils";

/**
 * 端口 / 参数的「类型 chip」—— 同一枚形状此前在 studio 的 6 个文件里各抄一份
 * （`inline-flex shrink-0 items-center rounded-[3px] px-1.5 py-0.5 font-semibold`
 * 加一档字号，共 10 处，其中 8 处逐字相同）。
 *
 * 颜色有**两条来路**，所以 `tone` 必须可关，不能靠「行内样式覆盖 class」去赌：
 *   · `neutral` —— 底色 `bg-border-strong` + 文字 `text-ink-muted`（随主题的通用档）；
 *   · `none` —— 一个颜色类都不加，颜色整个交给调用点的 `style`
 *     （`portChipStyle()` 给的那套类型色）。行内样式确实优先于 class，但
 *     `chipStyle` 未必把 `background` / `color` 都给全 —— 缺哪一项，缺省档就会
 *     从 class 里漏出来改渲染。所以「由调用点全权上色」要写成显式的一档。
 *
 * `rounded-[3px]` 留在这里是刻意的：3px 不在圆角七档上（`rounded-xs` 是 Tailwind
 * 默认的 2px，我们的 `rounded-sm` 是 8px），而它又不该变成公共档位 —— 它是这枚
 * chip 的形状细节。形状收在一处，调用点不再各写各的。
 *
 * `fontFamily: var(--font-sans)` 也收在这里：十处原来**每一处**都手写同一个行内
 * 样式（画布节点里父级带等宽字体，chip 要显式回到 sans）。它是形状的一部分，
 * 不是调用点的个性化需求；调用点再传 `style` 时排在后面，仍可覆盖。
 */
export function TypeChip({
  size = "sm",
  tone = "neutral",
  className,
  style,
  children,
}: {
  children?: React.ReactNode;
  /**
   * `xs` = 10px 字 + 最紧内距（1 处）；`sm` = 10px 字（4 处，缺省档）；
   * `md` = 12px 字（5 处）。字号写 `text-[12px]` 而不是 `text-xs`：后者会连带
   * 把行高锁成 16px（实测），而这几枚 chip 现在吃的是继承行高。
   */
  size?: "xs" | "sm" | "md";
  /** `none` = 不加任何颜色类，颜色全部由 `style` 决定。 */
  tone?: "neutral" | "none";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[3px] font-semibold",
        size === "md"
          ? "px-1.5 py-0.5 text-[12px]"
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
