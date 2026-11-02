// 观测器的接线契约：把「构建标识的两类变化 + 进程重启 + 依赖面陈旧」折叠成对外
// 可见的出口——
// ① 源码 mtime 变 → 上报一次代码更新；② bootId 变（进程真的重启）→ 回调
//    onDevServerRestart(reason, detail)；③ 首探即带 restartReason（启动器自愈重启）
//    → 也回调一次，且同一 bootId 跨刷新只提示一次；④ 依赖面陈旧（depsStale）→
//    onDepsStale(state)，同一形态跨刷新只提示一次、判定为新鲜时清掉记录。
// 取不到标识时既不误报也不抛错。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type * as CodeUpdateModule from "~/lib/shell/code-update-since-load";

import {
  BUILD_ID_POLL_MS,
  DEPS_STALE_NOTIFIED_KEY,
  DEV_RESTART_NOTIFIED_KEY,
  useCodeUpdateWatch,
} from "./use-code-update-watch";
import { hasCodeUpdatedSinceLoad, resetStaleStoreNotify } from "~/lib/shell/stale-store-notify";

/** 逐次返回可控的构建标识探针；字段为 null = 本次读不到 / 无此事。 */
type Probe = CodeUpdateModule.BuildIdProbe;
type DepsState = CodeUpdateModule.DepsFreshnessState;
const probeMock = vi.hoisted(() => vi.fn<() => Probe>());
vi.mock("~/lib/shell/code-update-since-load", async (importOriginal) => {
  const actual = await importOriginal<typeof CodeUpdateModule>();
  return {
    ...actual,
    fetchBuildId: () => Promise.resolve(probeMock()),
  };
});

/** 造一个探针；未指名的字段一律 null（聚焦本用例关心的那一维）。 */
function probe(
  buildId: string | null,
  opts: {
    bootId?: string | null;
    depsStale?: boolean | null;
    depsState?: DepsState | null;
    restartDetail?: string | null;
    restartReason?: string | null;
  } = {},
): Probe {
  return {
    buildId,
    bootId: opts.bootId ?? null,
    restartReason: opts.restartReason ?? null,
    restartDetail: opts.restartDetail ?? null,
    depsStale: opts.depsStale ?? null,
    depsState: opts.depsState ?? null,
  };
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

    renderHook(() => {
      useCodeUpdateWatch();
    });
    await settle();
    expect(probeMock).toHaveBeenCalled();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
  });

  it("加载后构建标识变化 → 上报一次代码更新", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValueOnce(probe("build-1")).mockReturnValueOnce(probe("build-2"));

    renderHook(() => {
      useCodeUpdateWatch();
    });
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(true);
  });

  it("标识一直不变 → 始终不上报（轮询的常态，不打扰用户）", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(probe("build-1"));

    renderHook(() => {
      useCodeUpdateWatch();
    });
    await settle();
    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS * 3);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
    expect(probeMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("读不到标识（服务未就绪）→ 不误报也不抛错", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(probe(null));

    renderHook(() => {
      useCodeUpdateWatch();
    });
    await settle();
    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS * 3);
    await settle();
    expect(hasCodeUpdatedSinceLoad()).toBe(false);
  });

  it("bootId 变化但没有自愈原因 → 不回调（这条由消息中心的「断开→恢复」记）", async () => {
    vi.useFakeTimers();
    const onRestart = vi.fn();
    probeMock
      .mockReturnValueOnce(probe("b1", { bootId: "boot-A" }))
      .mockReturnValueOnce(probe("b2", { bootId: "boot-B" }));

    renderHook(() => {
      useCodeUpdateWatch({ onDevServerRestart: onRestart });
    });
    await settle();
    expect(onRestart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    /* 同一次重启不再出第二条「已重启」消息：探活（2s 一拍）那边已经记了一条
     * 带时刻与原因的「断开 → 恢复」（见 use-app-service-message-log）。 */
    expect(onRestart).not.toHaveBeenCalled();
    // 重启仍然记为「跑过代码更新」。
    expect(hasCodeUpdatedSinceLoad()).toBe(true);
  });

  it("bootId 变化且带自愈原因 → 回调一次并把原因与人话归因一起给出", async () => {
    vi.useFakeTimers();
    const onRestart = vi.fn();
    const detail = "本次代码更新改了路由结构（新增 2，如 api/foo/route.ts）";
    probeMock.mockReturnValueOnce(probe("b1", { bootId: "boot-A" })).mockReturnValueOnce(
      probe("b2", {
        bootId: "boot-B",
        restartReason: "route-404-heal",
        restartDetail: detail,
      }),
    );

    renderHook(() => {
      useCodeUpdateWatch({ onDevServerRestart: onRestart });
    });
    await settle();
    expect(onRestart).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith("route-404-heal", detail);
  });

  it("首探即带 restartReason（启动器自愈重启）→ 回调一次并带上原因", async () => {
    vi.useFakeTimers();
    const onRestart = vi.fn();
    probeMock.mockReturnValue(
      probe("b1", { bootId: "boot-A", restartReason: "stale-route-table" }),
    );

    renderHook(() => {
      useCodeUpdateWatch({ onDevServerRestart: onRestart });
    });
    await settle();
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onRestart).toHaveBeenCalledWith("stale-route-table", null);
  });

  it("同一 bootId 跨刷新只提示一次（localStorage 去重）", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(
      probe("b1", { bootId: "boot-A", restartReason: "stale-route-table" }),
    );

    const first = vi.fn();
    renderHook(() => {
      useCodeUpdateWatch({ onDevServerRestart: first });
    });
    await settle();
    expect(first).toHaveBeenCalledTimes(1);

    // 模拟刷新：重挂一个 watcher，bootId 与原因不变 → 不该再提示。
    const second = vi.fn();
    renderHook(() => {
      useCodeUpdateWatch({ onDevServerRestart: second });
    });
    await settle();
    expect(second).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEV_RESTART_NOTIFIED_KEY)).toBe("boot-A");
  });

  it("首探即判依赖面陈旧 → 上报一次形态（不跟构建标识的早退走）", async () => {
    vi.useFakeTimers();
    const onDepsStale = vi.fn();
    // buildId 取不到（服务端还没就绪）：这条依赖面判定仍必须发出。
    probeMock.mockReturnValue(probe(null, { depsStale: true, depsState: "drift" }));

    renderHook(() => {
      useCodeUpdateWatch({ onDepsStale });
    });
    await settle();
    expect(onDepsStale).toHaveBeenCalledTimes(1);
    expect(onDepsStale).toHaveBeenCalledWith("drift");
  });

  it("依赖面同一形态跨刷新只提示一次（按 depsState 去重）", async () => {
    vi.useFakeTimers();
    probeMock.mockReturnValue(probe("b1", { depsStale: true, depsState: "no-install" }));

    const first = vi.fn();
    renderHook(() => {
      useCodeUpdateWatch({ onDepsStale: first });
    });
    await settle();
    expect(first).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    renderHook(() => {
      useCodeUpdateWatch({ onDepsStale: second });
    });
    await settle();
    expect(second).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEPS_STALE_NOTIFIED_KEY)).toBe("no-install");
  });

  it("依赖面判定为新鲜 → 清掉去重记录，之后再次陈旧还能提示", async () => {
    vi.useFakeTimers();
    const onDepsStale = vi.fn();
    probeMock
      .mockReturnValueOnce(probe("b1", { depsStale: true, depsState: "drift" }))
      .mockReturnValueOnce(probe("b1", { depsStale: false, depsState: "fresh" }))
      .mockReturnValueOnce(probe("b1", { depsStale: true, depsState: "drift" }));

    renderHook(() => {
      useCodeUpdateWatch({ onDepsStale });
    });
    await settle();
    expect(onDepsStale).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    expect(localStorage.getItem(DEPS_STALE_NOTIFIED_KEY)).toBeNull();

    await vi.advanceTimersByTimeAsync(BUILD_ID_POLL_MS);
    await settle();
    expect(onDepsStale).toHaveBeenCalledTimes(2);
  });

  it("依赖面陈旧但拿不到形态（老端点 / 半截响应）→ 不提示", async () => {
    vi.useFakeTimers();
    const onDepsStale = vi.fn();
    // stale 为 true 却没有 depsState：文案分不了流，宁可不说。
    probeMock.mockReturnValue(probe("b1", { depsStale: true }));

    renderHook(() => {
      useCodeUpdateWatch({ onDepsStale });
    });
    await settle();
    expect(onDepsStale).not.toHaveBeenCalled();
  });

  it("轮询间隔是「人敲一次键盘」的量级，不会空转请求", () => {
    expect(BUILD_ID_POLL_MS).toBeGreaterThanOrEqual(10_000);
    expect(BUILD_ID_POLL_MS).toBeLessThanOrEqual(120_000);
  });
});
