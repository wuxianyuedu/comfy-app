/**
 * generationControl 路由用例（ISSUE #5055）：生图暂停状态的读写走库（单行
 * upsert）——默认未暂停；暂停 / 恢复往返，`pausedAt` 随暂停写、随恢复清；
 * 重复写幂等（永远只有一行）。
 * mock：db（真 Drizzle 内存库）、better-auth、logger（同 character-library 测试的处置）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { generationControlRouter } from "~/server/api/routers/generation-control";
import { generationControl } from "~/server/db/schema-generation-control";
import { getTestDb, seedUser, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(generationControlRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
});

describe("generationControl —— 生图暂停状态（ISSUE #5055）", () => {
  it("默认未暂停（表里还没有行）", async () => {
    expect(await caller().pauseState()).toEqual({ paused: false, pausedAt: null });
  });

  it("setPaused 往返：暂停记时刻，恢复清掉；库里状态随之可读", async () => {
    const paused = await caller().setPaused({ paused: true });
    expect(paused.paused).toBe(true);
    expect(paused.pausedAt).not.toBeNull();
    expect((await caller().pauseState()).paused).toBe(true);

    const resumed = await caller().setPaused({ paused: false });
    expect(resumed.paused).toBe(false);
    expect(resumed.pausedAt).toBeNull();
    expect(await caller().pauseState()).toEqual({ paused: false, pausedAt: null });
  });

  it("重复写幂等：永远只有 singleton 一行（upsert，不插新行）", async () => {
    await caller().setPaused({ paused: true });
    await caller().setPaused({ paused: true });
    const rows = await tdb.select().from(generationControl);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("singleton");
    expect(rows[0]?.paused).toBe(true);
  });
});
