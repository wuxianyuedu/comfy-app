"use client";

import { useEffect, useState } from "react";

/**
 * useViewportSize —— 「当前视口多大」的唯一出口。
 * 渲染期直接读 `window.innerWidth` / `innerHeight` 是错的且错得没声音：SSR/首帧拿不到（hydration mismatch）；窗口缩放不会重渲染（旧值一直错着）；同一帧读两遍可能不一致（移动端地址栏收放）。
 * 收在这里后：首帧为 `null`（调用处先不摆位，而不是拿假数字去摆），挂载后由 `resize`（含软键盘弹起 / 地址栏收放）驱动。⚠️ 单位是 CSS 像素；滚动引起的高度变化不触发 `resize`，需要严格跟随时用 CSS 的 `dvh`。
 */
export type ViewportSize = {
  height: number;
  width: number;
};

export function useViewportSize(): ViewportSize | null {
  /* 首帧 `null`：服务端与客户端首帧都渲染成「还不知道」（同一种结果，
   * 不产生 hydration mismatch），挂载后立刻量一次。 */
  const [size, setSize] = useState<ViewportSize | null>(null);

  useEffect(() => {
    const measure = () => {
      setSize((prev) =>
        prev !== null && prev.width === window.innerWidth && prev.height === window.innerHeight
          ? /* 取值没变就返回原引用 —— `resize` 在高频拖动窗口时每帧都发，
             * 不判等会让整棵树按帧重渲染。 */
            prev
          : { width: window.innerWidth, height: window.innerHeight },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, []);

  return size;
}
