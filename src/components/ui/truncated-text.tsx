"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Hint } from "~/components/ui/hint";

/**
 * TruncatedText —— 「文字被截成省略号」的**唯一实现**（ISSUE #3790）。
 *
 * ## 它解决什么
 *
 * 视图里到处是 `truncate`（单行截断）：模型名、端点、文件路径、任务名、预设名……
 * 截断本身是对的（窄列里必须让位），但**截断之后用户就再也读不到完整内容**了 ——
 * 而原生 `title=` 又被 P88 判为违规（悬停提示一律走 `~/components/ui/hint` 的
 * `<Hint label=…>`），于是全库留下了「一堆点、且完全不知道为什么」的形态。
 *
 * ## 口径（四条）
 *
 * · **只在真的被截断时出提示**：`scrollWidth - clientWidth > 1`（留 1px 容差，避开
 *   亚像素抖动让提示忽隐忽现）。没截断时 `label` 传 `undefined` ⇒ `Hint` 不渲染
 *   浮层（空 label 的口径见 `hint.tsx`）—— 用户不会对着一段完整文字弹提示。
 * · **提示里是完整原文**（不是截断后的片段）；长路径靠气泡自带的 `wrap-anywhere`
 *   断行，不撑破浮层。
 * · **不改变布局**：承载文字的就是调用点原本那个元素（类名原样传进来），`Hint` 走
 *   Base UI 的 `render` prop 接管**同一个**元素，不额外套一层 DOM，flex/grid 里的
 *   收缩行为与截断表现逐字不变。
 * · **可访问性**：完整原文始终在 DOM 里（读屏器读到的是全文，不是省略号）；提示是
 *   **补充**，不是唯一入口。
 *
 * ## 用法
 *
 * ```tsx
 * <TruncatedText className="text-ink truncate text-sm">{model.name}</TruncatedText>
 * ```
 *
 * `children` 必须是**纯文本**（提示里原样显示它）—— 需要富文本时不要用这个组件。
 */
export type TruncatedTextProps = {
  /** 完整文案（**纯文本**：提示里原样显示它，所以不能传节点）。 */
  children: string;
  /** 承载文字的元素的类名（一般带 `truncate` / `line-clamp-*`）。 */
  className?: string;
};

/** 「被截掉」的判定：内容宽度超出容器宽度（留 1px 容差，避开亚像素抖动）。 */
function isClipped(el: HTMLElement): boolean {
  return el.scrollWidth - el.clientWidth > 1;
}

function TruncatedText({ children, className }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    setClipped(isClipped(el));
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    /* jsdom 与老浏览器没有 `ResizeObserver`：此时量一次就定住（与 `use-element-box`
     * 的退化口径同款），不额外退化 —— 「没量出来」与「没截断」在读数上分不开，
     * 而提示本来就只是补充。 */
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    /* 观察承载元素自身：容器宽度变了（窗口缩放、侧栏折叠、面板展开）要重判一次 ——
     * 「刚才没截断、现在截断了」与反过来都属常见。 */
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  return (
    <Hint label={clipped ? children : undefined}>
      <span className={className} ref={ref}>
        {children}
      </span>
    </Hint>
  );
}

export { TruncatedText };
