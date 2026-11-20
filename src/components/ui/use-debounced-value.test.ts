/**
 * useDebouncedValue 的行为契约（#4610 抽出的通用地基）：
 * 首帧即值、窗口内保持旧值、停止变化达 delay 才跟上、窗口内连续变更只保留最后一次、
 * 卸载后定时器不写 state。
 *
 * 用**真时钟**而不是 vi.useFakeTimers：React 19 的 passive effects 在假定时器下
 * 晚一拍冲刷（探针实测 —— rerender 的效果没在时钟推进前落地，防抖值永远追不上），
 * 值侧断言会被调度时序晃点；真时钟没有这层歧义。等落定一律 `expect.poll`
 * （规范 11 §11.14），不赌时间。
 */
// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useDebouncedValue } from "./use-debounced-value";

const DELAY_MS = 200;

afterEach(cleanup);

describe("useDebouncedValue", () => {
  it("首帧即返回当前值", () => {
    const { result } = renderHook(() => useDebouncedValue("a", DELAY_MS));
    expect(result.current).toBe("a");
  });

  it("value 变更后窗口内保持旧值，停止变化达 delay 才跟上", async () => {
    let value = "a";
    const { result, rerender } = renderHook(() => useDebouncedValue(value, DELAY_MS));

    act(() => {
      value = "b";
      rerender();
    });
    expect(result.current).toBe("a");

    await expect.poll(() => result.current, { message: "窗口走完后防抖值应跟上新值" }).toBe("b");
  });

  it("窗口内连续变更只保留最后一次", async () => {
    let value = 1;
    const { result, rerender } = renderHook(() => useDebouncedValue(value, DELAY_MS));

    /* 三次变更落在同一拍 —— 必然都在同一个防抖窗口内。 */
    act(() => {
      value = 2;
      rerender();
      value = 3;
      rerender();
      value = 4;
      rerender();
    });
    expect(result.current).toBe(1);

    await expect.poll(() => result.current, { message: "窗口走完后应只剩最后一次变更" }).toBe(4);
  });

  it("卸载后定时器不再写 state（清理取消了定时器）", async () => {
    let value = "a";
    const { result, rerender, unmount } = renderHook(() => useDebouncedValue(value, DELAY_MS));

    act(() => {
      value = "b";
      rerender();
    });
    unmount();
    // sleep-ok: 等一个「不会发生的事」—— 卸载后定时器不得再写 state，
    // 轮询表达不了「一直没发生」（规范 11 §11.14 的合法逃逸口）。
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
    expect(result.current).toBe("a");
  });
});
