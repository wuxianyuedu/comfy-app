/**
 * 成片等待预算（ISSUE #5142）：run 侧与监看侧同一份换算，镜头越多预算越大。
 */
import { describe, expect, it } from "vitest";

import { filmWaitTicksFor } from "./film-wait";

describe("filmWaitTicksFor（ISSUE #5142）", () => {
  it("底仓 240 拍，每镜追加 600 拍", () => {
    expect(filmWaitTicksFor(0)).toBe(240);
    expect(filmWaitTicksFor(1)).toBe(840);
    expect(filmWaitTicksFor(19)).toBe(240 + 19 * 600);
  });

  it("脏值（负数 / 小数 / NaN）不把预算算小或算爆", () => {
    expect(filmWaitTicksFor(-3)).toBe(240);
    expect(filmWaitTicksFor(2.9)).toBe(840 + 600);
    expect(filmWaitTicksFor(Number.NaN)).toBe(240);
  });
});
