import { describe, expect, it } from "vitest";

import { isFilmRunning, formatShotDuration } from "./film-studio-config";

describe("isFilmRunning", () => {
  it("解析 / 生成 / 合成三个阶段都算进行中", () => {
    expect(isFilmRunning("PARSING")).toBe(true);
    expect(isFilmRunning("GENERATING")).toBe(true);
    expect(isFilmRunning("COMPOSING")).toBe(true);
  });

  it("完成 / 失败 / 取消不算进行中（决定进度条与「取消」按钮显隐）", () => {
    expect(isFilmRunning("DONE")).toBe(false);
    expect(isFilmRunning("FAILED")).toBe(false);
    expect(isFilmRunning("CANCELLED")).toBe(false);
  });
});

/* 这些断言锁的是**原视图的既有行为**（本轮只搬不改）：一位小数 + 补零到 5 位。
 * 样例数据的 "00:03.2" 与这里的 "003.0" 形态并不一致，属既有视觉问题，另开 PR 处理。 */
describe("formatShotDuration", () => {
  it("一位小数并补零到 5 位", () => {
    expect(formatShotDuration(3)).toBe("003.0");
    expect(formatShotDuration(25)).toBe("025.0");
  });

  it("四舍五入到一位小数", () => {
    expect(formatShotDuration(12.35)).toBe("012.3"); // toFixed 的实际舍入（不是四舍五入到偶数也非进一）
    expect(formatShotDuration(0)).toBe("000.0");
  });

  it("已够 5 位的数值不补零", () => {
    expect(formatShotDuration(123.4)).toBe("123.4");
  });
});
