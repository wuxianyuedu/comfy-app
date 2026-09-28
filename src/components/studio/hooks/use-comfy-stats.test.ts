// @vitest-environment jsdom
// 锁住 useComfyStats 的「连续失败迟滞」行为（本次修复的核心）。
//
// 为什么单独建这个文件：use-comfy-readiness.test.ts 的「真实轮询失败降级」用例
// 其实在首帧就通过了——stats 初值 null → online 恒 false，waitFor(online=false)
// 在第一次 poll 之前即成立，根本没走到计数器 / setStats(OFFLINE) 分支。也就是说
// 若有人把阈值改回 1、或删掉「保留旧数据」，那套全绿测试不会报警。这里用受控的
// fetchComfyStats 桩 + 手动驱动轮询，把三条迟滞语义钉死。

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ComfyStatsPayload } from "~/lib/comfy/comfy-stats-client";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/comfy/comfy-stats-client", () => ({
  fetchComfyStats: fetchMock,
}));

// 捕获 useInterval 传入的 run，手动驱动轮询（比 fake timer 更确定、不依赖真实时钟）。
let capturedRun: (() => unknown) | null = null;
vi.mock("~/components/ui/use-interval", () => ({
  useInterval: (run: () => unknown) => {
    capturedRun = run;
  },
}));

import { useComfyStats } from "./use-comfy-stats";

const GIB = 1024 * 1024 * 1024;

function onlineStats(over: Partial<ComfyStatsPayload> = {}): ComfyStatsPayload {
  return {
    online: true,
    vramUsed: 2 * GIB,
    vramFree: 6 * GIB,
    vramTotal: 8 * GIB,
    ramUsed: 16 * GIB,
    ramTotal: 32 * GIB,
    ...over,
  };
}

const OFFLINE: ComfyStatsPayload = {
  online: false,
  vramUsed: 0,
  vramFree: 0,
  vramTotal: 0,
  ramUsed: 0,
  ramTotal: 0,
};

/** 手动跑一轮轮询并等其异步落定。 */
async function tick() {
  await act(async () => {
    await capturedRun?.();
  });
}

beforeEach(() => {
  capturedRun = null;
  vi.clearAllMocks();
});

describe("useComfyStats 连续失败迟滞", () => {
  it("成功后单次失败：online 仍 true、保留上一次好数据、stale 置真（不闪未运行）", async () => {
    fetchMock.mockResolvedValueOnce(onlineStats());
    const { result } = renderHook(() => useComfyStats());
    await tick();
    expect(result.current.online).toBe(true);
    expect(result.current.stale).toBe(false);
    const goodStats = result.current.stats;

    fetchMock.mockResolvedValueOnce(OFFLINE);
    await tick();
    expect(result.current.online).toBe(true); // 未翻离线
    expect(result.current.stats).toBe(goodStats); // 保留旧数据
    expect(result.current.stale).toBe(true); // 打陈旧标记
  });

  it("连续 3 次才提交离线：第 1、2 次仍在线，第 3 次翻离线", async () => {
    fetchMock.mockResolvedValueOnce(onlineStats());
    const { result } = renderHook(() => useComfyStats());
    await tick();

    fetchMock.mockResolvedValue(OFFLINE);
    await tick(); // fail 1
    expect(result.current.online).toBe(true);
    await tick(); // fail 2
    expect(result.current.online).toBe(true);
    await tick(); // fail 3 → 提交离线
    expect(result.current.online).toBe(false);
    expect(result.current.stale).toBe(false);
  });

  it("失败若干后一次成功：计数清零（再来单次失败仍在容忍期、不翻离线）", async () => {
    fetchMock.mockResolvedValueOnce(onlineStats());
    const { result } = renderHook(() => useComfyStats());
    await tick();

    fetchMock.mockResolvedValue(OFFLINE);
    await tick(); // fail 1
    await tick(); // fail 2（若不清零，下一次成功前的 fail 会累积到阈值）
    fetchMock.mockResolvedValueOnce(onlineStats());
    await tick(); // success → 清零
    expect(result.current.online).toBe(true);
    expect(result.current.stale).toBe(false);

    fetchMock.mockResolvedValueOnce(OFFLINE);
    await tick(); // fail 1 again → 容忍期，不翻离线
    expect(result.current.online).toBe(true);
  });

  it("从未成功时首次即失败：stats 保持 null、online 为 false（不假装在线）", async () => {
    fetchMock.mockResolvedValue(OFFLINE);
    const { result } = renderHook(() => useComfyStats());
    await tick();
    // 容忍期虽返回 true，但没有可保留的旧数据 → stats 仍 null → online false
    expect(result.current.stats).toBeNull();
    expect(result.current.online).toBe(false);
  });
});

describe("useComfyStats 进程级判活（与 /api/comfy/queue 同口径）", () => {
  /** 路由在 HTTP 失败但进程快照判活时的返回形态。 */
  const aliveButNoAnswer: ComfyStatsPayload = {
    online: false,
    processAlive: true,
    vramUsed: 0,
    vramFree: 0,
    vramTotal: 0,
    ramUsed: 0,
    ramTotal: 0,
  };

  it("成功后连续「进程在但没应答」：online 保持 true、保留旧数据置 stale、不翻离线", async () => {
    fetchMock.mockResolvedValueOnce(onlineStats());
    const { result } = renderHook(() => useComfyStats());
    await tick();
    expect(result.current.online).toBe(true);

    fetchMock.mockResolvedValue(aliveButNoAnswer);
    for (let i = 0; i < 5; i++) await tick(); // 远超离线阈值，也不该翻离线

    expect(result.current.online).toBe(true);
    expect(result.current.stats?.vramUsed).toBe(2 * GIB);
    expect(result.current.stale).toBe(true);
  });

  it("从没读到过数据 + 进程在跑：online 为 true（连接中），不报未运行", async () => {
    fetchMock.mockResolvedValue(aliveButNoAnswer);
    const { result } = renderHook(() => useComfyStats());
    for (let i = 0; i < 5; i++) await tick();

    expect(result.current.online).toBe(true);
    expect(result.current.stats).toBeNull();
  });

  it("进程真没了（无 processAlive）连续达阈值：翻离线", async () => {
    fetchMock.mockResolvedValueOnce(onlineStats());
    const { result } = renderHook(() => useComfyStats());
    await tick();
    fetchMock.mockResolvedValue({ ...OFFLINE });
    await tick();
    await tick();
    await tick();

    expect(result.current.online).toBe(false);
    expect(result.current.stats).toEqual(OFFLINE);
  });
});
