// run-types 纯逻辑单测（Phase 6 地基）：run 归一 + 规划视图 + 「下一步做什么」规划器。
import { describe, expect, it } from "vitest";

import {
  appendRunStep,
  DEFAULT_PRODUCTION_RUN,
  markActionProcessed,
  normalizeProductionRun,
  planNextRunAction,
  RUN_LOG_LIMIT,
  toRunView,
  type ProductionRun,
  type ProductionRunView,
} from "./run-types";

function run(over: Partial<ProductionRun> = {}): ProductionRun {
  return { ...DEFAULT_PRODUCTION_RUN, ...over };
}
function view(over: Partial<ProductionRunView> = {}): ProductionRunView {
  return {
    hasScript: false,
    characterCount: 0,
    shots: [],
    filmRendered: false,
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
      status: "running",
      approvalMode: "shot",
      stage: "shots",
      goal: "g",
      awaitingStage: "video",
      processedShotRev: { a: 2 },
      error: "e",
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
      status: "乱",
      approvalMode: "乱",
      stage: "乱",
    });
    expect(r.status).toBe("idle");
    expect(r.approvalMode).toBe("stage");
    expect(r.stage).toBe("script");
  });

  it("processedShotRev 只收有限数字；非对象整体丢弃", () => {
    expect(
      normalizeProductionRun({ processedShotRev: { a: 1, b: "x", c: NaN } })
        .processedShotRev,
    ).toEqual({ a: 1 });
    expect(
      normalizeProductionRun({ processedShotRev: "no" }).processedShotRev,
    ).toEqual({});
  });

  it("字符串字段类型不符 → 回落空/默认，不抛", () => {
    const r = normalizeProductionRun({
      goal: 1,
      error: 2,
      updatedAt: {},
      awaitingStage: 5,
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
      hasScript: false,
      characterCount: 0,
      shots: [],
      filmRendered: false,
    });
  });

  it("从 production 归一镜头视图 + 角色数 + 剧本 + rendered", () => {
    const v = toRunView({
      scriptMarkdown: "有内容",
      characters: [{}, {}, {}],
      shots: [
        { id: "a", rev: 3, imageUrl: "/x.png" },
        { id: "b", clipUrl: "/y.mp4" },
      ],
      progress: { stage: "render", rendered: true },
    });
    expect(v.hasScript).toBe(true);
    expect(v.characterCount).toBe(3);
    expect(v.filmRendered).toBe(true);
    expect(v.shots).toEqual([
      { id: "a", rev: 3, hasImage: true, hasClip: false },
      { id: "b", rev: 0, hasImage: false, hasClip: true },
    ]);
  });

  it("无 id 的镜头项跳过；rev 非数字归 0；whitespace 剧本算无", () => {
    const v = toRunView({
      scriptMarkdown: "   ",
      characters: "not-array",
      shots: [{ noId: 1 }, { id: "a", rev: "x" }],
    });
    expect(v.hasScript).toBe(false);
    expect(v.characterCount).toBe(0);
    expect(v.shots).toEqual([
      { id: "a", rev: 0, hasImage: false, hasClip: false },
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
      planNextRunAction(
        view(),
        run({ status: "awaiting_approval", awaitingStage: "shots" }),
      ),
    ).toEqual({ kind: "await_approval", stage: "shots" });
    expect(
      planNextRunAction(
        view(),
        run({
          status: "awaiting_approval",
          stage: "video",
          awaitingStage: null,
        }),
      ),
    ).toEqual({ kind: "await_approval", stage: "video" });
  });

  it("running：沿流水线找第一个未完成步骤", () => {
    expect(planNextRunAction(view(), run({ status: "running" }))).toEqual({
      kind: "generate_script",
    });
    expect(
      planNextRunAction(view({ hasScript: true }), run({ status: "running" })),
    ).toEqual({ kind: "extract_characters" });
    expect(
      planNextRunAction(
        view({ hasScript: true, characterCount: 2 }),
        run({ status: "running" }),
      ),
    ).toEqual({ kind: "plan_storyboard" });
  });

  it("有镜头：缺图 / 被改（rev 高于快照）的镜头纳入待生图", () => {
    const shots = [
      { id: "a", rev: 1, hasImage: true, hasClip: false },
      { id: "b", rev: 2, hasImage: false, hasClip: false },
    ];
    // a 已按 rev1 处理、b 无图 → 只需处理 b。
    expect(
      planNextRunAction(
        view({ hasScript: true, characterCount: 1, shots }),
        run({ status: "running", processedShotRev: { a: 1 } }),
      ),
    ).toEqual({ kind: "render_images", shotIds: ["b"] });
    // 用户在 a 处理后又改过（rev 变 3）→ a 重新纳入。
    expect(
      planNextRunAction(
        view({
          hasScript: true,
          characterCount: 1,
          shots: [{ ...shots[0]!, rev: 3 }, shots[1]!],
        }),
        run({ status: "running", processedShotRev: { a: 1 } }),
      ),
    ).toEqual({ kind: "render_images", shotIds: ["a", "b"] });
  });

  it("图齐未出片 → render_film；已出片 → done", () => {
    const shots = [{ id: "a", rev: 1, hasImage: true, hasClip: true }];
    const base = { hasScript: true, characterCount: 1, shots };
    expect(
      planNextRunAction(
        view(base),
        run({ status: "running", processedShotRev: { a: 1 } }),
      ),
    ).toEqual({ kind: "render_film" });
    expect(
      planNextRunAction(
        view({ ...base, filmRendered: true }),
        run({ status: "running", processedShotRev: { a: 1 } }),
      ),
    ).toEqual({ kind: "done" });
  });
});

describe("markActionProcessed", () => {
  it("render_images：把被处理镜头的当前 rev 记进快照", () => {
    const v = view({
      shots: [
        { id: "a", rev: 4, hasImage: false, hasClip: false },
        { id: "b", rev: 2, hasImage: false, hasClip: false },
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
    ts: `t${i}`,
    kind: "generate_script",
    ok: true,
    detail: `#${i}`,
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
    for (let i = 0; i < RUN_LOG_LIMIT + 5; i++) r = appendRunStep(r, step(i));
    expect(r.log).toHaveLength(RUN_LOG_LIMIT);
    expect(r.log[0]!.detail).toBe(`#5`); // 早期 5 条被裁掉
    expect(r.log.at(-1)!.detail).toBe(`#${RUN_LOG_LIMIT + 4}`);
  });
});

describe("normalizeProductionRun · log", () => {
  it("解析合法 step 条目；无 ts / 非对象项丢弃；ok 缺省视为 true", () => {
    const r = normalizeProductionRun({
      log: [
        { ts: "a", kind: "generate_script", ok: true, detail: "x" },
        { kind: "no_ts" },
        "junk",
        { ts: "b", detail: "y" },
      ],
    });
    expect(r.log).toEqual([
      { ts: "a", kind: "generate_script", ok: true, detail: "x" },
      { ts: "b", kind: "info", ok: true, detail: "y" },
    ]);
  });
  it("log 缺省 / 非数组 → 空数组", () => {
    expect(normalizeProductionRun({ log: "x" }).log).toEqual([]);
    expect(normalizeProductionRun({}).log).toEqual([]);
  });
});

describe("planNextRunAction · 自动评审", () => {
  const shots = [{ id: "a", rev: 1, hasImage: true, hasClip: false }];
  const base = { hasScript: true, characterCount: 1, shots };

  it("autoReview 关：图齐直接 render_film（不评审）", () => {
    expect(
      planNextRunAction(
        view(base),
        run({ status: "running", processedShotRev: { a: 1 } }),
      ),
    ).toEqual({ kind: "render_film" });
  });

  it("autoReview 开 + 未评审（reviewedShotRev 落后）→ review_shots", () => {
    expect(
      planNextRunAction(
        view(base),
        run({
          status: "running",
          autoReview: true,
          processedShotRev: { a: 1 },
        }),
      ),
    ).toEqual({ kind: "review_shots", shotIds: ["a"] });
  });

  it("待生图优先于评审：有镜缺图/被改时先 render_images", () => {
    expect(
      planNextRunAction(
        view({ hasScript: true, characterCount: 1, shots }),
        run({
          status: "running",
          autoReview: true,
          processedShotRev: { a: 0 }, // rev1 > 0 → 该镜需重出图
        }),
      ),
    ).toEqual({ kind: "render_images", shotIds: ["a"] });
  });

  it("评审已定稿（reviewedShotRev == rev）→ 放行 render_film", () => {
    expect(
      planNextRunAction(
        view(base),
        run({
          status: "running",
          autoReview: true,
          processedShotRev: { a: 1 },
          reviewedShotRev: { a: 1 },
        }),
      ),
    ).toEqual({ kind: "render_film" });
  });

  it("评审后又改过（rev 变新，定稿快照落后）→ 再评审", () => {
    expect(
      planNextRunAction(
        view({
          hasScript: true,
          characterCount: 1,
          shots: [{ id: "a", rev: 2, hasImage: true, hasClip: false }],
        }),
        run({
          status: "running",
          autoReview: true,
          processedShotRev: { a: 2 },
          reviewedShotRev: { a: 1 },
        }),
      ),
    ).toEqual({ kind: "review_shots", shotIds: ["a"] });
  });
});

describe("normalizeProductionRun · 自动评审字段", () => {
  it("autoReview 只认 true；rev 映射只收有限数字", () => {
    const r = normalizeProductionRun({
      autoReview: true,
      reviewedShotRev: { a: 2, b: "x", c: NaN },
      reviewAttempts: { a: 1 },
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
});
