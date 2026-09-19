/**
 * 「异步动作的进度」数值口径的判据（规范 16 §16.2.4.19）。
 *
 * 这条账与 `display-value` / `list-filter` 同族：**不是重复代码，是口径**。
 * 全库 10 处各写一遍「把某个数变成进度条宽度」，而写法分四派：
 *
 *   · `Math.max(4, p)`  —— 一个**下限**（0% 时也画一格），另外六处没有
 *   · `Math.min(100, (done / total) * 100)` —— 自己算比例
 *   · 直接 `${x}%`      —— 不夹取，接口给 120 就溢出
 *
 * 三条都编译、都运行、类型都对，差别只在几个**语义决定**上。用例重点即这几点：
 *   1. 夹取到 `[0, 100]`（负值不反着画、超量不溢出）；
 *   2. 非有限数（NaN / Infinity）**不当 0** 之外还得分清「确定 0」与「不确定」；
 *   3. `toPct` 在分母不可用时给 `null`（不确定态），不是 0；
 *   4. `pctToWidth` 的**下限只抬非零值** —— 0 恒为 0（这正是 `Math.max(4, 0)`
 *      那个旧写法的缺陷：没开始也画成跑了 4%）。
 */
import { describe, expect, it } from "vitest";

import { PROGRESS_MAX, clampPct, pctToWidth, toPct } from "./progress";

describe("clampPct", () => {
  it("夹取到 [0, 100] 并取整", () => {
    expect(clampPct(0)).toBe(0);
    expect(clampPct(42.4)).toBe(42);
    expect(clampPct(42.6)).toBe(43);
    expect(clampPct(100)).toBe(100);
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(120)).toBe(100);
  });

  it("非有限数落到 0（此处是「确定值」语义）", () => {
    expect(clampPct(Number.NaN)).toBe(0);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampPct(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("上限就是 100", () => {
    expect(PROGRESS_MAX).toBe(100);
  });
});

describe("toPct", () => {
  it("正常分母给出百分比", () => {
    expect(toPct(3, 10)).toBe(30);
    expect(toPct(1, 3)).toBe(33);
    expect(toPct(0, 10)).toBe(0);
    expect(toPct(10, 10)).toBe(100);
  });

  it("分母不可用 → null（不确定态），不是 0", () => {
    /* 「总数未知」与「进度是 0」是两件事：前者该给滑动条纹，
       后者该给空条。混为一谈正是 ParseProgressBanner 那处
       `progress.total > 0 ? … : 0` 的写法要修的地方。 */
    expect(toPct(3, 0)).toBeNull();
    expect(toPct(3, -1)).toBeNull();
    expect(toPct(3, Number.NaN)).toBeNull();
    expect(toPct(3, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("分子不可用 → null", () => {
    expect(toPct(Number.NaN, 10)).toBeNull();
    expect(toPct(Number.POSITIVE_INFINITY, 10)).toBeNull();
  });

  it("超量与负量都夹取", () => {
    expect(toPct(20, 10)).toBe(100);
    expect(toPct(-3, 10)).toBe(0);
  });
});

describe("pctToWidth", () => {
  it("无下限时就是夹取后的值", () => {
    expect(pctToWidth(0)).toBe(0);
    expect(pctToWidth(50)).toBe(50);
    expect(pctToWidth(150)).toBe(100);
    expect(pctToWidth(-10)).toBe(0);
  });

  it("null（不确定态）宽度为 0 —— 不确定的动效由组件给条纹，不是宽度", () => {
    expect(pctToWidth(null)).toBe(0);
  });

  it("minVisible 只抬非零值：0 恒为 0", () => {
    /* 这一条是本出口存在的理由。旧写法 `Math.max(4, p)` 会把「没开始」
       也画成 4% 宽；新口径是「0 就是 0，刚开始才给一格」。 */
    expect(pctToWidth(0, { minVisible: 4 })).toBe(0);
    expect(pctToWidth(1, { minVisible: 4 })).toBe(4);
    expect(pctToWidth(3.2, { minVisible: 4 })).toBe(4);
    expect(pctToWidth(50, { minVisible: 4 })).toBe(50);
  });

  it("minVisible 也不越过 100", () => {
    expect(pctToWidth(100, { minVisible: 200 })).toBe(100);
  });
});
