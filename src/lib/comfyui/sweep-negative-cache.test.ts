// 「查无实例」短窗黏滞缓存的判据测试（ISSUE #4195）。
//
// 这份缓存拿「确认查无实例」的昂贵扫描结论换后续几拍的安静：判据错一处就会
// 把「正在启动的实例」按在「未运行」上，或把风暴原样放回来。逐条钉死：
//   · 窗口内命中、过期即失效（TTL 语义）；
//   · 空键不记不查（没有配置路径就没有可黏滞的对象）；
//   · clear 全量作废（对应「进程树事实已变」的每个重置点）；
//   · 容量上限淘汰最早一条（防路径被反复改时无界生长）。

import { beforeEach, describe, expect, it } from "vitest";

import {
  SWEEP_NEGATIVE_TTL_MS,
  clearSweepNegative,
  markSweepNegative,
  resetSweepNegativeForTests,
  sweepNegativeHit,
} from "./sweep-negative-cache";

beforeEach(() => {
  resetSweepNegativeForTests();
});

describe("sweep-negative-cache — 查无实例的短窗黏滞", () => {
  it("标记后窗口内命中，过期那拍起不再命中", () => {
    markSweepNegative(String.raw`C:\Comfy`, 1000);
    expect(sweepNegativeHit(String.raw`C:\Comfy`, 1000)).toBe(true);
    expect(sweepNegativeHit(String.raw`C:\Comfy`, 1000 + SWEEP_NEGATIVE_TTL_MS - 1)).toBe(true);
    expect(sweepNegativeHit(String.raw`C:\Comfy`, 1000 + SWEEP_NEGATIVE_TTL_MS)).toBe(false);
  });

  it("不同路径互不干扰", () => {
    markSweepNegative(String.raw`C:\Comfy`, 1000);
    expect(sweepNegativeHit(String.raw`D:\Other`, 1000)).toBe(false);
  });

  it("空键不记也不查（没有配置路径就没有可黏滞的对象）", () => {
    markSweepNegative("", 1000);
    expect(sweepNegativeHit("", 1000)).toBe(false);
  });

  it("clear 全量作废（对应每个「进程树事实已变」的重置点）", () => {
    markSweepNegative(String.raw`C:\Comfy`, 1000);
    markSweepNegative(String.raw`D:\Other`, 1000);
    clearSweepNegative();
    expect(sweepNegativeHit(String.raw`C:\Comfy`, 1001)).toBe(false);
    expect(sweepNegativeHit(String.raw`D:\Other`, 1001)).toBe(false);
  });

  it("超过容量上限淘汰最早写入的一条", () => {
    for (let i = 0; i < 10; i++) {
      markSweepNegative(String.raw`C:\path-${i}`, i + 1);
    }
    /* 最早两条已被淘汰，最后写入的仍在窗口内。 */
    expect(sweepNegativeHit(String.raw`C:\path-0`, 11)).toBe(false);
    expect(sweepNegativeHit(String.raw`C:\path-1`, 11)).toBe(false);
    expect(sweepNegativeHit(String.raw`C:\path-9`, 11)).toBe(true);
  });

  it("Date.now 缺省注入也能工作（生产调用形态）", () => {
    markSweepNegative(String.raw`C:\Comfy`);
    expect(sweepNegativeHit(String.raw`C:\Comfy`)).toBe(true);
  });
});
