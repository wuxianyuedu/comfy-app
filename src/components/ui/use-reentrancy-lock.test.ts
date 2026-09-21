// @vitest-environment jsdom
/**
 * `~/components/ui/use-reentrancy-lock` 的契约（ISSUE #672 / 规范 16 §16.2.4.69）。
 *
 * 这条账的实质是「同一时刻只跑一件」的重入判据各写一份，而多数落点
 * **靠读 React state 判**（`if (busy) return;`）—— 那是异步的，同一次
 * 事件循环里的两次点击都读到 `false`。用例因此按**同步可见性**写：
 * `tryEnter` 在 `exit` 之前一律给 `false`，且与 React 的渲染节奏无关。
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createReentrancyLock, useReentrancyLock } from "./use-reentrancy-lock";

describe("createReentrancyLock（就地造闸门）", () => {
  it("第一次进入拿 true，之后一律 false", () => {
    const lock = createReentrancyLock();
    expect(lock.tryEnter()).toBe(true);
    expect(lock.tryEnter()).toBe(false);
    expect(lock.tryEnter()).toBe(false);
  });

  it("退出之后可以再进入", () => {
    const lock = createReentrancyLock();
    expect(lock.tryEnter()).toBe(true);
    lock.exit();
    expect(lock.tryEnter()).toBe(true);
  });

  it("`isLocked` 与 `tryEnter` 同步一致（不经过任何异步）", () => {
    const lock = createReentrancyLock();
    expect(lock.isLocked()).toBe(false);
    lock.tryEnter();
    expect(lock.isLocked()).toBe(true);
    lock.exit();
    expect(lock.isLocked()).toBe(false);
  });

  it("`exit` 是幂等的（多调一次不会解锁别人的临界区）", () => {
    const lock = createReentrancyLock();
    lock.tryEnter();
    lock.exit();
    lock.exit();
    expect(lock.tryEnter()).toBe(true);
  });
});

describe("useReentrancyLock（组件级闸门）", () => {
  it("同一次渲染里连点两次：第二次被拦（state 判不到的那一半）", () => {
    const { result } = renderHook(() => useReentrancyLock());
    /* 关键：两次调用之间**没有**等待、没有 `act` 提交、没有重渲染 ——
     * 这正是 `if (busy) return;` 会漏掉的形态。 */
    expect(result.current.tryEnter()).toBe(true);
    expect(result.current.tryEnter()).toBe(false);
  });

  it("`exit` 之后可以再进入（重挂 / 新一轮）", () => {
    const { result } = renderHook(() => useReentrancyLock());
    expect(result.current.tryEnter()).toBe(true);
    result.current.exit();
    expect(result.current.tryEnter()).toBe(true);
    expect(result.current.isLocked()).toBe(true);
  });

  it("`isLocked` 只读，不会改变闸门状态", () => {
    const { result } = renderHook(() => useReentrancyLock());
    expect(result.current.isLocked()).toBe(false);
    expect(result.current.isLocked()).toBe(false);
    expect(result.current.tryEnter()).toBe(true);
  });

  it("重挂即重来（ref 随组件实例走）", () => {
    const { result, unmount } = renderHook(() => useReentrancyLock());
    expect(result.current.tryEnter()).toBe(true);
    unmount();
    const again = renderHook(() => useReentrancyLock());
    expect(again.result.current.tryEnter()).toBe(true);
  });
});
