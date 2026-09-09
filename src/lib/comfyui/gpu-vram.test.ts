// parseNvidiaSmiOutput 纯函数单测：覆盖正常 / CRLF / 多卡取首块 / 空行 /
// N/A / 非法值 / clamp 超总量等边界。实际 execFileP 调用不在此测。

import { describe, expect, it } from "vitest";
import { parseNvidiaSmiOutput } from "./gpu-vram";

describe("parseNvidiaSmiOutput", () => {
  it("单卡正常解析（used, total）", () => {
    expect(parseNvidiaSmiOutput("2048, 8192")).toEqual({
      usedMiB: 2048,
      totalMiB: 8192,
    });
  });

  it("多卡取首块（与状态栏单值口径一致）", () => {
    const raw = "2048, 8192\n1024, 4096";
    expect(parseNvidiaSmiOutput(raw)).toEqual({
      usedMiB: 2048,
      totalMiB: 8192,
    });
  });

  it("CRLF 换行也能解析", () => {
    expect(parseNvidiaSmiOutput("512, 4096\r\n")).toEqual({
      usedMiB: 512,
      totalMiB: 4096,
    });
  });

  it("空输出 / 全空行返回 null", () => {
    expect(parseNvidiaSmiOutput("")).toBeNull();
    expect(parseNvidiaSmiOutput("\n\n\n")).toBeNull();
  });

  it("N/A 或非数字返回 null", () => {
    expect(parseNvidiaSmiOutput("N/A, N/A")).toBeNull();
    expect(parseNvidiaSmiOutput("abc, 8192")).toBeNull();
  });

  it("总量 0 或负值返回 null（无效设备）", () => {
    expect(parseNvidiaSmiOutput("0, 0")).toBeNull();
    expect(parseNvidiaSmiOutput("100, -5")).toBeNull();
  });

  it("已用超过总量时 clamp 到总量（驱动读数抖动）", () => {
    expect(parseNvidiaSmiOutput("9000, 8192")).toEqual({
      usedMiB: 8192,
      totalMiB: 8192,
    });
  });
});
