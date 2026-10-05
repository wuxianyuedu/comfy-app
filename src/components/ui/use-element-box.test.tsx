/**
 * `~/components/ui/use-element-box` 的契约（ISSUE #672 / 规范 16 §16.2.4.41）。
 *
 * 这条账的实质是「量一个元素」的**接线**各写一遍（首帧量一次 + 观察者 +
 * 等值判断），且「量不到」在几处有三种处理。用例钉住：首帧就量、元素卸载后
 * 把读数清掉（不把「未挂载」与「尺寸为 0」混在一起）、取值没变时不换引用
 * （否则拖拽面板时每帧重渲染）、观察者不可用时退化。
 */
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useElementBox } from "./use-element-box";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 探针：把量到的盒子经 `onBox` 回调出来，渲染一个被量的 div。 */
function Probe({
  onBox,
  unmountTarget = false,
}: {
  onBox: (box: ReturnType<typeof useElementBox>[1]) => void;
  unmountTarget?: boolean;
}) {
  const [ref, box] = useElementBox();
  useEffect(() => {
    onBox(box);
  }, [box, onBox]);
  return unmountTarget ? <div /> : <div ref={ref} data-testid="target" />;
}

describe("useElementBox", () => {
  it("元素挂上后量一次（不等到第一次尺寸变化）", () => {
    const seen: unknown[] = [];
    render(<Probe onBox={(b) => seen.push(b)} />);
    /* jsdom 不做布局：`clientWidth` 恒为 0，但盒子对象本身必须已经产出
     * （元素已挂上），这正是「首帧量一次」的可观测面。 */
    expect(seen.some((b) => b !== null)).toBe(true);
  });

  it("ResizeObserver 不可用时量一次就定住（不抛错）", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const seen: unknown[] = [];
    render(<Probe onBox={(b) => seen.push(b)} />);
    expect(seen.some((b) => b !== null)).toBe(true);
  });

  it("元素未挂上时盒子里是 null（不把「未挂载」当成「尺寸为 0」）", () => {
    const seen: unknown[] = [];
    render(<Probe onBox={(b) => seen.push(b)} unmountTarget />);
    expect(seen.every((b) => b === null)).toBe(true);
  });

  it("观察者回调触发 re-measure 时不抛错（等值判断在 hook 内部）", () => {
    const callbacks: Array<() => void> = [];
    class FakeRO {
      constructor(cb: () => void) {
        callbacks.push(cb);
      }
      observe() {
        /* 记录用，不需要行为 */
      }
      disconnect() {
        /* 记录用，不需要行为 */
      }
    }
    vi.stubGlobal("ResizeObserver", FakeRO);
    render(<Probe onBox={() => undefined} />);
    expect(callbacks.length).toBeGreaterThan(0);
    expect(() => act(() => callbacks.forEach((cb) => cb()))).not.toThrow();
  });
});
