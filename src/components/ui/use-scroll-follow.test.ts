// @vitest-environment jsdom
/**
 * `useScrollFollow` —— 「让一段滚动内容跟随底部」的唯一实现
 * （规范 16 §16.2.4.24）。
 *
 * 三件事必须逐一钉住（它们是收口前四处实现**判据不一致**的地方）：
 *  ① 内容变化时贴底；
 *  ② 用户上滚**退出跟随**（此前 `AgentOverlay` 会把人按回底部）；
 *  ③ 跟随态是**输出**且能跨实例共享（受控模式）。
 *
 * jsdom 里 `scrollHeight` / `clientHeight` 恒为 0，所以本文件直接给容器
 * 定义这两个属性 —— 量测口径才是这条账的实质，不量它等于没测。
 */
import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it } from "vitest";

import { NEAR_BOTTOM_PX, useScrollFollow } from "./use-scroll-follow";

/** 给宿主元素伪造可读的滚动几何（jsdom 不做布局）。 */
function makeScroller({
  scrollHeight = 1000,
  clientHeight = 200,
}: { scrollHeight?: number; clientHeight?: number } = {}): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  return el;
}

/** 建一个「调用处持有的 ref」并把它指向给定元素（jsdom 里没有真实 DOM 树）。 */
function makeRef(el: HTMLDivElement): React.RefObject<HTMLDivElement | null> {
  return { current: el };
}

describe("useScrollFollow", () => {
  it("内容变化时把 scrollTop 贴到 scrollHeight", () => {
    const el = makeScroller();
    const box = makeRef(el);
    const { rerender } = renderHook(
      ({ text }: { text: string }) =>
        useScrollFollow({ containerRef: box, watch: text }),
      { initialProps: { text: "a" } },
    );

    rerender({ text: "b" });
    expect(el.scrollTop).toBe(1000);
  });

  it("用户上滚超过阈值即退出跟随（不再被拽回底部）", () => {
    const el = makeScroller();
    const { result } = renderHook(() =>
      useScrollFollow({ containerRef: makeRef(el), watch: 0 }),
    );

    /* 距底 100px > 阈值 32px → 退出跟随。 */
    el.scrollTop = 700;
    act(() => result.current.onScroll());
    expect(result.current.following).toBe(false);
  });

  it(`距底 ${NEAR_BOTTOM_PX}px 以内仍算跟随（上滚一点不该掉出跟随态）`, () => {
    const el = makeScroller();
    const { result } = renderHook(() =>
      useScrollFollow({ containerRef: makeRef(el), watch: 0 }),
    );

    el.scrollTop = 1000 - 200 - (NEAR_BOTTOM_PX - 1);
    act(() => result.current.onScroll());
    expect(result.current.following).toBe(true);
  });

  it("退出跟随后内容变化**不再**贴底（用户的位置不被覆盖）", () => {
    const el = makeScroller();
    const box = makeRef(el);
    const { result, rerender } = renderHook(
      ({ text }: { text: string }) =>
        useScrollFollow({ containerRef: box, watch: text }),
      { initialProps: { text: "a" } },
    );

    el.scrollTop = 100;
    act(() => result.current.onScroll());
    rerender({ text: "b" });
    expect(el.scrollTop, "用户已接管滚动，不该被拉回底部").toBe(100);
  });

  it("jumpToLatest 立刻回到底部并把跟随态置回 true", () => {
    const el = makeScroller();
    const { result } = renderHook(() =>
      useScrollFollow({ containerRef: makeRef(el), watch: 0 }),
    );

    el.scrollTop = 100;
    act(() => result.current.onScroll());
    expect(result.current.following).toBe(false);

    act(() => result.current.jumpToLatest());
    expect(result.current.following).toBe(true);
    expect(el.scrollTop).toBe(1000);
  });

  it("受控模式下不自持状态：跟随态由父级给，只回传变化", () => {
    const changes: boolean[] = [];
    const el = makeScroller();
    const box = makeRef(el);
    const { result, rerender } = renderHook(
      ({ following }: { following: boolean }) =>
        useScrollFollow({
          containerRef: box,
          watch: 0,
          following,
          onFollowingChange: (n) => changes.push(n),
        }),
      { initialProps: { following: true } },
    );

    el.scrollTop = 100;
    act(() => result.current.onScroll());
    expect(changes, "上滚应把结论回传给父级").toEqual([false]);
    /* 父级还没把新值给回来时，hook 仍报父级那份值（受控语义）。 */
    expect(result.current.following).toBe(true);

    rerender({ following: false });
    expect(result.current.following).toBe(false);
  });

  it("阈值可覆盖（各落点可以有自己的「还算跟随」距离）", () => {
    const el = makeScroller();
    const { result } = renderHook(() =>
      useScrollFollow({
        containerRef: makeRef(el),
        watch: 0,
        thresholdPx: 200,
      }),
    );

    el.scrollTop = 700; // 距底 100px，小于自定义阈值 200
    act(() => result.current.onScroll());
    expect(result.current.following).toBe(true);
  });
});
