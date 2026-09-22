/**
 * `repository-production.ts` 的集成测试（Phase 3b）。
 *
 * 走 `tests/helpers/test-db.ts` 的内存 SQLite + 真 Drizzle：生产仓储的正确性全在
 * 「SQL 怎么写 + JSON 列的序列化/还原 + upsert 的新建 vs 更新分支 + 归属过滤」上，
 * mock 断言调用次数测不到这些。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});

import { productionRepository } from "~/lib/core/repository-production";
import { getTestDb, seedUser } from "../../../tests/helpers/test-db";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
});

describe("ProductionRepository", () => {
  it("upsert 新建后 getForUser 读回，JSON 列还原为对象", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "我的短剧",
      shots: [{ id: "s1", index: 1, prompt: "p" }],
      progress: { stage: "storyboard", rendered: false },
    });
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got).not.toBeNull();
    expect(got?.title).toBe("我的短剧");
    expect(got?.shots).toEqual([{ id: "s1", index: 1, prompt: "p" }]);
    expect(got?.progress).toEqual({ stage: "storyboard", rendered: false });
  });

  it("同 id 二次 upsert 走更新分支（title 变、不新增行）", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "v1",
      shots: [],
    });
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "v2",
      shots: [{ id: "s9" }],
    });
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got?.title).toBe("v2");
    expect(got?.shots).toEqual([{ id: "s9" }]);
  });

  it("跨用户读不到（getForUser 带 userId 过滤）", async () => {
    seedUser(tdb, { id: "u1", email: "u1@test.dev" });
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "u1 的",
    });
    expect(await productionRepository.getForUser("u2", "proj_1")).toBeNull();
    expect(
      await productionRepository.getForUser("u1", "proj_1"),
    ).not.toBeNull();
  });
});
