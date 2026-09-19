// @vitest-environment jsdom
/**
 * 「按一下就亮、过一会儿自己复位」的反馈状态（规范 16 §16.2.4）。
 *
 * 这条账的形状是**时间线**，不是某个组件：全库 6 个落点各写一份
 * 「亮起 → `setTimeout` 复位」，其中 4 处裸 `setTimeout`（连卸载都不管）、
 * 2 处手写 `timerRef`。两类缺陷在各自的调用点都看不出来，只有把时间线
 * 拿出来单测才验得了：
 *  ① 卸载后仍然 `setState`；
 *  ② 连点时旧定时器没清 —— 第一次的复位提前抹掉第二次的亮起。
 *
 * 用假定时器把时间轴控制住，而不是 `await sleep(1500)`：真实等待会让
 * 用例慢且不稳，而且无法验证「第二下是否被第一下的复位打断」。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FLASH_MS,
  useFlashLatch,
  useFlashState,
} from "./use-flash-state";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFlashState", () => {
  it("flash 亮起，到默认时长后自己复位", async () => {
    const { result } = renderHook(() => useFlashState());
    expect(result.current.on).toBe(false);

    act(() => result.current.flash());
    expect(result.current.on).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_FLASH_MS - 1);
    });
    expect(result.current.on, "未到时长不该提前复位").toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.on).toBe(false);
  });

  it("连点时以最后一次为准：第一下的复位不打断第二下", async () => {
    const { result } = renderHook(() => useFlashState(1000));

    act(() => result.current.flash());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    act(() => result.current.flash()); // 第二下

    /* 若旧定时器没被清，200ms 后就会被第一次的复位抹掉。 */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.on, "第一下的复位打断了第二下").toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.on).toBe(false);
  });

  it("卸载后定时器不再 setState（日志行会随翻页被卸载）", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useFlashState(1000));

    act(() => result.current.flash());
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    /* React 19 对卸载后 setState 只告警；用告警是否出现作为判据。 */
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("reset 立即复位，不等定时器", async () => {
    const { result } = renderHook(() => useFlashState(1000));
    act(() => result.current.flash());
    act(() => result.current.reset());
    expect(result.current.on).toBe(false);
  });

  it("显式时长覆盖默认（logs 的保存回执要留 8s）", async () => {
    const { result } = renderHook(() => useFlashState(8000));
    act(() => result.current.flash());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_FLASH_MS);
    });
    expect(result.current.on, "不该按默认 1.5s 复位").toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000 - DEFAULT_FLASH_MS);
    });
    expect(result.current.on).toBe(false);
  });
});

describe("useFlashLatch", () => {
  const EMPTY = { path: null as string | null, failed: false };

  it("载荷与亮起同生共死：一次动作的两个可见值一起过期", async () => {
    const { result } = renderHook(() => useFlashLatch(1000, EMPTY));

    act(() =>
      result.current.flash({ path: "log/exports/a.txt", failed: false }),
    );
    expect(result.current.value).toEqual({
      path: "log/exports/a.txt",
      failed: false,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.value, "两个字段必须一起回到空载荷").toEqual(EMPTY);
  });

  it("reset 立即清空载荷，不等定时器", async () => {
    const { result } = renderHook(() => useFlashLatch(1000, EMPTY));
    act(() => result.current.flash({ path: "a.txt", failed: false }));
    act(() => result.current.reset());
    expect(result.current.value).toEqual(EMPTY);
    /* 复位后旧定时器不该再动状态。 */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.value).toEqual(EMPTY);
  });

  it("连点时旧定时器被清（第二个载荷不被第一个的复位抹掉）", async () => {
    const { result } = renderHook(() => useFlashLatch(1000, EMPTY));

    act(() => result.current.flash({ path: "a.txt", failed: false }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    act(() => result.current.flash({ path: null, failed: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(result.current.value).toEqual({ path: null, failed: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(result.current.value).toEqual(EMPTY);
  });
});
