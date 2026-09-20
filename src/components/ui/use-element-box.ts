"use client";

// ── 「量一个元素，并在它变化时重新量」的唯一出口（规范 16 §16.2.4.41）──────
//
// 与 `~/lib/dom-rect` 的分工：那边是**读一次**的纯函数（`readElementBox` /
// `offsetWithin` / `readLineHeight`），这边是**什么时候去读**（挂载后一次 +
// `ResizeObserver` 在尺寸变化时再量）。两者配合使用、不互相替代。
//
// 这条账的成因是「读盒子」这件事被各写一遍，而**接线方式**也各写一遍：
//
//   ① `LogPanel` 的视口量测：`measure()` 在 effect 里先调一次、再交给
//      `ResizeObserver`，且自己写「取值真变了才落状态」的等值判断
//      （不写就会每次回调都重渲染）；
//   ② `WorkflowLibraryCanvas` 的画布底图尺寸：另一个 `ResizeObserver`，
//      自己写等值判断，首帧用 `LAYOUT_SIZING` 兜底；
//   ③ 其余读盒子的地方干脆**不接观察者**（量一次就完），尺寸变了不重算
//      —— 「面板加宽了但正文列还是按旧宽度换行」正是这么来的。
//
// 三种接线的差别没有报错、没有告警，只是在某些窗口尺寸下表现不同。
//
// ## 收什么、不收什么
//
// **收**：首帧量一次 + `ResizeObserver` 的接线、等值判断（取值没变就返回
// 原引用 —— 这个 hook 的 setState 落在观察者回调里，不判等会让拖拽面板时
// 每帧重渲染）、「观察者不可用」（jsdom / 老浏览器）时的退化。
// **不收**：量出来画什么（归各自的视图）、要不要在窗口 resize 时也重算
//（`ResizeObserver` 观测的是元素，窗口缩放会连带触发它 —— 只有「元素尺寸没变
// 但视口变了」的场景才需要另加 `window` 监听，那是调用处的判据）。
//
// ## 接法：两条都用**回调 ref**
//
// `useElementBox` 返回一个 `ref` 回调，调用处把它挂到要量的元素上即可 ——
// 元素什么时候挂上由 React 调这个回调告诉 hook，不需要在 effect 里读
// `ref.current`（**渲染期读 `ref.current` 在首帧是 `null`**，而 effect 里同步
// `setState` 又会触发级联渲染）。调用处已经有 `ref` 对象时（如画布的
// `containerRef`）在回调里一并写进去即可。

import { useCallback, useEffect, useState } from "react";
import { readElementBox, type ElementBox } from "~/lib/dom-rect";

/** 挂到被量元素上的 `ref` 回调（与 React 的 `ref` 属性同形）。 */
export type ElementBoxRef = (el: Element | null) => void;

/**
 * 量一个元素（尺寸 + 视口位置 + 内容尺寸），并在尺寸变化时重新量。
 *
 * 返回值是 `[ref, box]` —— `ref` 必须挂到被量的元素上（这是 hook 知道
 * 「元素什么时候出现」的唯一途径），`box` 是量到的盒子（未挂上时为 `null`）。
 * 传 `initial` 可以让调用处先接一个已存在的元素（少见；多数情况给 `null`）。
 */
export function useElementBox(
  initial: Element | null = null,
): [ElementBoxRef, ElementBox | null] {
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
    if (!el) return;

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
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);

  /* 元素**卸载后**在渲染期直接回 `null`，不靠 effect 去清（在 effect 体里
   * `setBox(null)` 会触发级联渲染，`react-hooks/set-state-in-effect` 明确
   * 禁止）—— 「未挂载」与「尺寸为 0」因此天然分得开，与
   * `~/lib/media/natural-size` 同款。 */
  return [setElStable, el ? box : null];
}

/** 两个盒子是否等价（等值判断 —— 不等才落状态）。 */
function sameBox(a: ElementBox | null, b: ElementBox | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
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
