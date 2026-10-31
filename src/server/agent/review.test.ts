/**
 * 服务端评审执行器单测（Phase 8 · P8-1a）：真实 productionRepository（内存 test-db）+
 * mock 掉 LLM（getLLMConfig / completeLLMStructured）。prompts 纯函数保持真实，锁住「提炼文本 →
 * 判定 → 写回 → 重生成」的落库语义与字段所有权（只写内容列，不碰 run）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeLLM, completeLLMStructured, getLLMConfig, getVisionLLMConfig } = vi.hoisted(() => ({
  completeLLM: vi.fn(async (_cfg: unknown, _msgs: unknown) => "## 场景1 · 街道（夜）· 改写版"),
  completeLLMStructured: vi.fn<(cfg: unknown, msgs: unknown, schema: unknown) => Promise<unknown>>(
    async () => ({ issues: [], pass: true, suggestion: "" }),
  ),
  getLLMConfig: vi.fn(async () => ({})),
  getVisionLLMConfig: vi.fn(async () => ({ model: "vision" })),
}));
vi.mock("~/lib/llm/server", () => ({
  completeLLM,
  completeLLMStructured,
  getLLMConfig,
  getVisionLLMConfig,
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));

import { productionRepository } from "~/lib/core/repository-production";
import { normalizeScriptReviewState } from "~/lib/production/review-types";
import { REVIEW_RUBRICS } from "~/lib/production/review-rubrics";
import {
  autoselectShotImage,
  regenerateShot,
  reviewContent,
  reviewScript,
  reviewShotImage,
  reviseScript,
} from "~/server/agent/review";
import { getTestDb, seedTask, seedUser, type Row } from "../../../tests/helpers/test-db";

const tdb = getTestDb();
const USER = "user-a";
const PROJ = "proj_rev";

async function seed(content: {
  characters?: Array<unknown>;
  scriptMarkdown?: string;
  shots?: Array<unknown>;
}) {
  await productionRepository.upsertForUser(USER, {
    characters: content.characters ?? [],
    id: PROJ,
    logline: "司机与乘客",
    progress: { rendered: false, stage: "script" },
    scenes: [],
    scriptMarkdown: content.scriptMarkdown ?? "# 剧本",
    shots: content.shots ?? [],
    title: "夜班车",
    tone: "冷峻",
    type: "short_video",
  });
}

/** 读回库里的 shots / characters。 */
async function rows(col: "shots" | "characters"): Promise<Array<Record<string, unknown>>> {
  const row = await productionRepository.getForUser(USER, PROJ);
  const raw = row?.[col];
  return Array.isArray(raw)
    ? /* SAFETY: 类型断言已复核 */ (raw as Array<Record<string, unknown>>)
    : [];
}

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { email: "a@test.dev", id: USER });
  completeLLMStructured.mockReset();
  completeLLMStructured.mockResolvedValue({
    issues: [],
    pass: true,
    suggestion: "",
  });
  completeLLM.mockReset();
  getLLMConfig.mockResolvedValue({});
  getVisionLLMConfig.mockResolvedValue({ model: "vision" });
});

describe("reviewContent", () => {
  it("评审镜头：结构化判定写回 shot.review 并返回（含 scoredAt）", async () => {
    await seed({
      shots: [{ description: "空荡的路", id: "s1", index: 1, prompt: "路" }],
    });
    completeLLMStructured.mockResolvedValueOnce({
      issues: ["画面含混"],
      pass: false,
      suggestion: "补主体与光线",
    });
    const verdict = await reviewContent(USER, PROJ, "shot", "s1");
    expect(verdict).toMatchObject({
      issues: ["画面含混"],
      pass: false,
      suggestion: "补主体与光线",
    });
    expect(typeof verdict.scoredAt).toBe("string");
    const [shot] = await rows("shots");
    expect(shot?.review).toEqual(verdict);
    // 只写内容列，没碰 run（run 仍是 upsert 默认的空对象，无 status）
    const row = await productionRepository.getForUser(USER, PROJ);
    expect(
      /* SAFETY: 类型断言已复核 */ (row?.run as Record<string, unknown> | undefined)?.status,
    ).toBeUndefined();
  });

  it("评审角色卡：判定写回 character.review", async () => {
    await seed({
      characters: [{ appearance: "中年", id: "c1", name: "司机" }],
    });
    completeLLMStructured.mockResolvedValueOnce({
      issues: [],
      pass: true,
      suggestion: "",
    });
    const verdict = await reviewContent(USER, PROJ, "character", "c1");
    expect(verdict.pass).toBe(true);
    const [c] = await rows("characters");
    expect(c?.review).toEqual(verdict);
  });

  it("目标 id 不存在 → 抛可行动错误，不调模型", async () => {
    await seed({ shots: [{ id: "s1" }] });
    await expect(reviewContent(USER, PROJ, "shot", "missing")).rejects.toThrow(
      /找不到要评审的分镜镜头/,
    );
    expect(completeLLMStructured).not.toHaveBeenCalled();
  });

  it("无生产数据行 → 抛可行动错误", async () => {
    await expect(reviewContent(USER, "proj_none", "shot", "s1")).rejects.toThrow(/还没有生产数据/);
  });

  it("评审温度走 review 档：getLLMConfig 收到 taskType=review（FR-QA-07 ③）", async () => {
    await seed({ shots: [{ description: "x", id: "s1" }] });
    await reviewContent(USER, PROJ, "shot", "s1");
    expect(getLLMConfig).toHaveBeenCalledWith({ taskType: "review" });
  });

  it("判定带维度评分与 rubric 版本（FR-QA-07 ①）：scores 落库、越界分夹取", async () => {
    await seed({ characters: [{ id: "c1", name: "司机" }] });
    completeLLMStructured.mockResolvedValueOnce({
      issues: [],
      pass: false,
      scores: {
        costume: { score: 2 },
        visual: { note: "很具象", score: 9 },
      },
      suggestion: "",
    });
    const verdict = await reviewContent(USER, PROJ, "character", "c1");
    expect(verdict.rubricVersion).toBe(REVIEW_RUBRICS.character.version);
    expect(verdict.scores).toEqual({
      costume: { note: "", score: 2 },
      visual: { note: "很具象", score: 5 },
    });
    const [c] = await rows("characters");
    expect(c?.review).toEqual(verdict);
  });
});

describe("reviewScript", () => {
  it("评审判定写回 production.scriptReview 列（含 rubric 版本与维度评分），并回完整曲线", async () => {
    await seed({ scriptMarkdown: "## 场景1 · 街道（夜）" });
    completeLLMStructured.mockResolvedValueOnce({
      issues: ["高潮缺失"],
      pass: false,
      scores: { structure: { note: "无高潮", score: 2 } },
      suggestion: "补一场对峙",
    });
    const outcome = await reviewScript(USER, PROJ);
    expect(outcome.verdict.pass).toBe(false);
    expect(outcome.verdict.rubricVersion).toBe(REVIEW_RUBRICS.script.version);
    expect(outcome.verdict.scores?.structure).toEqual({
      note: "无高潮",
      score: 2,
    });
    expect(outcome.history).toEqual([outcome.verdict]); // 首评曲线只含本轮
    const row = await productionRepository.getForUser(USER, PROJ);
    expect(normalizeScriptReviewState(row?.scriptReview).review).toEqual(outcome.verdict);
    // 温度档同 review
    expect(getLLMConfig).toHaveBeenCalledWith({ taskType: "review" });
  });

  it("二次评审：上轮判定进 reviewHistory，回包曲线 = [...history, review]", async () => {
    await seed({ scriptMarkdown: "# 剧本" });
    completeLLMStructured
      .mockResolvedValueOnce({ issues: ["a"], pass: false, suggestion: "s" })
      .mockResolvedValueOnce({ issues: [], pass: true, suggestion: "" });
    const first = await reviewScript(USER, PROJ);
    const second = await reviewScript(USER, PROJ);
    const row = await productionRepository.getForUser(USER, PROJ);
    const state = normalizeScriptReviewState(row?.scriptReview);
    expect(state.review).toEqual(second.verdict);
    expect(second.history).toEqual([first.verdict, second.verdict]);
  });

  it("无剧本 → 抛可行动错误，不调模型", async () => {
    await seed({ scriptMarkdown: "   " });
    await expect(reviewScript(USER, PROJ)).rejects.toThrow(/还没有剧本/);
    expect(completeLLMStructured).not.toHaveBeenCalled();
  });

  it("无生产数据行 → 抛可行动错误", async () => {
    await expect(reviewScript(USER, "proj_none")).rejects.toThrow(/还没有生产数据/);
  });
});

describe("reviseScript", () => {
  it("消费低分维度定向改写：新剧本落 scriptMarkdown，旧版留档 revisions", async () => {
    await seed({ scriptMarkdown: "## 场景1 · 旧版剧本" });
    completeLLMStructured.mockResolvedValueOnce({
      issues: ["高潮缺失"],
      pass: false,
      scores: { structure: { note: "无高潮", score: 2 } },
      suggestion: "补一场对峙",
    });
    await reviewScript(USER, PROJ);
    completeLLM.mockResolvedValueOnce("## 场景1 · 改写后的剧本");
    const md = await reviseScript(USER, PROJ);
    expect(md).toBe("## 场景1 · 改写后的剧本");
    const row = await productionRepository.getForUser(USER, PROJ);
    expect(row?.scriptMarkdown).toBe("## 场景1 · 改写后的剧本");
    const state = normalizeScriptReviewState(row?.scriptReview);
    expect(state.revisions).toHaveLength(1);
    expect(state.revisions[0]?.markdown).toBe("## 场景1 · 旧版剧本");
    expect(state.revisions[0]?.at).toBeTruthy();
    // 判定与轮次曲线不受留档影响
    expect(state.review).not.toBeNull();
    // 改写也走 review 温度档
    expect(getLLMConfig).toHaveBeenCalledWith({ taskType: "review" });
  });

  it("没评过（无评审位）→ 拒改并给可行动原因，不调模型", async () => {
    await seed({ scriptMarkdown: "# 剧本" });
    await expect(reviseScript(USER, PROJ)).rejects.toThrow(/还没有评审判定/);
    expect(completeLLM).not.toHaveBeenCalled();
  });

  it("模型空返回 → 抛错保留原剧本，不落库", async () => {
    await seed({ scriptMarkdown: "# 原剧本" });
    completeLLMStructured.mockResolvedValueOnce({
      issues: ["x"],
      pass: false,
      suggestion: "y",
    });
    await reviewScript(USER, PROJ);
    completeLLM.mockResolvedValueOnce("   ");
    await expect(reviseScript(USER, PROJ)).rejects.toThrow(/模型未返回/);
    const row = await productionRepository.getForUser(USER, PROJ);
    expect(row?.scriptMarkdown).toBe("# 原剧本");
  });

  it("无剧本 / 无生产数据行 → 抛可行动错误", async () => {
    await seed({ scriptMarkdown: " " });
    await expect(reviseScript(USER, PROJ)).rejects.toThrow(/还没有剧本/);
    await expect(reviseScript(USER, "proj_none")).rejects.toThrow(/还没有生产数据/);
  });
});

describe("regenerateShot", () => {
  it("gacha：保留提示词，清产物 + rev 自增，不调模型", async () => {
    await seed({
      shots: [
        {
          clipUrl: "/y.mp4",
          id: "s1",
          imageUrl: "/x.png",
          prompt: "原提示词",
          rev: 2,
          status: "done",
        },
      ],
    });
    await regenerateShot(USER, PROJ, "s1", "gacha");
    const [shot] = await rows("shots");
    expect(shot?.prompt).toBe("原提示词");
    expect(shot?.imageUrl).toBeUndefined();
    expect(shot?.clipUrl).toBeUndefined();
    expect(shot?.status).toBe("idle");
    expect(shot?.rev).toBe(3);
    expect(completeLLMStructured).not.toHaveBeenCalled();
  });

  it("reprompt（显式给新提示词）：换 prompt + 退回，不调模型", async () => {
    await seed({ shots: [{ id: "s1", imageUrl: "/x", prompt: "旧", rev: 0 }] });
    await regenerateShot(USER, PROJ, "s1", "reprompt", "新的具象提示词");
    const [shot] = await rows("shots");
    expect(shot?.prompt).toBe("新的具象提示词");
    expect(shot?.imageUrl).toBeUndefined();
    expect(shot?.rev).toBe(1);
    expect(completeLLMStructured).not.toHaveBeenCalled();
  });

  it("reprompt（未给新提示词）：据 shot.review 让模型改写并落库", async () => {
    await seed({
      shots: [
        {
          description: "一个人走路",
          id: "s1",
          imageUrl: "/x",
          prompt: "一个人走路",
          rev: 1,
          review: {
            issues: ["太含混"],
            pass: false,
            scoredAt: "t",
            suggestion: "补动作与光线",
          },
        },
      ],
    });
    completeLLMStructured.mockResolvedValueOnce({
      prompt: "夜雨中，司机撑伞走过空荡街道",
    });
    await regenerateShot(USER, PROJ, "s1", "reprompt");
    const [shot] = await rows("shots");
    expect(shot?.prompt).toBe("夜雨中，司机撑伞走过空荡街道");
    expect(shot?.rev).toBe(2);
    expect(completeLLMStructured).toHaveBeenCalledTimes(1);
  });

  it("reprompt：模型空返回 → 兜底保留原提示词（不抹空），仍完成退回", async () => {
    await seed({
      shots: [{ id: "s1", imageUrl: "/x", prompt: "原样", rev: 0 }],
    });
    completeLLMStructured.mockResolvedValueOnce({ prompt: "   " });
    await regenerateShot(USER, PROJ, "s1", "reprompt");
    const [shot] = await rows("shots");
    expect(shot?.prompt).toBe("原样");
    expect(shot?.imageUrl).toBeUndefined();
    expect(shot?.rev).toBe(1);
  });

  it("镜头不存在 → 抛可行动错误", async () => {
    await seed({ shots: [{ id: "s1" }] });
    await expect(regenerateShot(USER, PROJ, "missing", "gacha")).rejects.toThrow(
      /找不到要重生成的镜头/,
    );
  });
});

describe("reviewShotImage（P8-2 生图视觉评审）", () => {
  it("看图标定写回 shot.imageReview（与文本 shot.review 分开），并带生图 rubric 版本", async () => {
    await seed({
      characters: [{ id: "c1", name: "司机", portraitUrl: "/portrait.png" }],
      shots: [
        {
          characterIds: ["c1"],
          id: "s1",
          imageUrl: "/shot.png",
          prompt: "雨中司机",
          shotType: "中景",
        },
      ],
    });
    completeLLMStructured.mockResolvedValueOnce({
      issues: [],
      pass: true,
      scores: { promptAlignment: { note: "对题", score: 4 } },
      suggestion: "",
    });
    const verdict = await reviewShotImage(USER, PROJ, "s1");
    expect(verdict.pass).toBe(true);
    expect(verdict.rubricVersion).toBe(REVIEW_RUBRICS.shotImage.version);
    expect(verdict.scores?.promptAlignment).toEqual({ note: "对题", score: 4 });
    const [shot] = await rows("shots");
    // 视觉判定独立落 imageReview，不污染文本 review
    expect(shot?.imageReview).toEqual(verdict);
    expect(shot?.review).toBeUndefined();
    // 视觉评审走独立视觉模型配置通道
    expect(getVisionLLMConfig).toHaveBeenCalledWith({ taskType: "review" });
    // 消息里带图：镜头图 + 定妆照都进了 image_url 块
    const [, userMsg] = /* SAFETY: 类型断言已复核 */ completeLLMStructured.mock
      .calls[0]![1] as Array<{
      content: unknown;
      role: string;
    }>;
    const parts = /* SAFETY: 类型断言已复核 */ userMsg!.content as Array<{
      image_url?: unknown;
      type: string;
    }>;
    const imageUrls = parts
      .filter((p) => p.type === "image_url")
      .map((p) => /* SAFETY: 类型断言已复核 */ (p.image_url as { url: string }).url);
    expect(imageUrls).toEqual(["/shot.png", "/portrait.png"]);
  });

  it("没图（imageUrl 空）→ 抛可行动错误，不调模型", async () => {
    await seed({ shots: [{ id: "s1", prompt: "x" }] });
    await expect(reviewShotImage(USER, PROJ, "s1")).rejects.toThrow(/还没有生成图/);
    expect(completeLLMStructured).not.toHaveBeenCalled();
  });

  it("镜头 id 不存在 → 抛可行动错误", async () => {
    await seed({ shots: [{ id: "s1", imageUrl: "/x" }] });
    await expect(reviewShotImage(USER, PROJ, "missing")).rejects.toThrow(/找不到要评审的镜头/);
  });
});

// ── 自动优选：抽卡 N 选 1（FR-QA-04④ · #2612）──────────────────

describe("autoselectShotImage", () => {
  const cover = (id: string, path: string): Row => ({
    height: 512,
    id,
    isCover: true,
    localPath: path,
    mediaType: "image",
    seed: "42",
    sortIndex: 0,
    width: 512,
  });

  beforeEach(() => {
    // 默认判定带一个维度分（mean = score）；各用例再按需覆盖。
    completeLLMStructured.mockImplementation(async () => ({
      issues: [],
      pass: true,
      scores: { 对齐: { note: "", score: 3 } },
      suggestion: "",
    }));
  });

  it("逐候选打分，均分最高者为赢家；imageUrl/taskId 不被服务端直写（草稿回写口径）", async () => {
    await seed({
      shots: [
        {
          id: "shot-1",
          imageUrl: "/generated/task-a/1.png",
          index: 1,
          prompt: "一只猫",
          status: "done",
        },
      ],
    });
    seedTask(tdb, {
      id: "task-a",
      images: [cover("a1", "/generated/task-a/1.png")],
      projectId: PROJ,
      status: "SUCCEEDED",
      userId: USER,
    });
    seedTask(tdb, {
      id: "task-b",
      images: [cover("b1", "/generated/task-b/1.png")],
      projectId: PROJ,
      status: "SUCCEEDED",
      userId: USER,
    });
    // 候选 A 得 3 分、候选 B 得 5 分 → B 胜出。
    completeLLMStructured
      .mockResolvedValueOnce({
        issues: [],
        pass: true,
        scores: { 对齐: { note: "", score: 3 } },
        suggestion: "",
      })
      .mockResolvedValueOnce({
        issues: [],
        pass: true,
        scores: { 对齐: { note: "", score: 5 } },
        suggestion: "",
      });

    console.log("DEBUG row:", (await productionRepository.getForUser(USER, PROJ))?.id);
    const res = await autoselectShotImage(USER, PROJ, "shot-1", ["task-a", "task-b"]);
    expect(res.winnerTaskId).toBe("task-b");
    expect(res.winnerImageUrl).toBe("/generated/task-b/1.png");
    expect(res.candidates.length).toBe(2);

    // 赢家判定落 shot.imageReview（与 reviewShotImage 同一落点）；镜头的
    // imageUrl / taskId 不被服务端动（草稿回写口径，字段所有权见 #2615）。
    const shot = (await rows("shots"))[0]!;
    expect(
      /* SAFETY: 类型断言已复核 */ (shot.imageReview as { scores: unknown }).scores,
    ).toBeTruthy();
    expect(shot.imageUrl).toBe("/generated/task-a/1.png");
  });

  it("候选无产物 → 跳过并记录；全无产物 → 可行动错误", async () => {
    await seed({
      shots: [{ id: "shot-1", index: 1, prompt: "x", status: "done" }],
    });
    seedTask(tdb, {
      id: "task-empty",
      projectId: PROJ,
      status: "FAILED",
      userId: USER,
    });
    await expect(
      autoselectShotImage(USER, PROJ, "shot-1", ["task-empty", "task-empty"]),
    ).rejects.toThrow(/没有产物/);
  });

  it("候选不属于当前用户 → 拒绝；数量越界 → 可行动错误", async () => {
    await seed({ shots: [{ id: "shot-1", index: 1, prompt: "x" }] });
    seedTask(tdb, {
      id: "task-other",
      projectId: PROJ,
      status: "SUCCEEDED",
      userId: "user-b",
    });
    seedUser(tdb, { email: "b@test.dev", id: "user-b" });
    await expect(
      autoselectShotImage(USER, PROJ, "shot-1", ["task-other", "task-other"]),
    ).rejects.toThrow(/不属于当前用户/);
    await expect(autoselectShotImage(USER, PROJ, "shot-1", ["only-one"])).rejects.toThrow(/2~4/);
  });
});
