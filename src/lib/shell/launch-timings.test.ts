import { describe, expect, it } from "vitest";

import { parseLaunchStatusText, parseLaunchTimings } from "./launch-timings";

/** 编排器 timeline 的最小夹具：两段串行 + 一段并行（后台建表与就绪等待重叠）。 */
const fixture = {
  phase: "dev-server-ready",
  ready: true,
  timings: [
    { key: "toolchain", label: "环境与工具链", startMs: 0, endMs: 600, durationMs: 600 },
    { key: "port-reap", label: "端口残留回收", startMs: 600, endMs: 700, durationMs: 100 },
    { key: "db-sync", label: "后台建表", startMs: 700, endMs: 1500, durationMs: 800 },
    { key: "wait-ready", label: "等待服务就绪", startMs: 700, endMs: 8900, durationMs: 8200 },
  ],
};

describe("parseLaunchTimings（#4327 应用内启动耗时分解）", () => {
  it("按开始时刻排序，百分比按墙钟合计占比", () => {
    const result = parseLaunchTimings(fixture)!;
    expect(result.totalMs).toBe(8900);
    expect(result.phases.map((p) => p.key)).toEqual([
      "toolchain",
      "port-reap",
      "db-sync",
      "wait-ready",
    ]);
    const wait = result.phases[3]!;
    expect(wait.percent).toBe(92.1); // 8200 / 8900
    expect(result.phases[1]!.percent).toBe(1.1); // 100 / 8900
  });

  it("合计取墙钟（最后一刻 − 最早一刻），不把并行段求和", () => {
    const result = parseLaunchTimings(fixture)!;
    // 串行求和会是 600+100+800+8200=9700 > 墙钟 8900。
    expect(result.totalMs).toBeLessThan(9700);
    expect(result.totalMs).toBe(8900);
  });

  it("进行中的段（endMs=null）按 startMs+durationMs 参与合计，并原样保留 endMs", () => {
    const running = {
      timings: [
        { key: "a", label: "A", startMs: 0, endMs: 100, durationMs: 100 },
        { key: "b", label: "B", startMs: 100, endMs: null, durationMs: 400 },
      ],
    };
    const result = parseLaunchTimings(running)!;
    expect(result.totalMs).toBe(500);
    expect(result.phases[1]!.endMs).toBeNull();
  });

  it("没有 timings / 空数组 / 形状不对 / 坏 JSON 都归「没有读数」", () => {
    expect(parseLaunchTimings({})).toBeNull();
    expect(parseLaunchTimings({ timings: [] })).toBeNull();
    expect(parseLaunchTimings({ timings: "bad" })).toBeNull();
    expect(parseLaunchTimings(null)).toBeNull();
    expect(parseLaunchStatusText("not-json")).toBeNull();
    expect(parseLaunchStatusText("")).toBeNull();
  });

  it("合计为 0（所有段都 0ms）时百分比一律 0，不除零", () => {
    const result = parseLaunchTimings({
      timings: [{ key: "a", label: "A", startMs: 0, endMs: 0, durationMs: 0 }],
    })!;
    expect(result.totalMs).toBe(0);
    expect(result.phases[0]!.percent).toBe(0);
  });

  it("坏条目被整体拒收（zod 面），不带半份坏数据", () => {
    expect(
      parseLaunchTimings({
        timings: [{ key: "a", label: "A", startMs: "x", endMs: 1, durationMs: 1 }],
      }),
    ).toBeNull();
  });
});
