"use client";

// ── 「量一个元素，并在它变化时重新量」的唯一出口（规范 16 §16.2.4.41）──────
// 与 `~/lib/dom-rect` 分工：那边读一次（`readElementBox` / `offsetWithin` / `readLineHeight`），这边管何时读（挂载后一次 + ResizeObserver）。
// 收：首帧 + 观察者接线、等值判断（否则拖拽面板每帧重渲染）、观察者不可用时的退化；不收：量出来画什么、窗口 resize 是否重算（元素尺寸没变才需另加 window 监听）。

import { useCallback, useEffect, useState } from "react";
import { readElementBox, type ElementBox } from "~/lib/dom-rect";

/** 挂到被量元素上的 `ref` 回调（与 React 的 `ref` 属性同形）。 */
export type ElementBoxRef = (el: Element | null) => void;

/**
 * 量一个元素（尺寸 + 视口位置 + 内容尺寸），并在尺寸变化时重新量。
 * 返回 `[ref, box]`：`ref` 必须挂到被量元素上（hook 据此知道它何时出现），`box` 未挂上时为 `null`。
 */
export function useElementBox(initial: Element | null = null): [ElementBoxRef, ElementBox | null] {
  const [el, setEl] = useState<Element | null>(initial);
  const [box, setBox] = useState<ElementBox | null>(null);

  /* 回调 ref：元素挂上 / 换一个时告诉 hook。
   * ⚠️ 必须判等 —— 内联回调会在**每次渲染**都被 React 调一次（先 `null`
   * 再元素），不判等就会每轮渲染都 setState（React 官方文档对回调 ref 的
   * 明确要求）。 */
  const setElStable = useCallback((next: Element | null) => {
    setEl((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    if (!el) {
      return;
    }

    /* 首帧与后续走**同一条**路径：都从 `ResizeObserver` 的回调外部调一次
     * `measure`。`measure` 里的 setState 只在取值真的变了才落状态，因此
     * 这里不会「每次 effect 都触发一次渲染」（与 `LogPanel` 收口前的做法同源，
     * 但那份只在那一个文件里）。 */
    const measure = () => {
      const next = readElementBox(el);
      setBox((prev) => (sameBox(prev, next) ? prev : next));
    };

    measure();
    /* jsdom 与老浏览器没有 `ResizeObserver`：此时量一次就定住（读数与不接
     * 观察者时一致），不额外退化 —— 与 `LogPanel` 收口前的口径相同。 */
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [el]);

  /* 元素**卸载后**在渲染期直接回 `null`，不靠 effect 去清（在 effect 体里
   * `setBox(null)` 会触发级联渲染，`react-hooks/set-state-in-effect` 明确
   * 禁止）—— 「未挂载」与「尺寸为 0」因此天然分得开，与
   * `~/lib/media/natural-size` 同款。 */
  return [setElStable, el ? box : null];
}

/** 两个盒子是否等价（等值判断 —— 不等才落状态）。 */
function sameBox(a: ElementBox | null, b: ElementBox | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.left === b.left &&
    a.top === b.top &&
    a.clientWidth === b.clientWidth &&
    a.clientHeight === b.clientHeight &&
    a.scrollWidth === b.scrollWidth &&
    a.scrollHeight === b.scrollHeight
  );
}
