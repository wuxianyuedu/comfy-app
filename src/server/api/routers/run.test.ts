/**
 * run 控制端点集成测试（Phase 6 地基）：run 生命周期 + 由纯规划器回显的「下一步动作」。
 * mock 边界：~/server/db（内存替身）、~/server/better-auth（authedProcedure 走 makeCtx 注入的
 * 固定用户，不经真实会话）。repository 用真实实现，run 落在 production.run 列。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
// start/approve/resume 会 fire-and-forget 拉起执行引擎；端点测试只验状态回显，mock 掉引擎避免真跑。
vi.mock("~/server/agent/run-engine", () => ({
  advanceRunLoop: vi.fn(async () => undefined),
}));
// 评审 / 重生成的落库逻辑在 review.test.ts 覆盖；此处只验端点的入参校验 + 委派 seam。
const { reviewContent, regenerateShot } = vi.hoisted(() => ({
  reviewContent: vi.fn(async () => ({
    pass: false,
    issues: ["含混"],
    suggestion: "更具体",
    scoredAt: "t",
  })),
  regenerateShot: vi.fn(async () => undefined),
}));
vi.mock("~/server/agent/review", () => ({ reviewContent, regenerateShot }));

import { createCallerFactory } from "~/server/api/trpc";
import { runRouter } from "~/server/api/routers/run";
import { productionRepository } from "~/lib/core/repository-production";
import { getTestDb, seedUser } from "../../../../tests/helpers/test-db";
import { errorEnvelope, makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(runRouter);
const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
});

/** 建一条生产数据行（工坊会写的那几列），返回其 id。 */
async function seedProduction(
  id: string,
  over: Partial<{
    scriptMarkdown: string;
    characters: unknown[];
    shots: unknown[];
  }> = {},
) {
  await productionRepository.upsertForUser("user-a", {
    id,
    title: "T",
    type: "short_video",
    tone: "",
    logline: "",
    scriptMarkdown: over.scriptMarkdown ?? "",
    scenes: [],
    characters: over.characters ?? [],
    shots: over.shots ?? [],
    progress: { stage: "script", rendered: false },
  });
  return id;
}

describe("run.status", () => {
  it("无生产数据行 → idle + 空动作", async () => {
    const res = await createCaller(makeCtx()).status({
      projectId: "proj_none",
    });
    expect(res.run.status).toBe("idle");
    expect(res.action).toEqual({ kind: "idle" });
  });

  it("有内容但 run 未启动（idle）→ 仍回 idle（引擎不动作）", async () => {
    await seedProduction("proj_1", { scriptMarkdown: "# 剧本" });
    const res = await createCaller(makeCtx()).status({ projectId: "proj_1" });
    expect(res.run.status).toBe("idle");
    expect(res.action).toEqual({ kind: "idle" });
  });
});

describe("run.start / 生命周期", () => {
  it("无生产数据 → PRECONDITION_FAILED + 可行动文案", async () => {
    // 码必须是 4xx：写成裸 Error 会被归成 INTERNAL_SERVER_ERROR，界面只剩「出错了」，
    // 而「先在工坊产出内容」这句可行动的提示到不了用户面前（硬规则 4）。
    const env = await errorEnvelope(
      createCaller(makeCtx()).start({ projectId: "proj_x" }),
    );
    expect(env.code).toBe("PRECONDITION_FAILED");
    expect(env.message).toContain("还没有生产数据");
  });

  it("空项目启动 → running + 下一步 generate_script，并持久化 run", async () => {
    await seedProduction("proj_1");
    const res = await createCaller(makeCtx()).start({
      projectId: "proj_1",
      goal: "一句话",
    });
    expect(res.run.status).toBe("running");
    expect(res.run.approvalMode).toBe("stage"); // 默认档位
    expect(res.run.goal).toBe("一句话");
    expect(res.action).toEqual({ kind: "generate_script" });
    const row = await productionRepository.getForUser("user-a", "proj_1");
    expect((row?.run as { status: string }).status).toBe("running");
  });

  it("图缺 → 启动后下一步 render_images（只列缺图的镜）", async () => {
    await seedProduction("proj_2", {
      scriptMarkdown: "# 剧本",
      characters: [{ id: "c1" }],
      shots: [
        { id: "a", index: 1, prompt: "p", imageUrl: "/x.png" },
        { id: "b", index: 2, prompt: "p" },
      ],
    });
    const res = await createCaller(makeCtx()).start({ projectId: "proj_2" });
    expect(res.action).toEqual({ kind: "render_images", shotIds: ["b"] });
  });

  it("pause 后 status→paused 且回显 idle；再 resume→running", async () => {
    await seedProduction("proj_3");
    await createCaller(makeCtx()).start({ projectId: "proj_3" });
    const paused = await createCaller(makeCtx()).pause({ projectId: "proj_3" });
    expect(paused.run.status).toBe("paused");
    expect(paused.action).toEqual({ kind: "idle" });
    const resumed = await createCaller(makeCtx()).resume({
      projectId: "proj_3",
    });
    expect(resumed.run.status).toBe("running");
  });

  it("非 awaiting_approval 时 approve 是空操作（不误放行）", async () => {
    await seedProduction("proj_4");
    const res = await createCaller(makeCtx()).approve({ projectId: "proj_4" });
    expect(res.run.status).toBe("idle");
    expect(res.action).toEqual({ kind: "idle" });
  });

  it("cancel → cancelled", async () => {
    await seedProduction("proj_5");
    await createCaller(makeCtx()).start({ projectId: "proj_5" });
    const res = await createCaller(makeCtx()).cancel({ projectId: "proj_5" });
    expect(res.run.status).toBe("cancelled");
  });
});

describe("run.reviewShot / reviewCharacter / regenerateShot", () => {
  it("reviewShot → 委派评审执行器（shot 种类 + 目标 id）并回显 verdict", async () => {
    const res = await createCaller(makeCtx()).reviewShot({
      projectId: "proj_r",
      shotId: "s1",
    });
    expect(reviewContent).toHaveBeenCalledWith(
      "user-a",
      "proj_r",
      "shot",
      "s1",
    );
    expect(res.verdict.pass).toBe(false);
  });

  it("reviewCharacter → 以 character 种类委派", async () => {
    await createCaller(makeCtx()).reviewCharacter({
      projectId: "proj_r",
      characterId: "c1",
    });
    expect(reviewContent).toHaveBeenCalledWith(
      "user-a",
      "proj_r",
      "character",
      "c1",
    );
  });

  it("regenerateShot(gacha) → 委派重生成，mode 透传，返回 ok", async () => {
    const res = await createCaller(makeCtx()).regenerateShot({
      projectId: "proj_r",
      shotId: "s1",
      mode: "gacha",
    });
    expect(regenerateShot).toHaveBeenCalledWith(
      "user-a",
      "proj_r",
      "s1",
      "gacha",
      undefined,
    );
    expect(res.ok).toBe(true);
  });

  it("regenerateShot(reprompt + newPrompt) → 把新提示词一并透传", async () => {
    await createCaller(makeCtx()).regenerateShot({
      projectId: "proj_r",
      shotId: "s1",
      mode: "reprompt",
      newPrompt: "改进后的提示词",
    });
    expect(regenerateShot).toHaveBeenCalledWith(
      "user-a",
      "proj_r",
      "s1",
      "reprompt",
      "改进后的提示词",
    );
  });

  it("regenerateShot：mode 非法被入参 schema 拒绝", async () => {
    await expect(
      createCaller(makeCtx()).regenerateShot({
        projectId: "proj_r",
        shotId: "s1",
        mode: "乱" as "gacha",
      }),
    ).rejects.toThrow();
  });
});
