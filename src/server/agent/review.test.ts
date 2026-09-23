/**
 * 服务端评审执行器单测（Phase 8 · P8-1a）：真实 productionRepository（内存 test-db）+
 * mock 掉 LLM（getLLMConfig / completeLLMStructured）。prompts 纯函数保持真实，锁住「提炼文本 →
 * 判定 → 写回 → 重生成」的落库语义与字段所有权（只写内容列，不碰 run）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { completeLLMStructured, getLLMConfig } = vi.hoisted(() => ({
  completeLLMStructured: vi.fn<
    (cfg: unknown, msgs: unknown, schema: unknown) => Promise<unknown>
  >(async () => ({ pass: true, issues: [], suggestion: "" })),
  getLLMConfig: vi.fn(async () => ({})),
}));
vi.mock("~/lib/llm/server", () => ({ getLLMConfig, completeLLMStructured }));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));

import { productionRepository } from "~/lib/core/repository-production";
import { regenerateShot, reviewContent } from "~/server/agent/review";
import { getTestDb, seedUser } from "../../../tests/helpers/test-db";

const tdb = getTestDb();
const USER = "user-a";
const PROJ = "proj_rev";

async function seed(content: {
  scriptMarkdown?: string;
  characters?: unknown[];
  shots?: unknown[];
}) {
  await productionRepository.upsertForUser(USER, {
    id: PROJ,
    title: "夜班车",
    type: "short_video",
    tone: "冷峻",
    logline: "司机与乘客",
    scriptMarkdown: content.scriptMarkdown ?? "# 剧本",
    scenes: [],
    characters: content.characters ?? [],
    shots: content.shots ?? [],
    progress: { stage: "script", rendered: false },
  });
}

/** 读回库里的 shots / characters。 */
async function rows(
  col: "shots" | "characters",
): Promise<Record<string, unknown>[]> {
  const row = await productionRepository.getForUser(USER, PROJ);
  const raw = row?.[col];
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: USER, email: "a@test.dev" });
  completeLLMStructured.mockReset();
  completeLLMStructured.mockResolvedValue({
    pass: true,
    issues: [],
    suggestion: "",
  });
  getLLMConfig.mockResolvedValue({});
});

describe("reviewContent", () => {
  it("评审镜头：结构化判定写回 shot.review 并返回（含 scoredAt）", async () => {
    await seed({
      shots: [{ id: "s1", index: 1, description: "空荡的路", prompt: "路" }],
    });
    completeLLMStructured.mockResolvedValueOnce({
      pass: false,
      issues: ["画面含混"],
      suggestion: "补主体与光线",
    });
    const verdict = await reviewContent(USER, PROJ, "shot", "s1");
    expect(verdict).toMatchObject({
      pass: false,
      issues: ["画面含混"],
      suggestion: "补主体与光线",
    });
    expect(typeof verdict.scoredAt).toBe("string");
    const [shot] = await rows("shots");
    expect(shot?.review).toEqual(verdict);
    // 只写内容列，没碰 run（run 仍是 upsert 默认的空对象，无 status）
    const row = await productionRepository.getForUser(USER, PROJ);
    expect(
      (row?.run as Record<string, unknown> | undefined)?.status,
    ).toBeUndefined();
  });

  it("评审角色卡：判定写回 character.review", async () => {
    await seed({
      characters: [{ id: "c1", name: "司机", appearance: "中年" }],
    });
    completeLLMStructured.mockResolvedValueOnce({
      pass: true,
      issues: [],
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
    await expect(
      reviewContent(USER, "proj_none", "shot", "s1"),
    ).rejects.toThrow(/还没有生产数据/);
  });
});

describe("regenerateShot", () => {
  it("gacha：保留提示词，清产物 + rev 自增，不调模型", async () => {
    await seed({
      shots: [
        {
          id: "s1",
          prompt: "原提示词",
          imageUrl: "/x.png",
          clipUrl: "/y.mp4",
          status: "done",
          rev: 2,
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
    await seed({ shots: [{ id: "s1", prompt: "旧", imageUrl: "/x", rev: 0 }] });
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
          id: "s1",
          description: "一个人走路",
          prompt: "一个人走路",
          imageUrl: "/x",
          rev: 1,
          review: {
            pass: false,
            issues: ["太含混"],
            suggestion: "补动作与光线",
            scoredAt: "t",
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
      shots: [{ id: "s1", prompt: "原样", imageUrl: "/x", rev: 0 }],
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
    await expect(
      regenerateShot(USER, PROJ, "missing", "gacha"),
    ).rejects.toThrow(/找不到要重生成的镜头/);
  });
});
