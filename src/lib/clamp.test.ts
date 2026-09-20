/**
 * 数值夹取的判据（规范 16 §16.2.4.63）。
 *
 * 这条账的实质不是「重复」而是**几个从没被写下来的语义决定**：参数顺序
 * （`clamp(x, min, max)` 与 `clamp(min, max, x)` 类型上不可分辨）、取整在
 * 内层还是外层、以及**非有限数怎么办**（`Math.max(0, NaN)` 是 `NaN`，
 * 一路静默传播）。用例逐条钉住这三件事。
 */
import { describe, expect, it } from "vitest";

import { clamp, clampInt } from "./clamp";

describe("clamp", () => {
  it("区间内的值原样返回", () => {
    expect(clamp(42, 0, 100)).toBe(42);
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });

  it("越界夹到对应的那一端", () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-3, 0, 100)).toBe(0);
  });

  it("非有限数返回区间起点（不是 NaN）", () => {
    /* 本条账最要紧的一句：`Math.max(0, NaN)` 是 `NaN`，它会一路静默传播到
     * `style` / 落库 / 下一次运算。夹取的语义是「给我一个落在区间里的数」。 */
    expect(clamp(Number.NaN, 0, 100)).toBe(0);
    expect(clamp(Number.POSITIVE_INFINITY, 0, 100)).toBe(100);
    expect(clamp(Number.NEGATIVE_INFINITY, 0, 100)).toBe(0);
    expect(clamp(Number.NaN, 5, 10)).toBe(5);
  });

  it("负数区间同样成立（不假设 min 是 0）", () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(-20, -10, -1)).toBe(-10);
    expect(clamp(3, -10, -1)).toBe(-1);
  });

  it("min > max 时结果落在 min（不悄悄换序，把常量写错暴露出来）", () => {
    /* 换序会让「区间写反」这个错误彻底藏起来；这里刻意不换序。 */
    expect(clamp(5, 10, 0)).toBe(10);
  });

  it("小数不被取整（取整是 clampInt 的事）", () => {
    expect(clamp(3.7, 0, 10)).toBe(3.7);
  });
});

describe("clampInt", () => {
  it("默认按 round 取整（先夹后整的在范围内值）", () => {
    expect(clampInt(3.6, 0, 100)).toBe(4);
    expect(clampInt(3.4, 0, 100)).toBe(3);
  });

  it("先夹后整：越界值夹到端点，得到一个端点的整数", () => {
    /* 先整后夹会在 `[0, 0.4]` 区间里给出 `0.4`（一个「不是整数的整数值」）。 */
    expect(clampInt(120.4, 0, 100)).toBe(100);
    expect(clampInt(0.6, 0, 0.4)).toBe(0.4);
  });

  it("mode=floor / trunc 各有落点（帧数与分页的取整口径不同）", () => {
    expect(clampInt(3.9, 0, 100, { mode: "floor" })).toBe(3);
    expect(clampInt(-3.9, -100, 100, { mode: "trunc" })).toBe(-3);
    expect(clampInt(-3.9, -100, 100, { mode: "floor" })).toBe(-4);
  });

  it("非有限数走 clamp 的同一口径（取整后仍非有限）", () => {
    expect(clampInt(Number.NaN, 1, 500)).toBe(1);
    expect(clampInt(Number.POSITIVE_INFINITY, 1, 500)).toBe(500);
  });

  it("返回的永远是整数（除非区间端点本身不是）", () => {
    for (const v of [1.2, 1.8, 99.5, 1000.7, -2.3]) {
      expect(Number.isInteger(clampInt(v, 1, 100))).toBe(true);
    }
  });
});
