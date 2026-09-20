// @vitest-environment jsdom
/**
 * `~/components/ui/use-refresh-ticket` 的契约（ISSUE #672 / 规范 16 §16.2.4.70）。
 *
 * 这条账的实质是「按需求重新跑一遍取数」各写一份（自增整数的 `useState` +
 * `useCallback`），而三处对三件事各判各的：票据还是直接调、初值与自增口径、
 * 要不要暴露 setter。用例按**票据语义**写：刷新 = 票号变了（不是变大、
 * 不是换类型），且 `refresh` 的身份恒定。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRefreshTicket } from "./use-refresh-ticket";

describe("useRefreshTicket", () => {
  it("初值 0（判据是「值变了」，不是「值变大了」）", () => {
    const { result } = renderHook(() => useRefreshTicket());
    expect(result.current.ticket).toBe(0);
  });

  it("每刷一次票号 +1（整数，不换类型）", () => {
    const { result } = renderHook(() => useRefreshTicket());
    act(() => result.current.refresh());
    expect(result.current.ticket).toBe(1);
    act(() => result.current.refresh());
    expect(result.current.ticket).toBe(2);
    expect(Number.isInteger(result.current.ticket)).toBe(true);
  });

  it("连刷两次拿到两个不同的票号（不合并、不防抖）", () => {
    const { result } = renderHook(() => useRefreshTicket());
    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    /* 两次点击 = 两次刷新（合并是防抖的账，不是票据的）。 */
    expect(result.current.ticket).toBe(2);
  });

  it("`refresh` 的身份恒定（可以安全进 effect 依赖 / 传给子组件）", () => {
    const { result, rerender } = renderHook(() => useRefreshTicket());
    const first = result.current.refresh;
    act(() => result.current.refresh());
    rerender();
    expect(result.current.refresh).toBe(first);
  });
});
