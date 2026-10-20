// 组合与预算判据（纯函数，node 档）——规范 17 §17.1「删掉 JSX 还能不能跑测试」。
//
// 这一层是界面每个数字的唯一出处，所以「空维按 1 计」与「叉积长度恒等于 combinationCount」
// 这两条必须钉死：前者决定「只挑风格、没勾特征」不会被显示成 0 格，后者决定
// 界面上的「K 格」与真会展开出来的清单永远对得上（同一个形状写两处就会漂）。
import { describe, expect, it } from "vitest";

import { combinationCount, enumerateCombinations } from "./style-lab-matrix";

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
