// run-types 纯逻辑单测（Phase 6 地基）：run 归一 + 规划视图 + 「下一步做什么」规划器。
import { describe, expect, it } from "vitest";

import {
  appendRunStep,
  DEFAULT_PRODUCTION_RUN,
  markActionProcessed,
  normalizeProductionRun,
  planNextRunAction,
  REVIEW_MAX_RETRY,
  RUN_LOG_LIMIT,
  scriptDigestOf,
  toRunView,
  type ProductionRun,
  type ProductionRunView,
} from "./run-types";

function run(over: Partial<ProductionRun> = {}): ProductionRun {
  return { ...DEFAULT_PRODUCTION_RUN, ...over };
}
function view(over: Partial<ProductionRunView> = {}): ProductionRunView {
  return {
    characterCount: 0,
    filmRendered: false,
    hasScript: false,
    scriptDigest: "",
    shots: [],
    ...over,
  };
}

describe("normalizeProductionRun", () => {
  it("非对象 → 默认", () => {
    expect(normalizeProductionRun(null)).toEqual(DEFAULT_PRODUCTION_RUN);
    expect(normalizeProductionRun("x")).toEqual(DEFAULT_PRODUCTION_RUN);
  });

  it("合法值原样读出", () => {
    const r = normalizeProductionRun({
      approvalMode: "shot",
      awaitingStage: "video",
      error: "e",
      goal: "g",
      processedShotRev: { a: 2 },
      stage: "shots",
      status: "running",
      updatedAt: "t",
    });
    expect(r.status).toBe("running");
    expect(r.approvalMode).toBe("shot");
    expect(r.stage).toBe("shots");
    expect(r.awaitingStage).toBe("video");
    expect(r.processedShotRev).toEqual({ a: 2 });
    expect(r.error).toBe("e");
  });

  it("非法 status / approvalMode / stage → 回落默认档", () => {
    const r = normalizeProductionRun({
      approvalMode: "乱",
      stage: "乱",
      status: "乱",
    });
    expect(r.status).toBe("idle");
    expect(r.approvalMode).toBe("stage");
    expect(r.stage).toBe("script");
  });

  it("processedShotRev 只收有限数字；非对象整体丢弃", () => {
    expect(
      normalizeProductionRun({ processedShotRev: { a: 1, b: "x", c: NaN } }).processedShotRev,
    ).toEqual({ a: 1 });
    expect(normalizeProductionRun({ processedShotRev: "no" }).processedShotRev).toEqual({});
  });

  it("字符串字段类型不符 → 回落空/默认，不抛", () => {
    const r = normalizeProductionRun({
      awaitingStage: 5,
      error: 2,
      goal: 1,
      updatedAt: {},
    });
    expect(r.goal).toBe("");
    expect(r.error).toBeNull();
    expect(r.updatedAt).toBe("");
    expect(r.awaitingStage).toBeNull();
  });
});

describe("toRunView", () => {
  it("null → 全空视图（连剧本都还没有）", () => {
    expect(toRunView(null)).toEqual({
      characterCount: 0,
      filmRendered: false,
      hasScript: false,
      scriptDigest: scriptDigestOf(""),
      scriptHumanVerdict: null,
      shots: [],
    });
  });

  it("从 production 归一镜头视图 + 角色数 + 剧本 + rendered", () => {
    const v = toRunView({
      characters: [{}, {}, {}],
      progress: { rendered: true, stage: "render" },
      scriptMarkdown: "有内容",
      shots: [
        { id: "a", imageUrl: "/x.png", rev: 3 },
        { clipUrl: "/y.mp4", id: "b" },
      ],
    });
    expect(v.hasScript).toBe(true);
    expect(v.characterCount).toBe(3);
    expect(v.filmRendered).toBe(true);
    expect(v.shots).toEqual([
      {
        hasClip: false,
        hasImage: true,
        humanRating: null,
        humanVerdict: null,
        id: "a",
        rev: 3,
      },
      {
        hasClip: true,
        hasImage: false,
        humanRating: null,
        humanVerdict: null,
        id: "b",
        rev: 0,
      },
    ]);
  });

  it("无 id 的镜头项跳过；rev 非数字归 0；whitespace 剧本算无", () => {
    const v = toRunView({
      characters: "not-array",
      scriptMarkdown: "   ",
      shots: [{ noId: 1 }, { id: "a", rev: "x" }],
    });
    expect(v.hasScript).toBe(false);
    expect(v.characterCount).toBe(0);
    expect(v.shots).toEqual([
      {
        hasClip: false,
        hasImage: false,
        humanRating: null,
        humanVerdict: null,
        id: "a",
        rev: 0,
      },
    ]);
  });
});

describe("planNextRunAction", () => {
  it("非 running 态由 status 决定", () => {
    expect(planNextRunAction(view(), run({ status: "idle" }))).toEqual({
      kind: "idle",
    });
    expect(planNextRunAction(view(), run({ status: "paused" }))).toEqual({
      kind: "idle",
    });
    expect(planNextRunAction(view(), run({ status: "cancelled" }))).toEqual({
      kind: "idle",
    });
    expect(planNextRunAction(view(), run({ status: "done" }))).toEqual({
      kind: "done",
    });
  });

  it("awaiting_approval 透出待确认阶段（缺省回落到游标阶段）", () => {
    expect(
      planNextRunAction(view(), run({ awaitingStage: "shots", status: "awaiting_approval" })),
    ).toEqual({ kind: "await_approval", stage: "shots" });
    expect(
      planNextRunAction(
        view(),
        run({
          awaitingStage: null,
          stage: "video",
          status: "awaiting_approval",
        }),
      ),
    ).toEqual({ kind: "await_approval", stage: "video" });
  });

  it("running：沿流水线找第一个未完成步骤", () => {
    expect(planNextRunAction(view(), run({ status: "running" }))).toEqual({
      kind: "generate_script",
    });
    expect(planNextRunAction(view({ hasScript: true }), run({ status: "running" }))).toEqual({
      kind: "extract_characters",
    });
    expect(
      planNextRunAction(view({ characterCount: 2, hasScript: true }), run({ status: "running" })),
    ).toEqual({ kind: "plan_storyboard" });
  });

  it("有镜头：缺图 / 被改（rev 高于快照）的镜头纳入待生图", () => {
    const shots = [
      { hasClip: false, hasImage: true, id: "a", rev: 1 },
      { hasClip: false, hasImage: false, id: "b", rev: 2 },
    ];
    // a 已按 rev1 处理、b 无图 → 只需处理 b。
    expect(
      planNextRunAction(
        view({ characterCount: 1, hasScript: true, shots }),
        run({ processedShotRev: { a: 1 }, status: "running" }),
      ),
    ).toEqual({ kind: "render_images", shotIds: ["b"] });
    // 用户在 a 处理后又改过（rev 变 3）→ a 重新纳入。
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          shots: [{ ...shots[0]!, rev: 3 }, shots[1]!],
        }),
        run({ processedShotRev: { a: 1 }, status: "running" }),
      ),
    ).toEqual({ kind: "render_images", shotIds: ["a", "b"] });
  });

  it("图齐未出片 → render_film；已出片 → done", () => {
    const shots = [{ hasClip: true, hasImage: true, id: "a", rev: 1 }];
    const base = { characterCount: 1, hasScript: true, shots };
    expect(
      planNextRunAction(view(base), run({ processedShotRev: { a: 1 }, status: "running" })),
    ).toEqual({ kind: "render_film" });
    expect(
      planNextRunAction(
        view({ ...base, filmRendered: true }),
        run({ processedShotRev: { a: 1 }, status: "running" }),
      ),
    ).toEqual({ kind: "done" });
  });
});

describe("markActionProcessed", () => {
  it("render_images：把被处理镜头的当前 rev 记进快照", () => {
    const v = view({
      shots: [
        { hasClip: false, hasImage: false, id: "a", rev: 4 },
        { hasClip: false, hasImage: false, id: "b", rev: 2 },
      ],
    });
    const r = markActionProcessed(run({ status: "running" }), v, {
      kind: "render_images",
      shotIds: ["a"],
    });
    expect(r.processedShotRev).toEqual({ a: 4 });
    // 原 run 不被就地改（不可变）
    expect(DEFAULT_PRODUCTION_RUN.processedShotRev).toEqual({});
  });

  it("非 render_images 动作 → 返回等价拷贝", () => {
    const r = markActionProcessed(run({ status: "running" }), view(), {
      kind: "done",
    });
    expect(r.processedShotRev).toEqual({});
  });
});

describe("appendRunStep", () => {
  const step = (i: number) => ({
    detail: `#${i}`,
    kind: "generate_script",
    ok: true,
    ts: `t${i}`,
  });
  it("尾部追加、不可变（不改原 run.log）", () => {
    const base = run();
    const next = appendRunStep(base, step(1));
    expect(base.log).toEqual([]);
    expect(next.log).toHaveLength(1);
    const two = appendRunStep(next, step(2));
    expect(two.log.map((s) => s.detail)).toEqual(["#1", "#2"]);
  });
  it("超上限从头裁剪，只保留最近 RUN_LOG_LIMIT 条", () => {
    let r = run();
    for (let i = 0; i < RUN_LOG_LIMIT + 5; i++) {
      r = appendRunStep(r, step(i));
    }
    expect(r.log).toHaveLength(RUN_LOG_LIMIT);
    expect(r.log[0]!.detail).toBe(`#5`); // 早期 5 条被裁掉
    expect(r.log.at(-1)!.detail).toBe(`#${RUN_LOG_LIMIT + 4}`);
  });
});

describe("normalizeProductionRun · log", () => {
  it("解析合法 step 条目；无 ts / 非对象项丢弃；ok 缺省视为 true", () => {
    const r = normalizeProductionRun({
      log: [
        { detail: "x", kind: "generate_script", ok: true, ts: "a" },
        { kind: "no_ts" },
        "junk",
        { detail: "y", ts: "b" },
      ],
    });
    expect(r.log).toEqual([
      { detail: "x", kind: "generate_script", ok: true, ts: "a" },
      { detail: "y", kind: "info", ok: true, ts: "b" },
    ]);
  });
  it("log 缺省 / 非数组 → 空数组", () => {
    expect(normalizeProductionRun({ log: "x" }).log).toEqual([]);
    expect(normalizeProductionRun({}).log).toEqual([]);
  });
});

describe("planNextRunAction · 自动评审", () => {
  const shots = [{ hasClip: false, hasImage: true, id: "a", rev: 1 }];
  const base = { characterCount: 1, hasScript: true, shots };

  it("autoReview 关：图齐直接 render_film（不评审）", () => {
    expect(
      planNextRunAction(view(base), run({ processedShotRev: { a: 1 }, status: "running" })),
    ).toEqual({ kind: "render_film" });
  });

  it("autoReview 开 + 未评审（reviewedShotRev 落后）→ review_shots", () => {
    expect(
      planNextRunAction(
        view(base),
        run({
          autoReview: true,
          processedShotRev: { a: 1 },
          status: "running",
        }),
      ),
    ).toEqual({ kind: "review_shots", shotIds: ["a"] });
  });

  it("待生图优先于评审：有镜缺图/被改时先 render_images", () => {
    expect(
      planNextRunAction(
        view({ characterCount: 1, hasScript: true, shots }),
        run({
          autoReview: true,
          processedShotRev: { a: 0 }, // rev1 > 0 → 该镜需重出图
          status: "running",
        }),
      ),
    ).toEqual({ kind: "render_images", shotIds: ["a"] });
  });

  it("评审已定稿（reviewedShotRev == rev）→ 放行 render_film", () => {
    expect(
      planNextRunAction(
        view(base),
        run({
          autoReview: true,
          processedShotRev: { a: 1 },
          reviewedShotRev: { a: 1 },
          status: "running",
        }),
      ),
    ).toEqual({ kind: "render_film" });
  });

  it("评审后又改过（rev 变新，定稿快照落后）→ 再评审", () => {
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          shots: [{ hasClip: false, hasImage: true, id: "a", rev: 2 }],
        }),
        run({
          autoReview: true,
          processedShotRev: { a: 2 },
          reviewedShotRev: { a: 1 },
          status: "running",
        }),
      ),
    ).toEqual({ kind: "review_shots", shotIds: ["a"] });
  });

  // ── 人工裁决优先（FR-QA-07 人工侧 · #2480） ──
  it("人工通过且快照新鲜 → 定稿（不纳入评审，AI 不再评）", () => {
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          shots: [
            {
              hasClip: false,
              hasImage: true,
              humanVerdict: { at: "t", note: "", pass: true, rev: 1 },
              id: "a",
              rev: 1,
            },
          ],
        }),
        run({
          autoReview: true,
          processedShotRev: { a: 1 },
          status: "running",
        }),
      ),
    ).toEqual({ kind: "render_film" });
  });

  it("人工否决且快照新鲜 → 即使 AI 已定稿也拉回评审（重出）", () => {
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          shots: [
            {
              hasClip: false,
              hasImage: true,
              humanVerdict: { at: "t", note: "崩了", pass: false, rev: 1 },
              id: "a",
              rev: 1,
            },
          ],
        }),
        run({
          autoReview: true,
          processedShotRev: { a: 1 },
          reviewedShotRev: { a: 1 }, // AI 已定稿
          status: "running",
        }),
      ),
    ).toEqual({ kind: "review_shots", shotIds: ["a"] });
  });

  it("人工否决但已达重试上限 → 不再拉回（保留，转人工改/通过）", () => {
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          shots: [
            {
              hasClip: false,
              hasImage: true,
              humanVerdict: { at: "t", note: "还是崩", pass: false, rev: 1 },
              id: "a",
              rev: 1,
            },
          ],
        }),
        run({
          autoReview: true,
          processedShotRev: { a: 1 },
          reviewAttempts: { a: REVIEW_MAX_RETRY },
          reviewedShotRev: { a: 1 },
          status: "running",
        }),
      ),
    ).toEqual({ kind: "render_film" });
  });

  it("人工否决但镜头此后被改过（rev 变）→ 裁决作废，走 AI 评审循环", () => {
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          shots: [
            {
              hasClip: false,
              hasImage: true,
              humanVerdict: { at: "t", note: "崩了", pass: false, rev: 1 },
              id: "a",
              rev: 2,
            },
          ],
        }),
        run({
          autoReview: true,
          processedShotRev: { a: 2 },
          status: "running",
        }),
      ),
    ).toEqual({ kind: "review_shots", shotIds: ["a"] });
  });

  it("人工通过且剧本没变（digest 相等）→ 豁免剧本评审；剧本变过 → 不豁免", () => {
    const viewFactory = (verdictDigest: string, scriptDigest: string) =>
      view({
        characterCount: 1,
        hasScript: true,
        scriptDigest,
        scriptHumanVerdict: {
          at: "t",
          digest: verdictDigest,
          note: "",
          pass: true,
        },
        shots,
      });
    // 人拍板过且剧本此后没变 → 视为已收口（脚本指纹 = 收口快照 = 裁决快照）：
    // 评审被跳过，规划器落到下一动作（补分镜）而不是 review_script
    expect(
      planNextRunAction(
        viewFactory("d1", "d1"),
        run({ autoReview: true, scriptReviewDigest: "d1", status: "running" }),
      ),
    ).toEqual({ kind: "plan_storyboard" });
    // 剧本改过：裁决的 digest 落后（d1 ≠ 当前 d2）→ 重新评审
    expect(
      planNextRunAction(
        viewFactory("d1", "d2"),
        run({ autoReview: true, scriptReviewDigest: "d1", status: "running" }),
      ),
    ).toEqual({ kind: "review_script" });
  });
});

describe("normalizeProductionRun · 自动评审字段", () => {
  it("autoReview 只认 true；rev 映射只收有限数字", () => {
    const r = normalizeProductionRun({
      autoReview: true,
      reviewAttempts: { a: 1 },
      reviewedShotRev: { a: 2, b: "x", c: NaN },
    });
    expect(r.autoReview).toBe(true);
    expect(r.reviewedShotRev).toEqual({ a: 2 });
    expect(r.reviewAttempts).toEqual({ a: 1 });
  });

  it("缺省 → autoReview false、两映射空", () => {
    const r = normalizeProductionRun({});
    expect(r.autoReview).toBe(false);
    expect(r.reviewedShotRev).toEqual({});
    expect(r.reviewAttempts).toEqual({});
  });

  it("剧本闭环字段（#2478）：类型不符回落默认；轮数只收非负有限数", () => {
    const r = normalizeProductionRun({
      scriptReviewAttempts: -1,
      scriptReviewDigest: 5,
      scriptRevisionPending: "yes",
      storyboardScriptDigest: null,
    });
    expect(r).toMatchObject({
      scriptReviewAttempts: 0,
      scriptReviewDigest: "",
      scriptRevisionPending: false,
      storyboardScriptDigest: "",
    });
    expect(
      normalizeProductionRun({
        scriptReviewAttempts: 2.9,
        scriptReviewDigest: "abc",
        scriptRevisionPending: true,
        storyboardScriptDigest: "def",
      }),
    ).toMatchObject({
      scriptReviewAttempts: 2,
      scriptReviewDigest: "abc",
      scriptRevisionPending: true,
      storyboardScriptDigest: "def",
    });
  });
});

describe("scriptDigestOf", () => {
  it("同一内容指纹一致；内容一变指纹就变", () => {
    expect(scriptDigestOf("# 剧本")).toBe(scriptDigestOf("# 剧本"));
    expect(scriptDigestOf("# 剧本")).not.toBe(scriptDigestOf("# 剧本 v2"));
    // 空串也有确定指纹（评审收口快照的「没评过」形态不是空指纹）
    expect(scriptDigestOf("")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("planNextRunAction · 剧本评审闭环（FR-QA-07 ④ · #2478）", () => {
  const digest = scriptDigestOf("# 剧本");

  it("autoReview 开 + 剧本指纹 ≠ 评审收口快照（含没评过）→ review_script", () => {
    expect(
      planNextRunAction(
        view({ hasScript: true, scriptDigest: digest }),
        run({ autoReview: true, status: "running" }),
      ),
    ).toEqual({ kind: "review_script" });
    expect(
      planNextRunAction(
        view({
          hasScript: true,
          scriptDigest: scriptDigestOf("# 人改过的新版本"),
        }),
        run({
          autoReview: true,
          scriptReviewDigest: digest, // AI/人改过剧本 → 快照落后
          status: "running",
        }),
      ),
    ).toEqual({ kind: "review_script" });
  });

  it("评审收口（指纹相等）→ 放行后续阶段；autoReview 关 → 不评审", () => {
    expect(
      planNextRunAction(
        view({ hasScript: true, scriptDigest: digest }),
        run({
          autoReview: true,
          scriptReviewDigest: digest,
          status: "running",
        }),
      ),
    ).toEqual({ kind: "extract_characters" });
    expect(
      planNextRunAction(
        view({ hasScript: true, scriptDigest: digest }),
        run({ status: "running" }),
      ),
    ).toEqual({ kind: "extract_characters" });
  });

  it("评审提出改写（pending）→ 先 revise_script（优先于 review_script）", () => {
    expect(
      planNextRunAction(
        view({ hasScript: true, scriptDigest: digest }),
        run({
          autoReview: true,
          scriptRevisionPending: true,
          status: "running",
        }),
      ),
    ).toEqual({ kind: "revise_script" });
  });

  it("分镜联动：分镜后剧本变过（storyboard 快照落后）→ 重排 plan_storyboard", () => {
    const shots = [{ hasClip: false, hasImage: true, id: "a", rev: 1 }];
    const newDigest = scriptDigestOf("# 改写定稿后的剧本");
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          scriptDigest: newDigest,
          shots,
        }),
        run({
          autoReview: true,
          processedShotRev: { a: 1 },
          reviewedShotRev: { a: 1 },
          scriptReviewDigest: newDigest, // 剧本质量节点已收口
          status: "running",
          storyboardScriptDigest: digest, // 分镜还停在旧版剧本上
        }),
      ),
    ).toEqual({ kind: "plan_storyboard" });
    // 快照一致 → 正常走到出片，不重排
    expect(
      planNextRunAction(
        view({
          characterCount: 1,
          hasScript: true,
          scriptDigest: digest,
          shots,
        }),
        run({
          autoReview: true,
          processedShotRev: { a: 1 },
          reviewedShotRev: { a: 1 },
          scriptReviewDigest: digest,
          status: "running",
          storyboardScriptDigest: digest,
        }),
      ),
    ).toEqual({ kind: "render_film" });
  });
});
