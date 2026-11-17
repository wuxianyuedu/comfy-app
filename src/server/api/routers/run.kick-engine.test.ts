/** kickEngine 的动态 import 兜底（#4224）：`import("~/server/agent/run-engine")` 本身
 *  reject（模块编译 / 加载失败）时不得冒成 unhandledRejection——fireAndForget 显式接住
 *  落 error 日志。独立成文件是因为 vi.mock 工厂的抛错只在模块**首次**加载时生效：
 *  与 run.test.ts 同文件跑时，先到的用例会把引擎模块缓存住，再翻开关不再触发。
 *  端点回执不受影响（拉引擎是 fire-and-forget，「不冒 rejection」这一判据由 vitest
 *  本身承压——冒出来即记败）。 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerMock = vi.hoisted(() => ({
  info: vi.fn((_msg: string) => undefined),
  warn: vi.fn((_msg: string) => undefined),
  error: vi.fn((_msg: string) => undefined),
  debug: vi.fn((_msg: string) => undefined),
}));
vi.mock("~/lib/core/logger", () => ({ logger: loggerMock }));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
/* 整个文件只测「引擎模块加载失败」这一条缝：工厂直接抛，动态 import 必 reject。 */
vi.mock("~/server/agent/run-engine", () => {
  throw new Error("module load failed (test)");
});
/* 评审编排在 kickEngine 的路径上不被触达，桩掉以免拖真依赖。 */
vi.mock("~/server/agent/review", () => ({
  autoselectShotImage: vi.fn(() => ({})),
  reviewContent: vi.fn(),
  regenerateShot: vi.fn(),
  reviewScript: vi.fn(),
  reviewShotImage: vi.fn(),
  reviseScript: vi.fn(),
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

describe("kickEngine 的动态 import 兜底（#4224）", () => {
  it("模块加载失败只落 error 日志（带定位信息），不冒 unhandledRejection", async () => {
    await productionRepository.upsertForUser("user-a", {
      id: "proj_kick",
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

    const res = await createCaller(makeCtx()).start({ projectId: "proj_kick", goal: "g" });
    expect(res.run.status).toBe("running");

    /* 等的是「值」走 expect.poll（§11.14.3）：error 日志的两条内容拼成一条轮询值。 */
    const errorTexts = (): string => loggerMock.error.mock.calls.map((c) => String(c[0])).join("|");
    await expect.poll(errorTexts).toContain("拉起执行引擎失败");
    await expect.poll(errorTexts).toContain("proj_kick");
  });
});
