/**
 * #4604：宿主死亡兜底回收的仓储判据（内存 SQLite 真跑）。
 * `listStaleQueued` 按片捞「QUEUED + 未收口 + 年龄过线」的候选——与死信扫描
 * （`listStaleUnownedQueued`，只管陌生归属）互补：这条管**合法归属片**里「归属
 * 还在、但那片已经没有活宿主」的等待行。`finalizeHostQueuedFailure` 是归属例外
 * 的第二处（第一处是 `cancel`）：守卫只认 `QUEUED + claimedBy='host'`——inline 片、
 * 已领走（RUNNING）、已终态的行一个都不碰。SQL 主体见 repository-task-impl.ts。
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { createTaskRepoImpl } from "~/lib/core/repository-task-impl";
import { task } from "~/server/db/schema";
import { createTestDb, seedUser } from "./helpers/test-db";

const db = createTestDb();
/* createTestDb 走 sqlite-proxy（ISSUE #2586），与 TaskRepoDb 的结构约束同源，
 * 这里不需要任何断言就能直接交给 impl 工厂。 */
const repo = createTaskRepoImpl(db, { owner: "inline" });

/** 行龄口径：候选判定是 `createdAt < cutoff`（cutoff = now - 30s），造 60s 前的行必入选。 */
const stale = (): Date => new Date(Date.now() - 60_000);

beforeEach(() => {
  db.$reset();
  seedUser(db, { id: "u1", email: "u1@test.dev" });
});

/** 造一条任务行：只给判据关心的列，其余走 schema 默认。 */
async function seedTask(overrides: Partial<typeof task.$inferInsert> & { id: string }) {
  await db.insert(task).values({
    userId: "u1",
    type: "image",
    prompt: "p",
    params: {},
    workflowName: "wf",
    ...overrides,
  });
}

const rowOf = async (id: string) => (await db.select().from(task).where(eq(task.id, id)))[0];

describe("listStaleQueued（#4604 宿主片候选）", () => {
  it("只捞指定片里年龄过线、未收口的 QUEUED 行", async () => {
    await seedTask({ id: "h1", claimedBy: "host", createdAt: stale() });
    await seedTask({ id: "i1", claimedBy: "inline", createdAt: stale() });
    await seedTask({ id: "h2", claimedBy: "host", createdAt: new Date() });
    const rows = await repo.listStaleQueued("host", new Date(Date.now() - 30_000), 20);
    expect(rows.map((r) => r.id)).toEqual(["h1"]);
  });

  it("已领走（RUNNING）与已终态的同片行不进候选", async () => {
    await seedTask({ id: "h3", claimedBy: "host", status: "RUNNING", createdAt: stale() });
    await seedTask({
      id: "h4",
      claimedBy: "host",
      status: "FAILED",
      createdAt: stale(),
      finishedAt: new Date(),
    });
    const rows = await repo.listStaleQueued("host", new Date(Date.now() - 30_000), 20);
    expect(rows.map((r) => r.id)).toEqual([]);
  });
});

describe("finalizeHostQueuedFailure（#4604 归属例外第二处）", () => {
  it("QUEUED+host 的行被写成 FAILED 并带上原因与收口时刻", async () => {
    await seedTask({ id: "h5", claimedBy: "host", createdAt: stale() });
    expect(await repo.finalizeHostQueuedFailure("h5", "执行宿主已退出")).toBe("written");
    const row = await rowOf("h5");
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toBe("执行宿主已退出");
    expect(row?.finishedAt).not.toBeNull();
  });

  it("inline 片（skipped-not-owned）与已领走的行（skipped-terminal）都不碰", async () => {
    await seedTask({ id: "i2", claimedBy: "inline", createdAt: stale() });
    await seedTask({ id: "h6", claimedBy: "host", status: "RUNNING", createdAt: stale() });
    expect(await repo.finalizeHostQueuedFailure("i2", "x")).toBe("skipped-not-owned");
    expect(await repo.finalizeHostQueuedFailure("h6", "x")).toBe("skipped-terminal");
    expect((await rowOf("i2"))?.status).toBe("QUEUED");
    expect((await rowOf("h6"))?.status).toBe("RUNNING");
  });

  it("行不存在 → skipped-missing（读侧据此分辨「没写进去」的原因）", async () => {
    expect(await repo.finalizeHostQueuedFailure("nope", "x")).toBe("skipped-missing");
  });
});
