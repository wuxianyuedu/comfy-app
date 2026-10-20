// 组合与预算判据（纯函数，node 档）——规范 17 §17.1「删掉 JSX 还能不能跑测试」。
//
// 这一层是界面每个数字的唯一出处，所以「空维按 1 计」与「叉积长度恒等于 combinationCount」
// 这两条必须钉死：前者决定「只挑风格、没勾特征」不会被显示成 0 格，后者决定
// 界面上的「K 格」与真会展开出来的清单永远对得上（同一个形状写两处就会漂）。
import { describe, expect, it } from "vitest";

import {
  combinationCount,
  enumerateCombinations,
  medianSeconds,
} from "./style-lab-matrix";

describe("combinationCount —— 空维按 1 计", () => {
  it("没有任何维度时返回 1（一套风格、不约束特征 ⇒ 一格），不是 0", () => {
    expect(combinationCount({})).toBe(1);
  });

  it("某一维没选任何值按 1 计，不会把整个乘积归零", () => {
    expect(combinationCount({ costume: [], appearance: ["长发", "短发"] })).toBe(
      2,
    );
  });

  it("单维多选就是那一维的取值数", () => {
    expect(combinationCount({ costume: ["唐装", "汉服", "旗袍"] })).toBe(3);
  });

  it("多维相乘（含一维不约束）", () => {
    expect(
      combinationCount({ a: ["1", "2"], b: ["x", "y", "z"], c: [] }),
    ).toBe(6);
  });
});

/* ETA 的唯一数据来源，所以「没历史 ⇒ null」这一档必须钉死：
   界面拿 null 显示「暂无耗时参考」，拿数字显示分钟数。若这里退化成 0，
   用户会看到「预计不到 1 分钟」——一个假快比没有数更有害。 */
describe("medianSeconds —— 实测中位数", () => {
  it("空样本返回 null（不是 0，让界面如实说暂无参考）", () => {
    expect(medianSeconds([])).toBeNull();
  });

  it("奇数个取正中那一枚", () => {
    expect(medianSeconds([30, 12, 45])).toBe(30);
  });

  it("偶数个取中间两枚的均值（中位数的定义）", () => {
    expect(medianSeconds([10, 20, 30, 40])).toBe(25);
  });

  it("乱序输入照样取对（内部排序，不要求调用方先排）", () => {
    expect(medianSeconds([90, 10, 50, 30, 70])).toBe(50);
  });

  it("离群慢样本抬不动它（这正是取中位数而非均值的理由）", () => {
    const durations = [38, 41, 39, 40, 900];
    const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
    expect(medianSeconds(durations)).toBe(40);
    expect(medianSeconds(durations)).toBeLessThan(mean);
  });

  it("不改动调用方的数组（排序在副本上做）", () => {
    const source = [5, 1, 3];
    medianSeconds(source);
    expect(source).toEqual([5, 1, 3]);
  });
});

describe("enumerateCombinations —— 与 combinationCount 同一条判据", () => {
  it("叉积长度恒等于 combinationCount", () => {
    const traits = { a: ["1", "2"], b: ["x", "y", "z"], c: [] };
    expect(enumerateCombinations(traits)).toHaveLength(
      combinationCount(traits),
    );
  });

  it("空维在结果里落成空串（不约束的显式标记），键不消失", () => {
    const combos = enumerateCombinations({ a: ["1", "2"], b: [] });
    expect(combos).toHaveLength(2);
    for (const combo of combos) {
      expect(Object.keys(combo).sort()).toEqual(["a", "b"]);
      expect(combo.b).toBe("");
    }
  });

  it("没有任何维度时给出一个空组合（对应 combinationCount 的 1）", () => {
    expect(enumerateCombinations({})).toEqual([{}]);
  });

  it("两维各两个值 → 四个组合，覆盖全部配对", () => {
    const combos = enumerateCombinations({ a: ["1", "2"], b: ["x", "y"] });
    expect(combos).toHaveLength(4);
    const keys = combos.map((c) => `${c.a}/${c.b}`).sort();
    expect(keys).toEqual(["1/x", "1/y", "2/x", "2/y"]);
  });
});
