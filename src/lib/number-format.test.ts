import { describe, expect, it } from "vitest";

import { alphaText, fixed, trimFixed, trimmed } from "./number-format";

describe("fixed", () => {
  it("按给定小数位写数（不足补零）", () => {
    expect(fixed(0.5, 2)).toBe("0.50");
    expect(fixed(1, 2)).toBe("1.00");
    expect(fixed(1.005, 2)).toBe("1.00");
    expect(fixed(2.345, 2)).toBe("2.35");
  });

  it('非有限数给 null（不给 "NaN" / "Infinity" 字面量）', () => {
    expect(fixed(Number.NaN, 2)).toBeNull();
    expect(fixed(Number.POSITIVE_INFINITY, 2)).toBeNull();
    expect(fixed(Number.NEGATIVE_INFINITY, 1)).toBeNull();
  });

  it("小数位夹取到 [0, 20]（toFixed 的合法区间）", () => {
    expect(fixed(1.5, -3)).toBe("2");
    expect(fixed(1.5, 100)).toBe("1.50000000000000000000");
  });
});

describe("trimmed", () => {
  it("去掉小数点之后的尾零", () => {
    expect(trimmed(1, 2)).toBe("1");
    expect(trimmed(0.5, 2)).toBe("0.5");
    expect(trimmed(2.345, 2)).toBe("2.35");
  });

  it('0 给 "0"，不给空串（尾零剥完后不能剩空单元格）', () => {
    expect(trimmed(0, 2)).toBe("0");
    expect(trimmed(0, 0)).toBe("0");
  });

  it("整数不被动到小数点之前的零", () => {
    expect(trimmed(100, 2)).toBe("100");
    expect(trimmed(1000, 0)).toBe("1000");
  });

  it("非有限数给 null", () => {
    expect(trimmed(Number.NaN, 2)).toBeNull();
  });

  it('负零归一到 "0"（-1e-9 舍成 -0.00 不该显示成小于 0）', () => {
    expect(trimmed(-1e-9, 2)).toBe("0");
    expect(trimmed(-0.001, 2)).toBe("0");
    expect(trimmed(-0, 2)).toBe("0");
  });
});

describe("trimFixed", () => {
  it("整数不带小数点，小数去尾零", () => {
    expect(trimFixed(3, 2)).toBe("3");
    expect(trimFixed(0.85, 2)).toBe("0.85");
    expect(trimFixed(0.5, 2)).toBe("0.5");
  });

  it("整数判据走 Number.isInteger（1.0000001 不是整数）", () => {
    expect(trimFixed(1.0000001, 6)).toBe("1");
    expect(trimFixed(1.0000001, 8)).toBe("1.0000001");
  });

  it("非有限数给 null", () => {
    expect(trimFixed(Number.NaN, 2)).toBeNull();
  });
});

describe("alphaText", () => {
  it("固定 3 位小数、不剥尾零（它是要交给 CSS 解析的语法片段）", () => {
    expect(alphaText(0.5)).toBe("0.500");
    expect(alphaText(0.1)).toBe("0.100");
    expect(alphaText(1)).toBe("1.000");
  });

  it('非有限数回落 0（CSS 里的 "NaN" 会让整条声明失效）', () => {
    expect(alphaText(Number.NaN)).toBe("0");
    expect(alphaText(Number.POSITIVE_INFINITY)).toBe("0");
  });
});
