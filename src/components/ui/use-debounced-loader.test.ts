/**
 * useDebouncedLoader 的行为契约（ISSUE #5249）：值侧防抖之上叠加载型作废守卫。
 *
 * 真时钟 + expect.poll（与 use-debounced-value.test.ts 同口径，规范 11 §11.14）——
 * React 19 的 passive effects 在假定时器下晚一拍，会让防抖断言被调度时序晃点。
 */
// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedLoader } from "./use-debounced-loader";

const DELAY_MS = 120;

afterEach(cleanup);

describe("useDebouncedLoader", () => {
  it("窗口内不加载，停止变化达 delay 后才用最后一次值加载一次", async () => {
    const loaded: Array<string> = [];
    const load = vi.fn((q: string) => {
      loaded.push(q);
    });
    let value = "a";
    const { rerender } = renderHook(() => useDebouncedLoader({ value, delayMs: DELAY_MS, load }));
    /* 首帧防抖值即 "a"，也会跑一轮加载；等它落地后再开始计数。 */
    await expect.poll(() => load.mock.calls.length).toBe(1);
    expect(load).toHaveBeenLastCalledWith("a", expect.any(Function));

    act(() => {
      value = "b";
      rerender();
      value = "赛博";
      rerender();
    });
    expect(load.mock.calls.length).toBe(1);

    await expect.poll(() => loaded.at(-1)).toBe("赛博");
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith("赛博", expect.any(Function));
  });

  it("值再变时旧轮次的 commit 作废——旧 load 不落地，只有新轮次能写", async () => {
    const writes: Array<string> = [];
    let value = "a";
    let resolveFirst: ((v: string) => void) | undefined;
    const firstPending = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const load = vi.fn((v: string, commit: (write: () => void) => void) => {
      void (async () => {
        const result = v === "a" ? await firstPending : v;
        commit(() => writes.push(result));
      })();
    });

    const { rerender } = renderHook(() => useDebouncedLoader({ value, delayMs: DELAY_MS, load }));
    await expect.poll(() => load.mock.calls.length).toBe(1);

    act(() => {
      value = "b";
      rerender();
    });
    await expect.poll(() => load.mock.calls.length).toBe(2);
    /* 新轮次先落地；旧轮次此时才返回，它的 commit 必须被丢弃。 */
    await expect.poll(() => writes).toEqual(["b"]);
    resolveFirst?.("a-late");
    // sleep-ok: 等一个「不会发生的事」——旧轮次的 commit 作废后不得再落地（轮询表达不了「一直没发生」）
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(writes).toEqual(["b"]);
  });

  it("immediateWhen 命中时跳过窗口立即加载（空词回到全量）", async () => {
    const loaded: Array<string> = [];
    const load = vi.fn((q: string) => {
      loaded.push(q);
    });
    const { rerender } = renderHook(
      ({ q }: { q: string }) =>
        useDebouncedLoader({
          value: q,
          delayMs: DELAY_MS,
          load,
          immediateWhen: (v) => v === "",
        }),
      { initialProps: { q: "赛" } },
    );

    await expect.poll(() => load.mock.calls.length).toBe(1);
    expect(load).toHaveBeenLastCalledWith("赛", expect.any(Function));

    act(() => {
      rerender({ q: "" });
    });
    /* 空词是「立即」，不等 120ms；首帧 debounced 还是「赛」，要等它落地那一拍。 */
    await expect.poll(() => loaded.at(-1)).toBe("");
  });

  it("deps 变化时重开一轮（切分类 / 刷新票据）", async () => {
    const load = vi.fn();
    const { rerender } = renderHook(
      ({ ticket }: { ticket: number }) =>
        useDebouncedLoader({ value: "赛", delayMs: DELAY_MS, load, deps: [ticket] }),
      { initialProps: { ticket: 0 } },
    );
    await expect.poll(() => load.mock.calls.length).toBe(1);

    act(() => {
      rerender({ ticket: 1 });
    });
    await expect.poll(() => load.mock.calls.length).toBe(2);
  });

  it("卸载后旧轮次的 commit 不落地", async () => {
    const writes: Array<string> = [];
    let resolveLoad: ((v: string) => void) | undefined;
    const pending = new Promise<string>((resolve) => {
      resolveLoad = resolve;
    });
    const load = vi.fn((_v: string, commit: (write: () => void) => void) => {
      void pending.then((result) => commit(() => writes.push(result)));
    });

    const { unmount } = renderHook(() =>
      useDebouncedLoader({ value: "赛", delayMs: DELAY_MS, load }),
    );
    await expect.poll(() => load.mock.calls.length).toBe(1);
    unmount();
    resolveLoad?.("late");
    // sleep-ok: 等一个「不会发生的事」——卸载后旧轮次的 commit 不得落地（轮询表达不了「一直没发生」）
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(writes).toEqual([]);
  });
});
