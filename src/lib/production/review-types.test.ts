// review-types 纯逻辑单测（Phase 8 · P8-1a）：评审判定的宽容解析 + 通用写回 reducer。
import { describe, expect, it } from "vitest";

import {
  applyHumanRating,
  applyHumanVerdict,
  applyImageReview,
  applyReview,
  applyScriptHumanVerdict,
  applyScriptReview,
  getRecordHumanVerdict,
  getRecordImageReview,
  getRecordReview,
  normalizeHumanRating,
  normalizeHumanVerdict,
  normalizeReviewMode,
  normalizeReviewVerdict,
  normalizeScriptReviewState,
  recordScriptRevision,
  reviewScoreMean,
  weakScoreEntries,
  type HumanVerdict,
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
      issues: ["画面含混", "与基调不符"],
      pass: false,
      scoredAt: "t1",
      suggestion: "补充光线与人物动作",
    });
    expect(v).toEqual({
      issues: ["画面含混", "与基调不符"],
      pass: false,
      scoredAt: "t1",
      suggestion: "补充光线与人物动作",
    });
  });

  it("pass=true 也认（合格是有效判定）；可选字段缺省回落", () => {
    const v = normalizeReviewVerdict({ pass: true });
    expect(v).toEqual({
      issues: [],
      pass: true,
      scoredAt: "",
      suggestion: "",
    });
  });

  it("issues 只收非空字符串、trim；非数组丢弃；suggestion 非字符串回落空", () => {
    const v = normalizeReviewVerdict({
      issues: ["  缺陷A  ", "", 1, null, "缺陷B"],
      pass: false,
      suggestion: 42,
    });
    expect(v?.issues).toEqual(["缺陷A", "缺陷B"]);
    expect(v?.suggestion).toBe("");
  });

  it("scores：合法维度收下、越界分夹取 1~5、note trim；非法条目丢弃（FR-QA-07）", () => {
    const v = normalizeReviewVerdict({
      pass: false,
      scores: {
        一致性: { score: -1 },
        废维度: { nope: true },
        画面: { note: " 太空 ", score: 9 },
        节奏: { score: "4" },
      },
    });
    expect(v?.scores).toEqual({
      一致性: { note: "", score: 1 },
      画面: { note: "太空", score: 5 },
      // 「节奏」给了字符串分 → 非有限 number，整条丢弃（不硬转，防模型噪声）
    });
  });

  it("旧数据无 scores / scores 为空对象 → 不挂键（读作「未评分」不报错）", () => {
    expect(normalizeReviewVerdict({ pass: true })?.scores).toBeUndefined();
    expect(normalizeReviewVerdict({ pass: true, scores: {} })?.scores).toBeUndefined();
    expect(normalizeReviewVerdict({ pass: true, scores: "垃圾" })?.scores).toBeUndefined();
  });

  it("rubricVersion：非空字符串才挂键", () => {
    expect(normalizeReviewVerdict({ pass: true, rubricVersion: "v1" })?.rubricVersion).toBe("v1");
    expect(
      normalizeReviewVerdict({ pass: true, rubricVersion: "  " })?.rubricVersion,
    ).toBeUndefined();
    expect(normalizeReviewVerdict({ pass: true, rubricVersion: 3 })?.rubricVersion).toBeUndefined();
  });
});

describe("getRecordReview", () => {
  it("读记录上的 review；非对象 / 无 review / 非法 review → null", () => {
    const verdict: ReviewVerdict = {
      issues: ["x"],
      pass: false,
      scoredAt: "t",
      suggestion: "y",
    };
    expect(getRecordReview({ id: "a", review: verdict })?.pass).toBe(false);
    expect(getRecordReview("字符串")).toBeNull();
    expect(getRecordReview({ id: "a" })).toBeNull();
    expect(getRecordReview({ id: "a", review: { nope: 1 } })).toBeNull();
  });
});

describe("applyReview", () => {
  const verdict: ReviewVerdict = {
    issues: ["画面含混"],
    pass: false,
    scoredAt: "t",
    suggestion: "更具体",
  };

  it("按 id 命中写回 review；其它记录原样引用（镜头 / 角色共用）", () => {
    const entities = [
      { id: "a", prompt: "p" },
      { id: "b", name: "角色" },
    ];
    const out = /* SAFETY: 类型断言已复核 */ applyReview(entities, "b", verdict) as Array<
      Record<string, unknown>
    >;
    expect(out[0]).toBe(entities[0]);
    expect(out[1]).not.toBe(entities[1]);
    expect(out[1]!.review).toEqual(verdict);
    // 不改原入参（不可变）
    expect(
      /* SAFETY: 类型断言已复核 */ (entities[1] as Record<string, unknown>).review,
    ).toBeUndefined();
  });

  it("无命中 / 非记录项 → 原样返回入参引用（调用方据此判断无需落库）", () => {
    const entities = ["字符串项", { id: "a" }];
    expect(applyReview(entities, "missing", verdict)).toBe(entities);
  });

  it("轮次历史：记录上已有的有效判定进 reviewHistory，当前判定始终在 review", () => {
    const first: ReviewVerdict = {
      issues: ["第一轮缺陷"],
      pass: false,
      scoredAt: "t1",
      scores: { 画面: { note: "差", score: 2 } },
      suggestion: "改",
    };
    const second: ReviewVerdict = {
      issues: [],
      pass: true,
      scoredAt: "t2",
      scores: { 画面: { note: "好了", score: 4 } },
      suggestion: "",
    };
    const out = /* SAFETY: 类型断言已复核 */ applyReview(
      applyReview([{ id: "a" }], "a", first),
      "a",
      second,
    ) as Array<Record<string, unknown>>;
    expect(out[0]?.review).toEqual(second);
    // history 只存「本轮之前」的判定；曲线 = [...reviewHistory, review]（旧→新）
    expect(out[0]?.reviewHistory).toEqual([first]);
    expect([
      .../* SAFETY: 类型断言已复核 */ (out[0]?.reviewHistory as Array<ReviewVerdict>),
      second,
    ]).toEqual([first, second]);
  });

  it("轮次历史：旧判定无效（缺 pass）时不塞垃圾；历史超上限从头裁剪", () => {
    let entities: Array<unknown> = [{ id: "a", review: { nope: true } }];
    entities = applyReview(entities, "a", verdict);
    expect(
      /* SAFETY: 类型断言已复核 */ (entities[0] as Record<string, unknown>).reviewHistory,
    ).toBeUndefined();

    let chain: Array<unknown> = [{ id: "a" }];
    for (let i = 0; i < 12; i++) {
      chain = applyReview(chain, "a", { ...verdict, scoredAt: `t${i}` });
    }
    const history = /* SAFETY: 类型断言已复核 */ /* SAFETY: 类型断言已复核 */ (
      chain[0] as Record<string, unknown>
    ).reviewHistory as Array<ReviewVerdict>;
    expect(history).toHaveLength(9); // REVIEW_HISTORY_LIMIT
    expect(history[0]?.scoredAt).toBe("t2"); // 最早的 2 轮被裁掉
    expect(/* SAFETY: 类型断言已复核 */ (chain[0] as Record<string, unknown>).review).toMatchObject(
      {
        scoredAt: "t11",
      },
    );
  });
});

describe("applyImageReview / getRecordImageReview（P8-2 视觉评审写回）", () => {
  const verdict: ReviewVerdict = {
    issues: ["手畸"],
    pass: false,
    scoredAt: "t",
    scores: { artifacts: { note: "畸形", score: 2 } },
    suggestion: "修手",
  };

  it("写回 shot.imageReview，不污染 shot.review（两者独立）", () => {
    const out = /* SAFETY: 类型断言已复核 */ applyImageReview(
      [
        {
          id: "a",
          review: { issues: [], pass: true, scoredAt: "x", suggestion: "" },
        },
      ],
      "a",
      verdict,
    ) as Array<Record<string, unknown>>;
    expect(out[0]?.imageReview).toEqual(verdict);
    expect(out[0]?.review).toEqual({
      issues: [],
      pass: true,
      scoredAt: "x",
      suggestion: "",
    });
  });

  it("读回：imageReview 经 normalizeReviewVerdict 宽容解析；无则 null", () => {
    expect(getRecordImageReview({ imageReview: verdict })).toEqual(verdict);
    expect(getRecordImageReview({})).toBeNull();
    expect(getRecordImageReview({ imageReview: { pass: "错" } })).toBeNull();
  });

  it("id 不命中 → 原样返回入参引用", () => {
    const entities = [{ id: "a" }];
    expect(applyImageReview(entities, "missing", verdict)).toBe(entities);
  });
});

describe("reviewScoreMean", () => {
  it("维度均分；未评分 / 空评分 → null（调用方走「不过」旧路）", () => {
    expect(
      reviewScoreMean({
        issues: [],
        pass: true,
        scoredAt: "t",
        scores: { a: { note: "", score: 2 }, b: { note: "", score: 5 } },
        suggestion: "",
      }),
    ).toBe(3.5);
    expect(
      reviewScoreMean({
        issues: [],
        pass: true,
        scoredAt: "t",
        suggestion: "",
      }),
    ).toBeNull();
  });
});

describe("剧本评审位 · 改写留档与低分维度（#2478）", () => {
  const verdict: ReviewVerdict = {
    issues: ["高潮缺失"],
    pass: false,
    scoredAt: "t1",
    scores: {
      concreteness: { note: "尚可", score: 4 },
      structure: { note: "无高潮", score: 2 },
    },
    suggestion: "补对峙",
  };

  it("recordScriptRevision：改写前旧版进 revisions（尾部追加、超限从头裁剪）", () => {
    let state = normalizeScriptReviewState(null);
    state = recordScriptRevision(state, "v0", "t0");
    state = applyScriptReview(state, verdict);
    state = recordScriptRevision(state, "v1", "t1");
    expect(state.revisions.map((r) => r.markdown)).toEqual(["v0", "v1"]);
    expect(state.revisions[1]).toMatchObject({ at: "t1" });
    // 评审位不受留档影响：判定与历史原样保留
    expect(state.review?.scoredAt).toBe("t1");
  });

  it("recordScriptRevision 超 SCRIPT_REVISION_LIMIT(3) 从头裁剪；畸形条目丢弃", () => {
    let state = normalizeScriptReviewState(null);
    for (let i = 0; i < 5; i++) {
      state = recordScriptRevision(state, `v${i}`, `t${i}`);
    }
    expect(state.revisions.map((r) => r.markdown)).toEqual(["v2", "v3", "v4"]);
    // 畸形留档（缺 markdown / 空串）在读取时被丢弃
    const dirty = normalizeScriptReviewState({
      revisions: [{ at: "t" }, { markdown: "" }, { at: "t2", markdown: "ok" }],
    });
    expect(dirty.revisions).toEqual([{ at: "t2", markdown: "ok" }]);
  });

  it("weakScoreEntries：低分维度升序（最差先改）；未评分 → 空数组", () => {
    expect(weakScoreEntries(verdict)).toEqual([{ key: "structure", note: "无高潮", score: 2 }]);
    expect(
      weakScoreEntries({
        issues: [],
        pass: false,
        scoredAt: "t",
        scores: {
          a: { note: "aa", score: 2 },
          b: { note: "bb", score: 3 },
          c: { note: "", score: 4 },
        },
        suggestion: "",
      }),
    ).toEqual([
      { key: "a", note: "aa", score: 2 },
      { key: "b", note: "bb", score: 3 },
    ]);
    expect(
      weakScoreEntries({
        issues: [],
        pass: true,
        scoredAt: "t",
        suggestion: "",
      }),
    ).toEqual([]);
  });
});

// ───────────────── 人工裁决与人工评分（FR-QA-07 人工侧 · #2480） ─────────────────

describe("人工裁决 / 人评分（#2480）", () => {
  const verdict: HumanVerdict = {
    at: "t1",
    note: "构图崩了",
    pass: false,
    rev: 3,
  };

  it("normalizeHumanVerdict：缺 pass 布尔 → null；note 裁边 / rev / digest 宽容收", () => {
    expect(normalizeHumanVerdict(null)).toBeNull();
    expect(normalizeHumanVerdict({ note: "x" })).toBeNull();
    expect(normalizeHumanVerdict({ note: "  可以  ", pass: true })).toEqual({
      at: "",
      note: "可以",
      pass: true,
    });
    expect(normalizeHumanVerdict({ digest: " d ", pass: false, rev: 2.7 })).toEqual({
      at: "",
      digest: "d",
      note: "",
      pass: false,
      rev: 2.7,
    });
  });

  it("applyHumanVerdict：写 humanVerdict 不碰 AI 判定；无命中原样返回入参引用", () => {
    const entities = [
      {
        id: "a",
        imageReview: { issues: [], pass: true, scoredAt: "y", suggestion: "" },
        review: { issues: [], pass: true, scoredAt: "x", suggestion: "" },
      },
    ];
    const out = /* SAFETY: 类型断言已复核 */ applyHumanVerdict(entities, "a", verdict) as Array<
      Record<string, unknown>
    >;
    expect(out[0]?.humanVerdict).toEqual(verdict);
    // AI 的两套判定原样保留
    expect(out[0]?.review).toMatchObject({ pass: true });
    expect(out[0]?.imageReview).toMatchObject({ pass: true });
    expect(applyHumanVerdict(entities, "missing", verdict)).toBe(entities);
  });

  it("getRecordHumanVerdict：宽容读；没裁决过 → null", () => {
    expect(getRecordHumanVerdict({ humanVerdict: verdict })).toEqual(verdict);
    expect(getRecordHumanVerdict({})).toBeNull();
    expect(getRecordHumanVerdict({ humanVerdict: { note: "缺 pass" } })).toBeNull();
  });

  it("normalizeHumanRating：夹取 0~5 取整；非有限数 → null", () => {
    expect(normalizeHumanRating(3)).toBe(3);
    expect(normalizeHumanRating(7)).toBe(5);
    expect(normalizeHumanRating(-1)).toBe(0);
    expect(normalizeHumanRating(4.6)).toBe(5);
    expect(normalizeHumanRating("4")).toBeNull();
    expect(normalizeHumanRating(Number.NaN)).toBeNull();
  });

  it("applyHumanRating：写 / 清（null）；无命中原样返回入参引用", () => {
    const entities = [{ id: "a" }];
    expect(
      /* SAFETY: 类型断言已复核 */ (
        applyHumanRating(entities, "a", 4) as Array<Record<string, unknown>>
      )[0]?.humanRating,
    ).toBe(4);
    expect(
      /* SAFETY: 类型断言已复核 */ (
        applyHumanRating(entities, "a", null) as Array<Record<string, unknown>>
      )[0]?.humanRating,
    ).toBeNull();
    expect(applyHumanRating(entities, "missing", 4)).toBe(entities);
  });

  it("剧本裁决：applyScriptHumanVerdict 只动 humanVerdict，AI 判定 / 曲线 / 留档保留", () => {
    let state = normalizeScriptReviewState(null);
    state = applyScriptReview(state, {
      issues: ["高潮缺失"],
      pass: false,
      scoredAt: "t1",
      suggestion: "",
    });
    state = recordScriptRevision(state, "v0", "t0");
    state = applyScriptHumanVerdict(state, {
      at: "t2",
      digest: "d1",
      note: "人拍板过",
      pass: true,
    });
    expect(state.humanVerdict).toMatchObject({ digest: "d1", pass: true });
    expect(state.review?.pass).toBe(false);
    expect(state.revisions.map((r) => r.markdown)).toEqual(["v0"]);
    // normalize 往返：脏 JSON 里的人工裁决也能宽容读回
    expect(normalizeScriptReviewState({ humanVerdict: verdict }).humanVerdict).toEqual(verdict);
    expect(normalizeScriptReviewState({}).humanVerdict).toBeNull();
  });
});
