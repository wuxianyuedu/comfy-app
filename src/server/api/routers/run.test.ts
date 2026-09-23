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

import { createCallerFactory } from "~/server/api/trpc";
import { runRouter } from "~/server/api/routers/run";
import { productionRepository } from "~/lib/core/repository-production";
import { getTestDb, seedUser } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

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
  it("无生产数据 → 抛可行动错误", async () => {
    await expect(
      createCaller(makeCtx()).start({ projectId: "proj_x" }),
    ).rejects.toThrow(/还没有生产数据/);
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
