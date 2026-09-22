// @vitest-environment jsdom
/**
 * `useInterval` —— 「按固定间隔重复跑一个异步动作」的唯一实现
 * （规范 16 §16.2.4.15）。
 *
 * 这条账的形状与 `use-flash-state` 同族（都是时间线），但缺陷不同：
 *  ① 挂载后**不立刻跑一次**，用户要空等一个完整间隔；
 *  ② 后台标签页里**空转**（浏览器把后台定时器降到 ≥1min，请求照发）；
 *  ③ 回调放进依赖数组时**每次渲染都重建定时器**（计时被反复重置）。
 *
 * 用假定时器把时间轴控制住：「切后台暂停、回前台立即补跑」这条只有把
 * `visibilityState` 拿捏住才验得了。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "./use-interval";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  /* 每个用例自己改过就还原，避免漏到下一个用例。 */
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  document.hasFocus = () => true;
});

/** 把 `document.visibilityState` 置成指定值并派发一次 visibilitychange。 */
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** 把 `document.hasFocus()` 置成指定值并派发一次 focus/blur 事件。 */
function setFocused(focused: boolean) {
  document.hasFocus = () => focused;
  window.dispatchEvent(new Event(focused ? "focus" : "blur"));
}

describe("useInterval", () => {
  it("挂载即先跑一次（immediate 默认 true），之后按间隔重复", async () => {
    const run = vi.fn();
    renderHook(() => useInterval(run, { ms: 1000 }));

    expect(run, "挂载应立即跑一次，不等第一个间隔").toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("immediate=false 时不立刻跑，等第一个间隔", async () => {
    const run = vi.fn();
    renderHook(() => useInterval(run, { ms: 1000, immediate: false }));
    expect(run).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ms 为 null / 0 表示不轮询", async () => {
    const run = vi.fn();
    renderHook(() => useInterval(run, { ms: null }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("卸载后定时器停掉，不再跑", async () => {
    const run = vi.fn();
    const { unmount } = renderHook(() => useInterval(run, { ms: 1000 }));
    expect(run).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(run, "卸载后不该再跑").toHaveBeenCalledTimes(1);
  });

  it("回调换了新函数也不重建定时器（传新函数不会重置计时）", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook<void, { run: () => void }>(
      (props) => useInterval(props.run, { ms: 1000 }),
      { initialProps: { run: first } },
    );
    expect(first).toHaveBeenCalledTimes(1);

    /* 走到间隔一半时换回调：若定时器被重建，下一次触发会被推后。 */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    rerender({ run: second });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(
      second,
      "定时器不该被重建：原来那半拍之后就该触发，且用的是最新回调",
    ).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("pauseWhenHidden：切后台暂停，回前台立即补跑一次并恢复", async () => {
    const run = vi.fn();
    renderHook(() => useInterval(run, { ms: 1000 }));
    expect(run).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(run, "后台不该继续跑").toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    expect(run, "回前台应立即补跑一次，不等下一个间隔").toHaveBeenCalledTimes(
      2,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("pauseWhenHidden=false：后台照常跑（有意的选择）", async () => {
    const run = vi.fn();
    renderHook(() => useInterval(run, { ms: 1000, pauseWhenHidden: false }));
    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("pauseWhenUnfocused=true：窗口失焦暂停、重新聚焦立即补跑一次并恢复（WebView2 遮挡场景）", async () => {
    const run = vi.fn();
    renderHook(() => useInterval(run, { ms: 1000, pauseWhenUnfocused: true }));
    expect(run, "挂载即先跑一次").toHaveBeenCalledTimes(1);

    act(() => setFocused(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(run, "失焦后不该继续跑").toHaveBeenCalledTimes(1);

    act(() => setFocused(true));
    expect(run, "重新聚焦应立即补跑一次").toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("pauseWhenUnfocused=false：显式关时失焦仍跑（浏览器 tab 场景保留既有语义）", async () => {
    const run = vi.fn();
    renderHook(() => useInterval(run, { ms: 1000, pauseWhenUnfocused: false }));
    expect(run).toHaveBeenCalledTimes(1);
    act(() => setFocused(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(run, "显式关掉 unfocused 判据后失焦也不停").toHaveBeenCalledTimes(4);
  });
});
