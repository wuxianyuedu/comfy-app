// 观测器的接线契约：把「构建标识的两类变化 + 进程重启」折叠成对外可见的出口——
// ① 源码 mtime 变 → 上报一次代码更新；② bootId 变（进程真的重启）→ 回调
// onDevServerRestart；③ 首探即带 restartReason（启动器自愈重启）→ 也回调一次，
// 且同一 bootId 跨刷新只提示一次。取不到标识时既不误报也不抛错。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type * as CodeUpdateModule from "~/lib/shell/code-update-since-load";

import {
  BUILD_ID_POLL_MS,
  DEV_RESTART_NOTIFIED_KEY,
  useCodeUpdateWatch,
} from "./use-code-update-watch";
import {
  hasCodeUpdatedSinceLoad,
  resetStaleStoreNotify,
} from "~/lib/shell/stale-store-notify";

/** 逐次返回可控的构建标识探针；字段为 null = 本次读不到。 */
type Probe = CodeUpdateModule.BuildIdProbe;
const probeMock = vi.hoisted(() => vi.fn<() => Probe>());
vi.mock("~/lib/shell/code-update-since-load", async (importOriginal) => {
  const actual = await importOriginal<typeof CodeUpdateModule>();
  return {
    ...actual,
    fetchBuildId: () => Promise.resolve(probeMock()),
  };
});

/** 造一个探针（默认 bootId/restartReason 为空，聚焦 buildId 变化的老用例不受影响）。 */
function probe(
  buildId: string | null,
  bootId: string | null = null,
  restartReason: string | null = null,
): Probe {
  return { buildId, bootId, restartReason };
}

/** 让挂起的一次探测（promise 链）跑完；配合假定时器使用。 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  resetStaleStoreNotify();
  probeMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCodeUpdateWatch", () => {
  it("首探只建立基准，不当作「刚被更新」", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(probe("build-1"));

    renderHook(() => useCodeUpdateWatch());
    await settle();
    expect(probeMock).toHaveBeenCalled();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
  });

  it("加载后构建标识变化 → 上报一次代码更新", async () => {
    vi.useFakeTimers();
    probeMock
      .mockReturnValueOnce(probe("build-1"))
      .mockReturnValueOnce(probe("build-2"));

    renderHook(() => useCodeUpdateWatch());
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(true);
  });

  it("标识一直不变 → 始终不上报（轮询的常态，不打扰用户）", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(probe("build-1"));

    renderHook(() => useCodeUpdateWatch());
    await settle();
    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS * 3);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
    expect(probeMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("读不到标识（服务未就绪）→ 不误报也不抛错", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(probe(null));

    renderHook(() => useCodeUpdateWatch());
    await settle();
    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS * 3);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
  });

  it("bootId 变化（进程真的重启）→ 回调 onDevServerRestart 一次", async () => {
    vi.useFakeTimers();
    const onRestart = vi.fn();
    probeMock
      .mockReturnValueOnce(probe("b1", "boot-A"))
      .mockReturnValueOnce(probe("b2", "boot-B"));

    renderHook(() => useCodeUpdateWatch({ onDevServerRestart: onRestart }));
    await settle();
    expect(onRestart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    expect(onRestart).toHaveBeenCalledTimes(1);
    // 重启也记为「跑过代码更新」。
    expect(hasCodeUpdatedSinceLoad()).toBe(true);
  });

  it("首探即带 restartReason（启动器自愈重启）→ 回调一次并带上原因", async () => {
    vi.useFakeTimers();
    const onRestart = vi.fn();
    probeMock.mockReturnValue(probe("b1", "boot-A", "stale-route-table"));

    renderHook(() => useCodeUpdateWatch({ onDevServerRestart: onRestart }));
    await settle();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith("stale-route-table");
  });

  it("同一 bootId 跨刷新只提示一次（localStorage 去重）", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(probe("b1", "boot-A", "stale-route-table"));

    const first = vi.fn();
    renderHook(() => useCodeUpdateWatch({ onDevServerRestart: first }));
    await settle();
    expect(first).toHaveBeenCalledTimes(1);

    // 模拟刷新：重挂一个 watcher，bootId 与原因不变 → 不该再提示。
    const second = vi.fn();
    renderHook(() => useCodeUpdateWatch({ onDevServerRestart: second }));
    await settle();
    expect(second).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEV_RESTART_NOTIFIED_KEY)).toBe("boot-A");
  });

  it("轮询间隔是「人敲一次键盘」的量级，不会空转请求", () => {
    expect(BUILD_ID_POLL_MS).toBeGreaterThanOrEqual(10_000);
    expect(BUILD_ID_POLL_MS).toBeLessThanOrEqual(120_000);
  });
});
