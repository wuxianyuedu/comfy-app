// @vitest-environment jsdom
// 状态栏 controller 的行为测试（ISSUE #324 交付项 2 / 规范 11.2）：
// 锁住「占用条显隐 + 双口径降级 + 轮询失败可见降级 + 就绪三态」。
//
// 两层被测对象各取所需：
//  1) 纯折叠逻辑：把 useComfyStats 的返回值直接喂给 controller（spy 替换），
//     覆盖各数据形态；用 spy 而非 mock 网络，runner 是 jsdom、客户端走 fetch。
//  2) 真实轮询降级：不 mock，让真实 fetchComfyStats 打到未启动的 /api，
//     验证「拉取失败 → offline + 可见降级」（不能静默消失）。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

import type { ComfyStatsPayload } from "~/lib/comfy/comfy-stats-client";

import * as comfyStats from "./use-comfy-stats";
import { useComfyReadiness } from "./use-comfy-readiness";

const GIB = 1024 * 1024 * 1024;

async function noopAsync() {
  /* 测试桩：controller 不消费 refresh，仅为满足返回类型 */
}

/** 已连接的正常回包；smi* 省略即代表非 NVIDIA 卡 / nvidia-smi 不可用。 */
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

/** 让 controller 读到指定数据形态（不改网络层，只换 hook 返回）。
 *  online 显式传入：connecting 态正是「已连上但首个采样未到」，stats 为 null
 *  但 online 为 true，不能由 stats 反推。 */
function stubStats(
  online: boolean,
  stats: ComfyStatsPayload | null,
  stale = false,
) {
  return vi.spyOn(comfyStats, "useComfyStats").mockReturnValue({
    stats,
    online,
    stale,
    refresh: noopAsync,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useComfyReadiness（数据形态折叠）", () => {
  it("未连接：占用条全部隐藏（不显示 0% 空白项），并在状态栏给出可见降级提示", () => {
    stubStats(false, OFFLINE);
    const { result } = renderHook(() => useComfyReadiness());

    expect(result.current.online).toBe(false);
    expect(result.current.cudaVram).toBeNull();
    expect(result.current.smiVram).toBeNull();
    expect(result.current.ram).toBeNull();
    // 降级必须可见，不能静默消失
    expect(result.current.degradedNote).toContain("未运行");
  });

  it("连接已建立但首个采样未回来：connecting，占用条暂不显示也不报未连接", () => {
    stubStats(true, null);
    const { result } = renderHook(() => useComfyReadiness());

    expect(result.current.connecting).toBe(true);
    expect(result.current.cudaVram).toBeNull();
    expect(result.current.ram).toBeNull();
  });

  it("非 NVIDIA 卡 / nvidia-smi 不可用：只显示 ComfyUI CUDA 口径，不留显存空项", () => {
    // smiVramUsed / smiVramTotal 缺省 = gpu-vram.ts 查询失败时服务端的形态
    stubStats(true, onlineStats());
    const { result } = renderHook(() => useComfyReadiness());

    expect(result.current.smiVram).toBeNull();
    expect(result.current.cudaVram).toEqual({
      used: 2 * GIB,
      total: 8 * GIB,
      pct: 25,
    });
    expect(result.current.ram).toEqual({
      used: 16 * GIB,
      total: 32 * GIB,
      pct: 50,
    });
    expect(result.current.online).toBe(true);
    expect(result.current.degradedNote).toBeNull();
  });

  it("双口径同时可用：两项并列且各自百分比独立计算", () => {
    stubStats(
      true,
      onlineStats({ smiVramUsed: 3 * GIB, smiVramTotal: 12 * GIB }),
    );
    const { result } = renderHook(() => useComfyReadiness());

    expect(result.current.cudaVram?.pct).toBe(25);
    expect(result.current.smiVram).toEqual({
      used: 3 * GIB,
      total: 12 * GIB,
      pct: 25,
    });
  });

  it("总量为 0（纯 CPU 后端）时对应占用条隐藏，而非显示 0%", () => {
    stubStats(
      true,
      onlineStats({
        vramUsed: 0,
        vramFree: 0,
        vramTotal: 0,
        smiVramUsed: 0,
        smiVramTotal: 0,
      }),
    );
    const { result } = renderHook(() => useComfyReadiness());

    expect(result.current.cudaVram).toBeNull();
    expect(result.current.smiVram).toBeNull();
    // 内存可用则仍显示，不因显存缺失整体隐藏
    expect(result.current.ram?.pct).toBe(50);
  });

  it("用量百分比 clamp 到 100（驱动读数抖动不越界）", () => {
    stubStats(true, onlineStats({ ramUsed: 40 * GIB, ramTotal: 32 * GIB }));
    const { result } = renderHook(() => useComfyReadiness());

    expect(result.current.ram?.pct).toBe(100);
  });
});

describe("useComfyReadiness（真实轮询失败降级）", () => {
  it("轮询接口不可达：回落到 offline 且有可见降级，不静默消失", async () => {
    // 不 mock 网络：jsdom 下 fetch 打相对路径会失败，正是「后端不可达」形态
    const { result } = renderHook(() => useComfyReadiness());

    await waitFor(() => expect(result.current.online).toBe(false));
    expect(result.current.degradedNote).not.toBeNull();
    expect(result.current.cudaVram).toBeNull();
  });
});
