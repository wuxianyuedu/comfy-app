// @vitest-environment jsdom
/**
 * `useInterval` —— 「按固定间隔重复跑一个异步动作」的唯一实现（规范 16 §16.2.4.15）。
 * 与 `use-flash-state` 同族（时间线）但缺陷不同：① 挂载后不立刻跑一次；② 后台标签页里空转；③ 回调进依赖数组时每次渲染都重建定时器。
 * 用假定时器控制时间轴；「切后台暂停、回前台立即补跑」只有拿捏住 `visibilityState` 才验得了。
 */
import { act, renderHook } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useInterval } from "./use-interval";
import { ViewTabActiveProvider } from "./view-tab-active";

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
    renderHook(() => {
      useInterval(run, { ms: 1000 });
    });

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
    renderHook(() => {
      useInterval(run, { ms: 1000, immediate: false });
    });
    expect(run).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("轮询动作抛错走明确通道（console.error），不静默沉掉", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {
      void 0;
    });
    renderHook(() => {
      useInterval(() => Promise.reject(new Error("poll boom")), { ms: 1000 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spy).toHaveBeenCalledWith("[use-interval] 轮询动作抛错", expect.any(Error));
    spy.mockRestore();
  });

  it("两条暂停判据都关掉时不挂窗口事件监听", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    renderHook(() => {
      useInterval(vi.fn(), {
        ms: 1000,
        pauseWhenHidden: false,
        pauseWhenUnfocused: false,
      });
    });
    expect(addSpy).not.toHaveBeenCalledWith("visibilitychange", expect.anything());
    addSpy.mockRestore();
  });

  it("ms 为 null / 0 表示不轮询", async () => {
    const run = vi.fn();
    renderHook(() => {
      useInterval(run, { ms: null });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("卸载后定时器停掉，不再跑", async () => {
    const run = vi.fn();
    const { unmount } = renderHook(() => {
      useInterval(run, { ms: 1000 });
    });
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
      (props) => {
        useInterval(props.run, { ms: 1000 });
      },
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
    renderHook(() => {
      useInterval(run, { ms: 1000 });
    });
    expect(run).toHaveBeenCalledTimes(1);

    act(() => {
      setVisibility("hidden");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(run, "后台不该继续跑").toHaveBeenCalledTimes(1);

    act(() => {
      setVisibility("visible");
    });
    expect(run, "回前台应立即补跑一次，不等下一个间隔").toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("pauseWhenHidden=false：后台照常跑（有意的选择）", async () => {
    const run = vi.fn();
    renderHook(() => {
      useInterval(run, { ms: 1000, pauseWhenHidden: false });
    });
    act(() => {
      setVisibility("hidden");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("pauseWhenUnfocused=true：窗口失焦暂停、重新聚焦立即补跑一次并恢复（WebView2 遮挡场景）", async () => {
    const run = vi.fn();
    renderHook(() => {
      useInterval(run, { ms: 1000, pauseWhenUnfocused: true });
    });
    expect(run, "挂载即先跑一次").toHaveBeenCalledTimes(1);

    act(() => {
      setFocused(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(run, "失焦后不该继续跑").toHaveBeenCalledTimes(1);

    act(() => {
      setFocused(true);
    });
    expect(run, "重新聚焦应立即补跑一次").toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("pauseWhenUnfocused=false：显式关时失焦仍跑（浏览器 tab 场景保留既有语义）", async () => {
    const run = vi.fn();
    renderHook(() => {
      useInterval(run, { ms: 1000, pauseWhenUnfocused: false });
    });
    expect(run).toHaveBeenCalledTimes(1);
    act(() => {
      setFocused(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(run, "显式关掉 unfocused 判据后失焦也不停").toHaveBeenCalledTimes(4);
  });

  /* `ms` 可以是函数（ISSUE #1351）：「按阶段给频率」要的就是**每拍跑完之后**
   * 重新问一次下一拍等多久 —— 档位在运行中会变（用户点了生成 / 切走了窗口 /
   * 刚收到崩溃信号），一个创建时就定死的数字表达不了。 */
  it("ms 给函数：每拍之后重新问一次「下一拍等多久」", async () => {
    const run = vi.fn();
    let ms = 1000;
    renderHook(() => {
      useInterval(run, { ms: () => ms });
    });
    expect(run, "挂载即先跑一次").toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(run, "不到点不跑").toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(run).toHaveBeenCalledTimes(2);

    /* 「每拍之后重新问」的语义：**已经排上的那一拍不受影响**（它按排时的值
       到点），新值从**下一拍**开始生效。 */
    ms = 5000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run, "已排上的那一拍按旧值到点").toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(run, "新档还没到").toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(run, "到新档就跑了").toHaveBeenCalledTimes(4);
  });

  it("ms 函数返回 0：立刻再跑一拍（事件驱动「不等下一拍」那一档）", async () => {
    const run = vi.fn();
    renderHook(() => {
      useInterval(run, { ms: () => 0 });
    });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run, "0 档立刻再跑").toHaveBeenCalledTimes(2);
  });

  it("ms 函数返回 null：下一拍不再排（调用方可再经 stop / 重建拉起）", async () => {
    const run = vi.fn();
    renderHook(() => {
      useInterval(run, { ms: () => null });
    });
    expect(run, "挂载即先跑一次").toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(run, "返回 null 之后不再跑").toHaveBeenCalledTimes(1);
  });

  it("ms 函数返回 0：异步 run 没跑完就不再发下一拍（不叠发占满连接预算）", async () => {
    let release: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderHook(() => {
      useInterval(run, { ms: () => 0 });
    });
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run, "上一拍还挂在途，不该再发下一拍").toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(run, "上一拍跑完才立刻发下一拍").toHaveBeenCalledTimes(2);
  });
});

/** 页签可见性测试台：包一层 `ViewTabActiveProvider`，按需翻转「本屏是不是当前页」。 */
function createTabHarness() {
  let flip: ((v: boolean) => void) | null = null;
  function Wrapper({ children }: { children: ReactNode }) {
    const [active, setActive] = useState(true);
    flip = setActive;
    return <ViewTabActiveProvider active={active}>{children}</ViewTabActiveProvider>;
  }
  return {
    Wrapper,
    /** active=true 表示本屏是当前页签；false 表示它被切到后台隐藏了。 */
    setTabActive: (active: boolean) => {
      flip?.(active);
    },
  };
}

describe("useInterval 的页签隐藏档（ISSUE #4598）", () => {
  it("默认开：隐藏页签的定时器停掉，切回当前页立即补跑一次并恢复", async () => {
    const harness = createTabHarness();
    const run = vi.fn();
    renderHook(
      () => {
        useInterval(run, { ms: 1000 });
      },
      { wrapper: harness.Wrapper },
    );
    expect(run, "当前页签：挂载即先跑一次").toHaveBeenCalledTimes(1);

    act(() => {
      harness.setTabActive(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(run, "隐藏页签不该继续跑").toHaveBeenCalledTimes(1);

    act(() => {
      harness.setTabActive(true);
    });
    expect(run, "切回当前页应立即补跑一次").toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(run, "恢复后按间隔继续").toHaveBeenCalledTimes(3);
  });

  it("pauseWhenViewHidden=false：页签隐藏仍跑（有意的选择，行为与从前一致）", async () => {
    const harness = createTabHarness();
    const run = vi.fn();
    renderHook(
      () => {
        useInterval(run, { ms: 1000, pauseWhenViewHidden: false });
      },
      { wrapper: harness.Wrapper },
    );
    expect(run).toHaveBeenCalledTimes(1);
    act(() => {
      harness.setTabActive(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(run, "显式关掉页签判据后，隐藏页签也照跑").toHaveBeenCalledTimes(4);
  });

  it("无 Provider（独立路由 / Storybook / 组件用例）按当前屏处理，行为不变", async () => {
    const run = vi.fn();
    renderHook(() => {
      useInterval(run, { ms: 1000 });
    });
    expect(run, "缺省 value=true：不挂壳的路径照常轮询").toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("页签隐藏但文档可见也暂停：两档判据任一命中即停（叠加语义）", async () => {
    const harness = createTabHarness();
    const run = vi.fn();
    renderHook(
      () => {
        useInterval(run, { ms: 1000 });
      },
      { wrapper: harness.Wrapper },
    );
    expect(run).toHaveBeenCalledTimes(1);

    /* 文档仍可见（visibilityState=visible），但本屏已不是当前页签：照停。 */
    act(() => {
      harness.setTabActive(false);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(run, "页签隐藏即停，不要求文档同时隐藏").toHaveBeenCalledTimes(1);

    act(() => {
      harness.setTabActive(true);
    });
    expect(run, "切回当前页立即补跑").toHaveBeenCalledTimes(2);
  });
});
