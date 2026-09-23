// review-types 纯逻辑单测（Phase 8 · P8-1a）：评审判定的宽容解析 + 通用写回 reducer。
import { describe, expect, it } from "vitest";

import {
  applyReview,
  getRecordReview,
  normalizeReviewMode,
  normalizeReviewVerdict,
  type ReviewVerdict,
} from "./review-types";

describe("normalizeReviewMode", () => {
  it("合法值原样，非法/缺省回落 gacha", () => {
    expect(normalizeReviewMode("gacha")).toBe("gacha");
    expect(normalizeReviewMode("reprompt")).toBe("reprompt");
    expect(normalizeReviewMode("乱")).toBe("gacha");
    expect(normalizeReviewMode(undefined)).toBe("gacha");
    expect(normalizeReviewMode(1)).toBe("gacha");
  });
});

describe("normalizeReviewVerdict", () => {
  it("非对象 / 缺 pass 布尔 → null（没评过，不硬造默认判定）", () => {
    expect(normalizeReviewVerdict(null)).toBeNull();
    expect(normalizeReviewVerdict("x")).toBeNull();
    expect(normalizeReviewVerdict({})).toBeNull();
    expect(normalizeReviewVerdict({ pass: "true" })).toBeNull();
    expect(normalizeReviewVerdict([])).toBeNull();
  });

  it("完整判定原样读出", () => {
    const v = normalizeReviewVerdict({
      pass: false,
      issues: ["画面含混", "与基调不符"],
      suggestion: "补充光线与人物动作",
      scoredAt: "t1",
    });
    expect(v).toEqual({
      pass: false,
      issues: ["画面含混", "与基调不符"],
      suggestion: "补充光线与人物动作",
      scoredAt: "t1",
    });
  });

  it("pass=true 也认（合格是有效判定）；可选字段缺省回落", () => {
    const v = normalizeReviewVerdict({ pass: true });
    expect(v).toEqual({
      pass: true,
      issues: [],
      suggestion: "",
      scoredAt: "",
    });
  });

  it("issues 只收非空字符串、trim；非数组丢弃；suggestion 非字符串回落空", () => {
    const v = normalizeReviewVerdict({
      pass: false,
      issues: ["  缺陷A  ", "", 1, null, "缺陷B"],
      suggestion: 42,
    });
    expect(v?.issues).toEqual(["缺陷A", "缺陷B"]);
    expect(v?.suggestion).toBe("");
  });
});

describe("getRecordReview", () => {
  it("读记录上的 review；非对象 / 无 review / 非法 review → null", () => {
    const verdict: ReviewVerdict = {
      pass: false,
      issues: ["x"],
      suggestion: "y",
      scoredAt: "t",
    };
    expect(getRecordReview({ id: "a", review: verdict })?.pass).toBe(false);
    expect(getRecordReview("字符串")).toBeNull();
    expect(getRecordReview({ id: "a" })).toBeNull();
    expect(getRecordReview({ id: "a", review: { nope: 1 } })).toBeNull();
  });
});

describe("applyReview", () => {
  const verdict: ReviewVerdict = {
    pass: false,
    issues: ["画面含混"],
    suggestion: "更具体",
    scoredAt: "t",
  };

  it("按 id 命中写回 review；其它记录原样引用（镜头 / 角色共用）", () => {
    const entities = [
      { id: "a", prompt: "p" },
      { id: "b", name: "角色" },
    ];
    const out = applyReview(entities, "b", verdict) as Record<
      string,
      unknown
    >[];
    expect(out[0]).toBe(entities[0]);
    expect(out[1]).not.toBe(entities[1]);
    expect(out[1]!.review).toEqual(verdict);
    // 不改原入参（不可变）
    expect((entities[1] as Record<string, unknown>).review).toBeUndefined();
  });

  it("无命中 / 非记录项 → 原样返回入参引用（调用方据此判断无需落库）", () => {
    const entities = ["字符串项", { id: "a" }];
    expect(applyReview(entities, "missing", verdict)).toBe(entities);
  });
});
