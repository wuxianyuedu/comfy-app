// @vitest-environment jsdom
// 观测器的接线契约：把「构建标识的两类变化」折叠成「上报过一次代码更新」，
// 并保证取不到标识时既不误报也不抛错（规范 11.2 行为优先，只断言对外可见的事实）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type * as CodeUpdateModule from "~/lib/shell/code-update-since-load";

import { BUILD_ID_POLL_MS, useCodeUpdateWatch } from "./use-code-update-watch";
import {
  hasCodeUpdatedSinceLoad,
  resetStaleStoreNotify,
} from "~/lib/shell/stale-store-notify";

/** 逐次返回可控的构建标识；null = 本次读不到。 */
const probeMock = vi.hoisted(() =>
  vi.fn<(buildId: string | null) => { buildId: string | null }>(),
);
vi.mock("~/lib/shell/code-update-since-load", async (importOriginal) => {
  const actual = await importOriginal<typeof CodeUpdateModule>();
  return {
    ...actual,
    fetchBuildId: () => Promise.resolve(probeMock("probe")),
  };
});

/** 让挂起的一次探测（promise 链）跑完；配合假定时器使用。 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  resetStaleStoreNotify();
  probeMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCodeUpdateWatch", () => {
  it("首探只建立基准，不当作「刚被更新」", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue({ buildId: "build-1" });

    renderHook(() => useCodeUpdateWatch());
    await settle();
    expect(probeMock).toHaveBeenCalled();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
  });

  it("加载后构建标识变化 → 上报一次代码更新", async () => {
    vi.useFakeTimers();
    probeMock
      .mockReturnValueOnce({ buildId: "build-1" })
      .mockReturnValueOnce({ buildId: "build-2" });

    renderHook(() => useCodeUpdateWatch());
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(true);
  });

  it("标识一直不变 → 始终不上报（轮询的常态，不打扰用户）", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue({ buildId: "build-1" });

    renderHook(() => useCodeUpdateWatch());
    await settle();
    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS * 3);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
    expect(probeMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("读不到标识（服务未就绪）→ 不误报也不抛错", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue({ buildId: null });

    renderHook(() => useCodeUpdateWatch());
    await settle();
    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS * 3);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
  });

  it("轮询间隔是「人敲一次键盘」的量级，不会空转请求", () => {
    expect(BUILD_ID_POLL_MS).toBeGreaterThanOrEqual(10_000);
    expect(BUILD_ID_POLL_MS).toBeLessThanOrEqual(120_000);
  });
});
