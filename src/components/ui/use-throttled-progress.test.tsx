import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createThrottleGate,
  PROGRESS_THROTTLE_MS,
  useThrottledProgress,
  useThrottledProgressMap,
} from "./use-throttled-progress";

describe("useThrottledProgress（单值）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("首个读数立刻写进 state（不让用户等一个窗口）", () => {
    const { result } = renderHook(() => useThrottledProgress(0));
    act(() => result.current.report(3));
    expect(result.current.value).toBe(3);
  });

  it("窗口内的后续读数被丢掉（只取窗口的第一次）", () => {
    const { result } = renderHook(() => useThrottledProgress(0));
    act(() => result.current.report(3));
    act(() => result.current.report(4));
    act(() => result.current.report(5));
    expect(result.current.value).toBe(3);
  });

  it("过了窗口之后写新值", () => {
    const { result } = renderHook(() => useThrottledProgress(0));
    act(() => result.current.report(3));
    act(() => {
      vi.advanceTimersByTime(PROGRESS_THROTTLE_MS + 1);
    });
    act(() => result.current.report(40));
    expect(result.current.value).toBe(40);
  });

  it("同值不写（不触发重渲染）", () => {
    const { result, rerender } = renderHook(() => useThrottledProgress(0));
    act(() => result.current.report(3));
    const before = result.current.value;
    act(() => {
      vi.advanceTimersByTime(PROGRESS_THROTTLE_MS + 1);
    });
    act(() => result.current.report(3));
    rerender();
    expect(result.current.value).toBe(before);
  });

  it("flush 立刻写入并解除节流（终值不允许被窗口吃掉）", () => {
    const { result } = renderHook(() => useThrottledProgress(0));
    act(() => result.current.report(3));
    act(() => result.current.flush(100));
    expect(result.current.value).toBe(100);
  });

  it("flush 同值时也不换 state（走 prev 那一支）", () => {
    const { result } = renderHook(() => useThrottledProgress(5));
    act(() => result.current.flush(5));
    expect(result.current.value).toBe(5);
  });

  it("reset 之后第一个读数立刻写（窗口被解除）", () => {
    const { result } = renderHook(() => useThrottledProgress(0));
    act(() => result.current.report(3));
    act(() => result.current.reset());
    act(() => result.current.report(9));
    expect(result.current.value).toBe(9);
  });

  it("reset 回到初值", () => {
    const { result } = renderHook(() => useThrottledProgress(7));
    act(() => result.current.report(50));
    act(() => result.current.reset());
    expect(result.current.value).toBe(7);
  });

  it("非有限数一律不写（NaN 不该变成假读数）", () => {
    const { result } = renderHook(() => useThrottledProgress(5));
    act(() => result.current.report(NaN));
    expect(result.current.value).toBe(5);
    act(() => result.current.report(Infinity));
    expect(result.current.value).toBe(5);
  });

  it("flush 收到非有限数时不写（只解除节流）", () => {
    const { result } = renderHook(() => useThrottledProgress(0));
    act(() => result.current.report(3));
    act(() => result.current.flush(NaN));
    expect(result.current.value).toBe(3);
  });

  it("tickMs = 0 时逐帧写（显式不节流）", () => {
    const { result } = renderHook(() => useThrottledProgress(0, 0));
    act(() => result.current.report(1));
    act(() => result.current.report(2));
    expect(result.current.value).toBe(2);
  });

  it("卸载之后的回调被丢弃（不在已卸载组件上 setState）", () => {
    const { result, unmount } = renderHook(() => useThrottledProgress(0));
    const report = result.current.report;
    unmount();
    /* 不应抛错，也不该有任何写入 —— 这里只断言「不抛」。 */
    expect(() => act(() => report(99))).not.toThrow();
  });

  it("卸载后 flush / reset 同样不写（守卫不止护 report）", () => {
    const { result, unmount } = renderHook(() => useThrottledProgress(0));
    const { flush, reset } = result.current;
    unmount();
    expect(() => act(() => flush(100))).not.toThrow();
    expect(() => act(() => reset())).not.toThrow();
  });
});

describe("useThrottledProgressMap（按条目）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("条目之间各有自己的窗口（先报的那条不会挤掉后报的）", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    /* 同一时刻：a 的窗口已打开，b 仍应立即写入。 */
    act(() => result.current.report("b", 20));
    expect(result.current.progress).toEqual({ a: 10, b: 20 });
  });

  it("window 内同一条只写第一次", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    act(() => result.current.report("a", 11));
    expect(result.current.progress.a).toBe(10);
  });

  it("flush 写该条目的终值", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    act(() => result.current.flush("a", 100));
    expect(result.current.progress.a).toBe(100);
  });

  it("同值不换对象（不触发重渲染）", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    const before = result.current.progress;
    act(() => result.current.flush("a", 10));
    expect(result.current.progress).toBe(before);
  });

  it("clear(key) 只清那一条 —— 重跑一条不该把别的条目的进度一起抹掉", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    act(() => result.current.report("b", 20));
    act(() => result.current.clear("a"));
    expect(result.current.progress).toEqual({ b: 20 });
  });

  it("clear(key) 之后该条目立刻可写（窗口被解除）", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    act(() => result.current.clear("a"));
    act(() => result.current.report("a", 30));
    expect(result.current.progress.a).toBe(30);
  });

  it("clear() 不带 key 时清全部", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    act(() => result.current.clear());
    expect(result.current.progress).toEqual({});
  });

  it("clearing 不存在的键不改引用（不触发无谓重渲染）", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    const before = result.current.progress;
    act(() => result.current.clear("zzz"));
    expect(result.current.progress).toBe(before);
  });

  it("非有限值在 report 那一支就被拦下（不进窗口）", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", NaN));
    act(() => result.current.report("a", Infinity));
    expect(result.current.progress).toEqual({});
  });

  it("flush 收到非有限数时不写", () => {
    const { result } = renderHook(() => useThrottledProgressMap());
    act(() => result.current.report("a", 10));
    act(() => result.current.flush("a", NaN));
    expect(result.current.progress.a).toBe(10);
  });

  it("tickMs = 0 时逐帧写", () => {
    const { result } = renderHook(() => useThrottledProgressMap(0));
    act(() => result.current.report("a", 1));
    act(() => result.current.report("a", 2));
    expect(result.current.progress.a).toBe(2);
  });

  it("卸载后 report 被丢弃", () => {
    const { result, unmount } = renderHook(() => useThrottledProgressMap());
    const { report } = result.current;
    unmount();
    expect(() => act(() => report("a", 1))).not.toThrow();
  });

  it("卸载后 flush 被丢弃", () => {
    const { result, unmount } = renderHook(() => useThrottledProgressMap());
    const { flush } = result.current;
    unmount();
    expect(() => act(() => flush("a", 50))).not.toThrow();
  });

  it("卸载后 clear 被丢弃", () => {
    const { result, unmount } = renderHook(() => useThrottledProgressMap());
    const { clear } = result.current;
    unmount();
    expect(() => act(() => clear())).not.toThrow();
  });
});

describe("createThrottleGate（只判闸门）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("首次放行、窗口内拦下、过窗再放行", () => {
    const gate = createThrottleGate();
    expect(gate.allow("k")).toBe(true);
    expect(gate.allow("k")).toBe(false);
    vi.advanceTimersByTime(PROGRESS_THROTTLE_MS + 1);
    expect(gate.allow("k")).toBe(true);
  });

  it("键之间互不影响", () => {
    const gate = createThrottleGate();
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("b")).toBe(true);
  });

  it("reset(key) 立刻放行该键；reset() 清全部", () => {
    const gate = createThrottleGate();
    gate.allow("a");
    gate.reset("a");
    expect(gate.allow("a")).toBe(true);
    gate.allow("b");
    gate.reset();
    expect(gate.allow("b")).toBe(true);
  });

  it("tickMs = 0 时恒放行（显式不节流）", () => {
    const gate = createThrottleGate();
    expect(gate.allow("k", 0)).toBe(true);
    expect(gate.allow("k", 0)).toBe(true);
  });
});
