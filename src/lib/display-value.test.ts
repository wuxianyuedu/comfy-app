/**
 * 「值不存在时显示什么」的判据（规范 16 §16.2.4）。
 *
 * 这条账的形状是**口径**，不是某个组件：收口前全库 31 处各写一遍，
 * 而 `??` / `||` / `> 0` / `!= null` 四种写法只差一两个字符 ——
 * 都编译、都运行、类型都对，差别只在「0 与空串算不算有值」这一个语义决定上。
 * 所以这里的用例重点**不是**「字符串怎么转文本」（那是 `String()` 的事），
 * 而是**边界值站哪一边**：
 *   · `0` / `false` / `NaN` 之外的值 → **照常显示**（真实测到的值不是缺值）
 *   · `""` / `null` / `undefined` → 占位符
 *   · `NaN` → 占位符（它是「算出来不是个数」，不是「算出来是 0」）
 */
import { describe, expect, it } from "vitest";

import { EMPTY_PLACEHOLDER, displayValue, nonEmpty } from "./display-value";

describe("displayValue", () => {
  it("缺值三种形态都给占位符", () => {
    expect(displayValue(undefined)).toBe(EMPTY_PLACEHOLDER);
    expect(displayValue(null)).toBe(EMPTY_PLACEHOLDER);
    expect(displayValue("")).toBe(EMPTY_PLACEHOLDER);
  });

  it('**0 与 false 照常显示** —— 这是与 `x || "—"` 的关键差别', () => {
    expect(displayValue(0)).toBe("0");
    expect(displayValue(false)).toBe("false");
    /* 收口前 ProjectOutputs 的参数表把 `steps=0` 显示成「—」，
     * 让用户以为这项没取到 —— 它是真实跑过的 0 步。 */
    expect(displayValue(0)).not.toBe(EMPTY_PLACEHOLDER);
  });

  it("NaN 给占位符：算出来不是个数 ≠ 算出来是 0", () => {
    expect(displayValue(Number.NaN)).toBe(EMPTY_PLACEHOLDER);
  });

  it("正常值走 String 语义（含 bigint / 负数 / 小数）", () => {
    expect(displayValue("abc")).toBe("abc");
    expect(displayValue(12.5)).toBe("12.5");
    expect(displayValue(-3)).toBe("-3");
    expect(displayValue(10n)).toBe("10");
    expect(displayValue(true)).toBe("true");
  });

  it("可以换占位符（不同域可能有不同约定）", () => {
    expect(displayValue(null, { fallback: "N/A" })).toBe("N/A");
    expect(EMPTY_PLACEHOLDER).toBe("—");
  });

  it("对象 / 数组不炸：走自有 toString（不假装能画出来）", () => {
    expect(displayValue([])).toBe("");
    expect(displayValue({})).toBe("[object Object]");
  });
});

describe("nonEmpty", () => {
  it("缺值给 null（调用方自己决定隐藏还是占位）", () => {
    expect(nonEmpty(undefined)).toBeNull();
    expect(nonEmpty(null)).toBeNull();
    expect(nonEmpty("")).toBeNull();
    expect(nonEmpty(Number.NaN)).toBeNull();
  });

  it("有值给文本，0 / false 不吞", () => {
    expect(nonEmpty(0)).toBe("0");
    expect(nonEmpty(false)).toBe("false");
    expect(nonEmpty("x")).toBe("x");
  });

  it("组合场景：fmtBytes(x) 才是判空的那一层，占位符只有一处定义", () => {
    /* 收口前最常见的误写是 `fmtBytes(x) ?? "—"` —— 占位符被硬编码第二遍。
     * 现在由 displayValue 兜，写的人不再需要知道占位符长什么样。 */
    const fmtBytes = (n: number | null) => (n === null ? null : `${n} B`);
    expect(displayValue(fmtBytes(null))).toBe(EMPTY_PLACEHOLDER);
    expect(displayValue(fmtBytes(0))).toBe("0 B");
  });
});
