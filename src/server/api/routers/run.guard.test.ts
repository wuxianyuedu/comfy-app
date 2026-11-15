/**
 * run.cancel 终态幂等闸（ISSUE #3901）：done / failed 的 run 已收尾，
 * 取消不改写终态、原样回显；running 才写成 cancelled。
 * 引擎侧「不回写用户意图位」的配套判据见 run-engine.test.ts（#3893）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
// run.ts 顶部静态引入了评审执行器（连带 LLM 服务端配置）；本文件只测 cancel 的
// 状态闸，整族 mock 成空实现，避免拖进真实模型配置读取。
vi.mock("~/server/agent/review", () => ({
  regenerateShot: vi.fn(),
  reviewContent: vi.fn(),
  reviewScript: vi.fn(),
  autoselectShotImage: vi.fn(),
  reviewShotImage: vi.fn(),
  reviseScript: vi.fn(),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { runRouter } from "~/server/api/routers/run";
import { productionRepository } from "~/lib/core/repository-production";
import { normalizeProductionRun, type ProductionRun } from "~/lib/production/run-types";
import { makeCtx } from "../../../../tests/helpers/trpc";
import { getTestDb, seedUser } from "../../../../tests/helpers/test-db";

const createCaller = createCallerFactory(runRouter);
const caller = () => createCaller(makeCtx());
const tdb = getTestDb();
const USER = "user-a"; // 与 makeCtx 的默认测试用户对齐（seedUser 同一份）
const PROJ = "proj_run_guard";

/** 建生产数据行并把 run 置到指定状态（同 run-engine.test.ts 的 seed 形状）。 */
async function seedRun(run: Partial<ProductionRun>) {
  await productionRepository.upsertForUser(USER, {
    id: PROJ,
    title: "T",
    type: "short_video",
    tone: "",
    logline: "",
    scriptMarkdown: "",
    scenes: [],
    characters: [],
    shots: [],
    progress: { stage: "script", rendered: false },
  });
  const row = await productionRepository.getForUser(USER, PROJ);
  const base = normalizeProductionRun(row?.run);
  await productionRepository.updateRun(USER, PROJ, { ...base, ...run });
}

const statusOf = async () =>
  normalizeProductionRun((await productionRepository.getForUser(USER, PROJ))?.run).status;

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: USER, email: "a@test.dev" });
});

describe("run.cancel 终态幂等（#3901）", () => {
  it("done 的 run 取消：原样回显，终态不被改写成 cancelled", async () => {
    await seedRun({ status: "done" });
    const res = await caller().cancel({ projectId: PROJ });
    expect(res.run.status).toBe("done");
    expect(await statusOf()).toBe("done");
  });

  it("failed 的 run 取消：原样回显", async () => {
    await seedRun({ status: "failed", error: "执行失败" });
    const res = await caller().cancel({ projectId: PROJ });
    expect(res.run.status).toBe("failed");
    expect(res.run.error).toBe("执行失败");
    expect(await statusOf()).toBe("failed");
  });

  it("已 cancelled 的重复取消：幂等返回", async () => {
    await seedRun({ status: "cancelled" });
    const res = await caller().cancel({ projectId: PROJ });
    expect(res.run.status).toBe("cancelled");
    expect(await statusOf()).toBe("cancelled");
  });

  it("running 的 run 取消：照旧写成 cancelled", async () => {
    await seedRun({ status: "running" });
    const res = await caller().cancel({ projectId: PROJ });
    expect(res.run.status).toBe("cancelled");
    expect(await statusOf()).toBe("cancelled");
  });
});
