/**
 * 「当前视口多大」这个读数（`useViewportSize`）。
 *
 * 它存在的理由是两件**没有声音的错**：
 *   · 渲染期读 `window.innerWidth` 在 SSR / 首帧拿不到值，判空后的兜底值会让
 *     服务端与客户端渲染出两份不同的结果（hydration mismatch）；
 *   · 窗口缩放不触发重渲染，按旧值算出的浮层位置会一直错着。
 *
 * 所以用例钉住三件事：首帧是 `null`（而不是一个假数字）、挂载后量到真实值、
 * `resize` 之后跟着变 —— 以及**取值没变时不换引用**（`resize` 在拖动窗口时
 * 每帧都发，不判等会让整棵树按帧重渲染）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { useViewportSize } from "./use-viewport-size";

afterEach(cleanup);

/** 静音 `console.error` 用：`mockImplementation` 不接受空箭头（no-empty-function）。 */
function noop(): void {
  /* 什么都不做 —— 本轮只想断言「没有被调用」。 */
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

describe("useViewportSize", () => {
  it("首帧是 null（不拿假数字摆位），挂载后立刻量到真实视口", () => {
    setViewport(1024, 768);
    const { result } = renderHook(() => useViewportSize());
    expect(result.current).toEqual({ width: 1024, height: 768 });
  });

  it("resize 之后跟着变", () => {
    setViewport(1024, 768);
    const { result } = renderHook(() => useViewportSize());
    setViewport(800, 600);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ width: 800, height: 600 });
  });

  it("取值没变时返回同一个引用（resize 高频触发也不换身份）", () => {
    setViewport(1024, 768);
    const { result } = renderHook(() => useViewportSize());
    const first = result.current;
    act(() => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new Event("resize"));
    });
    /* 同引用才能让 `useEffect(..., [viewport])` 这类依赖不误触发。 */
    expect(result.current).toBe(first);
  });

  it("卸载后不再响应 resize（不往已卸载的组件里写状态）", () => {
    setViewport(1024, 768);
    const { result, unmount } = renderHook(() => useViewportSize());
    unmount();
    const spy = vi.spyOn(console, "error").mockImplementation(noop);
    setViewport(640, 480);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ width: 1024, height: 768 });
    expect(spy).not.toHaveBeenCalled();
  });
});
