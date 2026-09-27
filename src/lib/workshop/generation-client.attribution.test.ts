// 生成归属出口的判据。
//
// 这个函数只做一件事：把「属于哪个项目、为哪一镜跑的」挂到一次生成的入参上。
// 三条断言对应三个会被弄错的点：
//   · 有值要真的带上（否则健康度条读不到归属）；
//   · 空值**不能写成空串**（库里「无归属」和「归属为空」必须是两件事，
//     历史行全是空串时，统计会把「没归属」读成「这一镜没出图」）；
//   · 不能就地改原对象（同一份 input 在调用方还可能被用于别的判断）。
import { describe, expect, it } from "vitest";

import { withGenerationAttribution } from "./generation-client";

const base = { workflow: "wf-1", prompt: "a cat" };

describe("withGenerationAttribution", () => {
  it("有项目与镜头时两个字段都带上", () => {
    expect(
      withGenerationAttribution(base, {
        projectId: "proj_1",
        shotId: "shot-3",
      }),
    ).toMatchObject({ projectId: "proj_1", shotId: "shot-3" });
  });

  it("空串 / null / undefined 一律不写字段，而不是写成空串", () => {
    for (const attribution of [
      { projectId: "", shotId: "" },
      { projectId: null, shotId: null },
      {},
    ]) {
      const next = withGenerationAttribution(base, attribution);
      expect("projectId" in next).toBe(false);
      expect("shotId" in next).toBe(false);
    }
  });

  it("不修改入参对象（调用方还拿着它做别的判断）", () => {
    const frozen = Object.freeze(base);
    expect(() =>
      withGenerationAttribution(frozen, { shotId: "s1" }),
    ).not.toThrow();
    expect("shotId" in base).toBe(false);
  });
});
