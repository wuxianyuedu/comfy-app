"use client";

import { useEffect, useState } from "react";

/**
 * useViewportSize —— 「当前视口多大」的唯一出口。
 *
 * 为什么要有这个 hook：**渲染期直接读 `window.innerWidth` / `innerHeight` 是错的**，
 * 而它错得没有声音 ——
 *
 *   · **SSR / 首帧拿不到**：`window` 在服务端不存在，判空之后只能给个兜底值，
 *     于是服务端渲染一份、客户端水合又是另一份，React 报 hydration mismatch；
 *   · **窗口缩放不会重渲染**：读到的值在整段渲染里只对当下那一帧成立，用户把
 *     窗口拉窄之后，按旧值算出来的浮层位置就一直错着，且没有任何东西会通知它；
 *   · **同一帧里读两遍可能不一致**（滚动时移动端浏览器的 `innerHeight` 会随
 *     地址栏收放变化）。
 *
 * 收在这里之后，浮层定位这类「要跟着视口走」的判据有一个可信来源：首帧为
 * `null`（调用处据此**先不摆位**，而不是拿一个假数字去摆），挂载后由
 * `resize` 事件（含软键盘弹起 / 地址栏收放触发的视口变化）驱动更新。
 *
 * ⚠️ **值的单位是 CSS 像素**（`window.innerWidth` / `innerHeight` 的口径），
 * 与 `dvh` 在多数情况下一致；但**滚动引起的高度变化不会触发 `resize`**
 *（移动端地址栏收起时 `innerHeight` 会变、部分浏览器不发事件）—— 需要严格
 * 跟随时用 CSS 的 `dvh` 表达，本 hook 是给「必须在 JS 里知道视口尺寸」的
 * 判据（二选一的分支、像素级夹取）用的。
 */
export interface ViewportSize {
  width: number;
  height: number;
}

export function useViewportSize(): ViewportSize | null {
  /* 首帧 `null`：服务端与客户端首帧都渲染成「还不知道」（同一种结果，
   * 不产生 hydration mismatch），挂载后立刻量一次。 */
  const [size, setSize] = useState<ViewportSize | null>(null);

  useEffect(() => {
    const measure = () => {
      setSize((prev) =>
        prev !== null &&
        prev.width === window.innerWidth &&
        prev.height === window.innerHeight
          ? /* 取值没变就返回原引用 —— `resize` 在高频拖动窗口时每帧都发，
             * 不判等会让整棵树按帧重渲染。 */
            prev
          : { width: window.innerWidth, height: window.innerHeight },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return size;
}
