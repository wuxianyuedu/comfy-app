// review-types 纯逻辑单测（Phase 8 · P8-1a）：评审判定的宽容解析 + 通用写回 reducer。
import { describe, expect, it } from "vitest";

import {
  applyReview,
  getRecordReview,
  normalizeReviewMode,
  normalizeReviewVerdict,
  reviewScoreMean,
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

  it("scores：合法维度收下、越界分夹取 1~5、note trim；非法条目丢弃（FR-QA-07）", () => {
    const v = normalizeReviewVerdict({
      pass: false,
      scores: {
        画面: { score: 9, note: " 太空 " },
        一致性: { score: -1 },
        节奏: { score: "4" },
        废维度: { nope: true },
      },
    });
    expect(v?.scores).toEqual({
      画面: { score: 5, note: "太空" },
      一致性: { score: 1, note: "" },
      // 「节奏」给了字符串分 → 非有限 number，整条丢弃（不硬转，防模型噪声）
    });
  });

  it("旧数据无 scores / scores 为空对象 → 不挂键（读作「未评分」不报错）", () => {
    expect(normalizeReviewVerdict({ pass: true })?.scores).toBeUndefined();
    expect(normalizeReviewVerdict({ pass: true, scores: {} })?.scores).toBeUndefined();
    expect(
      normalizeReviewVerdict({ pass: true, scores: "垃圾" })?.scores,
    ).toBeUndefined();
  });

  it("rubricVersion：非空字符串才挂键", () => {
    expect(normalizeReviewVerdict({ pass: true, rubricVersion: "v1" })?.rubricVersion).toBe("v1");
    expect(normalizeReviewVerdict({ pass: true, rubricVersion: "  " })?.rubricVersion).toBeUndefined();
    expect(normalizeReviewVerdict({ pass: true, rubricVersion: 3 })?.rubricVersion).toBeUndefined();
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

  it("轮次历史：记录上已有的有效判定进 reviewHistory，当前判定始终在 review", () => {
    const first: ReviewVerdict = {
      pass: false,
      issues: ["第一轮缺陷"],
      suggestion: "改",
      scoredAt: "t1",
      scores: { 画面: { score: 2, note: "差" } },
    };
    const second: ReviewVerdict = {
      pass: true,
      issues: [],
      suggestion: "",
      scoredAt: "t2",
      scores: { 画面: { score: 4, note: "好了" } },
    };
    const out = applyReview(
      applyReview([{ id: "a" }], "a", first),
      "a",
      second,
    ) as Array<Record<string, unknown>>;
    expect(out[0]?.review).toEqual(second);
    // history 只存「本轮之前」的判定；曲线 = [...reviewHistory, review]（旧→新）
    expect(out[0]?.reviewHistory).toEqual([first]);
    expect([...(out[0]?.reviewHistory as ReviewVerdict[]), second]).toEqual([
      first,
      second,
    ]);
  });

  it("轮次历史：旧判定无效（缺 pass）时不塞垃圾；历史超上限从头裁剪", () => {
    let entities: unknown[] = [{ id: "a", review: { nope: true } }];
    entities = applyReview(entities, "a", verdict);
    expect(
      (entities[0] as Record<string, unknown>).reviewHistory,
    ).toBeUndefined();

    let chain: unknown[] = [{ id: "a" }];
    for (let i = 0; i < 12; i++) {
      chain = applyReview(chain, "a", { ...verdict, scoredAt: `t${i}` });
    }
    const history = (chain[0] as Record<string, unknown>)
      .reviewHistory as ReviewVerdict[];
    expect(history).toHaveLength(9); // REVIEW_HISTORY_LIMIT
    expect(history[0]?.scoredAt).toBe("t2"); // 最早的 2 轮被裁掉
    expect((chain[0] as Record<string, unknown>).review).toMatchObject({
      scoredAt: "t11",
    });
  });
});

describe("reviewScoreMean", () => {
  it("维度均分；未评分 / 空评分 → null（调用方走「不过」旧路）", () => {
    expect(
      reviewScoreMean({
        pass: true,
        issues: [],
        suggestion: "",
        scoredAt: "t",
        scores: { a: { score: 2, note: "" }, b: { score: 5, note: "" } },
      }),
    ).toBe(3.5);
    expect(
      reviewScoreMean({ pass: true, issues: [], suggestion: "", scoredAt: "t" }),
    ).toBeNull();
  });
});
