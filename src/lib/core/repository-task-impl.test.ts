/**
 * `repository-task-impl.ts` 的 13 个 exec-chain 方法的契约测（12 方法主体来自
 * P3 §5 Phase 2-A-1；`claimNextQueued` 为 Phase 3-A 追加，见下方专组）。
 *
 * 为什么单独一份测试、而不是加进 `repository.test.ts`：impl 是**双宿主共用**的
 * 实现（Next 侧与未来 executor host 都走同一份），它的正确性独立于 `TaskRepository`
 * 类的 delegate 装配——测试直接吃 `createTaskRepoImpl(db)`，锁的是 SQL 主体的
 * 语义（compare-and-set 判据、4 条件 AND、有/无 workflowSnapshot 的 spread、
 * `validationErrors` 归一、`replaceLogs` 的 swallow 等）。
 *
 * db 用**内存 SQLite + 真 Drizzle**（`tests/helpers/test-db.ts` 那套 better-sqlite3
 * 后端）。`createTaskRepoImpl` 形参类型是 `TaskRepoDb`（libsql 客户端），本文件
 * 里做一次 `as unknown as TaskRepoDb`——不是"给实现加抽象妥协"，而是
 * **测试基建（better-sqlite3）与运行时（libsql）在结构上兼容同一份 drizzle
 * builder API**、只是类型名义不同。P3 §5 ADR 附录 §11.1 决定 1 里明确了这条
 * 断言的落点。
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestDb,
  seedUser,
  type TestDb,
} from "../../../tests/helpers/test-db";
import { task } from "~/server/db/schema";
import { createTaskRepoImpl, type TaskRepoImpl } from "./repository-task-impl";
import type { TaskRepoDb } from "./repository-task-impl-types";

let tdb: TestDb;
let impl: TaskRepoImpl;
let userId: string;

beforeAll(() => {
  tdb = createTestDb();
  // 内存测试库结构上是同一份 drizzle builder，运行时类型名义不同（better-sqlite3
  // vs libsql）；一次性断言、之后所有 impl 方法都用这个 `db`。
  impl = createTaskRepoImpl(tdb as unknown as TaskRepoDb);
});

beforeEach(() => {
  tdb.$reset();
  userId = `u-${Math.random().toString(36).slice(2, 8)}`;
  seedUser(tdb, { id: userId, email: `${userId}@x.io` });
});

/** 建一行任务。`extra` 里的字段直接落到 task 表（比 seedTask 少了类型限制）。 */
async function seed(extra: Record<string, unknown> = {}): Promise<string> {
  const id = `t-${Math.random().toString(36).slice(2, 10)}`;
  await (tdb as unknown as TaskRepoDb).insert(task).values({
    id,
    userId,
    type: "TXT2IMG",
    prompt: "p",
    params: {},
    workflowName: "w",
    status: "QUEUED",
    ...extra,
  } as never);
  return id;
}

function readRow(id: string): Record<string, unknown> | undefined {
  return (tdb.$tables.tasks as Array<Record<string, unknown>>).find(
    (r) => r.id === id,
  );
}

describe("findExecutionMeta", () => {
  it("命中时返回 projectId / params / prompt / negativePrompt / workflowName / referenceImages / createdAt 七列", async () => {
    const id = await seed({
      projectId: "proj-1",
      negativePrompt: "neg",
      referenceImages: ["a.png"],
      createdAt: new Date("2026-01-02T03:04:05Z"),
    });
    const meta = await impl.findExecutionMeta(id);
    expect(meta).not.toBeNull();
    expect(meta?.projectId).toBe("proj-1");
    expect(meta?.negativePrompt).toBe("neg");
    expect(meta?.referenceImages).toEqual(["a.png"]);
    const createdAt = meta?.createdAt;
    expect(createdAt).toBeInstanceOf(Date);
    // 用 instanceof 把类型 narrow 到 Date，避免 `!` 与 `as` 两种形态
    // （前者被 src 非空断言棘轮数、后者被 non-nullable-type-assertion-style 拦）。
    if (createdAt instanceof Date) {
      expect(createdAt.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    }
  });

  it("未知 id 返回 null（不抛）", async () => {
    expect(await impl.findExecutionMeta("nope")).toBeNull();
  });
});

describe("updateProgress（compare-and-set：终态行不改写）", () => {
  it("QUEUED / RUNNING 行更新到目标 pct + status 标 RUNNING；返回 true", async () => {
    const id = await seed({ status: "QUEUED" });
    expect(await impl.updateProgress(id, 42)).toBe(true);
    const row = readRow(id);
    expect(row?.progress).toBe(42);
    expect(row?.status).toBe("RUNNING");
  });

  it("三种终态（SUCCEEDED / FAILED / CANCELLED）都返 false、行不变（迟到进度帧被丢弃）", async () => {
    for (const status of ["SUCCEEDED", "FAILED", "CANCELLED"]) {
      const id = await seed({ status, progress: 88 });
      expect(await impl.updateProgress(id, 50), `status=${status}`).toBe(false);
      expect(readRow(id)?.progress).toBe(88);
    }
  });
});

describe("markRunning（同族 compare-and-set）", () => {
  it("QUEUED → RUNNING + 记下 promptId", async () => {
    const id = await seed({ status: "QUEUED" });
    expect(await impl.markRunning(id, "pid-1")).toBe(true);
    const row = readRow(id);
    expect(row?.status).toBe("RUNNING");
    expect(row?.promptId).toBe("pid-1");
  });

  it("终态行不被打回 RUNNING", async () => {
    const id = await seed({ status: "SUCCEEDED", promptId: "orig" });
    expect(await impl.markRunning(id, "late")).toBe(false);
    expect(readRow(id)?.promptId).toBe("orig");
  });
});

describe("finalizeSuccess", () => {
  it("写 SUCCEEDED + progress=100 + finishedAt + resultImages + params", async () => {
    const id = await seed({ status: "RUNNING" });
    await impl.finalizeSuccess(id, {
      resultImages: [{ path: "a.png" }],
      params: { seed: 1 },
    });
    const row = readRow(id);
    expect(row?.status).toBe("SUCCEEDED");
    expect(row?.progress).toBe(100);
    expect(row?.finishedAt).toBeTruthy();
    expect(row?.resultImages).toEqual([{ path: "a.png" }]);
  });

  it("workflowSnapshot undefined 分支不动原值；有值时覆盖", async () => {
    const id = await seed({
      status: "RUNNING",
      workflowSnapshot: { keep: true },
    });
    await impl.finalizeSuccess(id, { resultImages: [], params: {} });
    expect(readRow(id)?.workflowSnapshot).toEqual({ keep: true });

    const id2 = await seed({ status: "RUNNING" });
    await impl.finalizeSuccess(id2, {
      resultImages: [],
      params: {},
      workflowSnapshot: { fresh: 1 },
    });
    expect(readRow(id2)?.workflowSnapshot).toEqual({ fresh: 1 });
  });
});

describe("finalizeFailure", () => {
  it("写 FAILED + error + finishedAt；validationErrors 缺省与空数组都归一存 null", async () => {
    const idA = await seed({ status: "RUNNING" });
    await impl.finalizeFailure(idA, "boom");
    expect(readRow(idA)?.validationErrors).toBeFalsy();

    const idB = await seed({ status: "RUNNING" });
    await impl.finalizeFailure(idB, "boom", []);
    expect(readRow(idB)?.validationErrors).toBeFalsy();
  });

  it("非空数组走 JSON.stringify 落盘（$tables 视图已 parseRow 反序列化为对象）", async () => {
    const id = await seed({ status: "RUNNING" });
    await impl.finalizeFailure(id, "boom", [{ msg: "x" }]);
    // test-db 的 `jsonColumns` 里含 `validationErrors`，`$tables.tasks` 读到的
    // 是反序列化后的对象（原始列经 `serializeValue` 落 JSON 字符串、parseRow
    // 再解回来）；因此断对象而不是断字符串。空数组与 undefined 归一为 null
    // 的分支由上一条断言覆盖。
    expect(readRow(id)?.validationErrors).toEqual([{ msg: "x" }]);
  });
});

describe("cancel", () => {
  it("写 CANCELLED + finishedAt", async () => {
    const id = await seed({ status: "RUNNING" });
    await impl.cancel(id);
    const row = readRow(id);
    expect(row?.status).toBe("CANCELLED");
    expect(row?.finishedAt).toBeTruthy();
  });
});

describe("finalizeFromReaper", () => {
  it("status 由调用方指定；error 允许 null（reaper 对账 /history 拿到成功时）", async () => {
    const id = await seed({ status: "RUNNING" });
    await impl.finalizeFromReaper(id, "SUCCEEDED", null);
    const row = readRow(id);
    expect(row?.status).toBe("SUCCEEDED");
    expect(row?.error).toBeNull();
  });

  it("FAILED 分支带 error 字符串", async () => {
    const id = await seed({ status: "RUNNING" });
    await impl.finalizeFromReaper(id, "FAILED", "orphan");
    const row = readRow(id);
    expect(row?.status).toBe("FAILED");
    expect(row?.error).toBe("orphan");
  });
});

describe("findStatusAndPromptById", () => {
  it("只取两列，返回 { status, promptId }", async () => {
    const id = await seed({ status: "RUNNING", promptId: "p-1" });
    expect(await impl.findStatusAndPromptById(id)).toEqual({
      status: "RUNNING",
      promptId: "p-1",
    });
  });

  it("未知 id 返回 null", async () => {
    expect(await impl.findStatusAndPromptById("nope")).toBeNull();
  });
});

describe("replaceLogs（swallow 语义：写失败不抛，面板视图仍在）", () => {
  it("正常路径写入 logs 列", async () => {
    const id = await seed({});
    await impl.replaceLogs(id, [{ t: 1, level: "info", msg: "hi" }]);
    expect(readRow(id)?.logs).toEqual([{ t: 1, level: "info", msg: "hi" }]);
  });

  it("未知 id 也不抛（.catch(→undefined) 咽下）", async () => {
    await expect(impl.replaceLogs("no-such-row", [])).resolves.toBeUndefined();
  });
});

describe("listStaleQueued（reaper 扫 QUEUED 孤儿：4 条件 AND）", () => {
  const oldDate = new Date(Date.now() - 60_000);
  const freshDate = new Date();
  const cutoff = new Date(Date.now() - 30_000);

  it("命中：QUEUED + finishedAt=null + createdAt<cutoff + promptId=null", async () => {
    const id = await seed({
      status: "QUEUED",
      createdAt: oldDate,
      promptId: null,
    });
    const got = await impl.listStaleQueued(cutoff, 10);
    expect(got.map((r) => r.id)).toContain(id);
  });

  it("破一条：已 finishedAt 不返", async () => {
    await seed({
      status: "QUEUED",
      createdAt: oldDate,
      finishedAt: new Date(),
    });
    expect(await impl.listStaleQueued(cutoff, 10)).toHaveLength(0);
  });

  it("破一条：createdAt 不早于 cutoff 不返（还没到 stale 时限）", async () => {
    await seed({ status: "QUEUED", createdAt: freshDate });
    expect(await impl.listStaleQueued(cutoff, 10)).toHaveLength(0);
  });

  it("破一条：有 promptId 不返（归 ComfyUI 负责，由 listStaleRunning 对账）", async () => {
    await seed({ status: "QUEUED", createdAt: oldDate, promptId: "pid" });
    expect(await impl.listStaleQueued(cutoff, 10)).toHaveLength(0);
  });

  it("破一条：status 不是 QUEUED 不返（RUNNING 走 listStaleRunning 对账）", async () => {
    await seed({ status: "RUNNING", createdAt: oldDate });
    expect(await impl.listStaleQueued(cutoff, 10)).toHaveLength(0);
  });
});

describe("listStaleRunning（reaper 扫 RUNNING 孤儿：4 条件 AND + promptId 非空）", () => {
  const oldDate = new Date(Date.now() - 60_000);
  const cutoff = new Date(Date.now() - 30_000);

  it("命中：RUNNING + finishedAt=null + createdAt<cutoff + promptId 非空", async () => {
    const id = await seed({
      status: "RUNNING",
      createdAt: oldDate,
      promptId: "pid-1",
    });
    const got = await impl.listStaleRunning(cutoff, 10);
    expect(got.map((r) => r.id)).toContain(id);
  });

  it("与 Queued 版对偶：无 promptId 的 RUNNING 不返（那条走 Queued 判决）", async () => {
    await seed({
      status: "RUNNING",
      createdAt: oldDate,
      promptId: null,
    });
    expect(await impl.listStaleRunning(cutoff, 10)).toHaveLength(0);
  });
});

describe("createImages", () => {
  it("落多行 TaskImage：width/height 缺省时存 null", async () => {
    const id = await seed({});
    await impl.createImages(id, [
      {
        localPath: "a.png",
        sortIndex: 0,
        isCover: true,
        mediaType: "image",
        seed: "42",
      },
      {
        localPath: "b.mp4",
        sortIndex: 1,
        isCover: false,
        mediaType: "video",
        seed: null,
        width: 1024,
        height: 512,
      },
    ]);
    const imgs = (
      tdb.$tables.taskImages as Array<Record<string, unknown>>
    ).filter((r) => r.taskId === id);
    expect(imgs).toHaveLength(2);
    const first = imgs.find((r) => r.localPath === "a.png");
    const second = imgs.find((r) => r.localPath === "b.mp4");
    expect(first).toMatchObject({
      isCover: 1,
      seed: "42",
      width: null,
      height: null,
    });
    expect(second).toMatchObject({
      isCover: 0,
      seed: null,
      width: 1024,
      height: 512,
    });
  });
});

describe("claimNextQueued（Phase 3-A：单语句原子领取 + §6 归属谓词）", () => {
  /** 建三行 QUEUED：一行显式 host、一行显式 inline、一行 NULL（历史行形态）。 */
  async function seedThreeOwned(): Promise<{
    hostId: string;
    inlineId: string;
    nullId: string;
  }> {
    const base = Date.now() - 10_000;
    const hostId = await seed({
      claimedBy: "host",
      createdAt: new Date(base + 1000),
    });
    const inlineId = await seed({
      claimedBy: "inline",
      createdAt: new Date(base + 2000),
    });
    const nullId = await seed({ createdAt: new Date(base + 3000) });
    return { hostId, inlineId, nullId };
  }

  it("host 只领 claimedBy='host' 的行；NULL 与 'inline' 行原样留在 QUEUED", async () => {
    const { hostId, inlineId, nullId } = await seedThreeOwned();
    const claimed = await impl.claimNextQueued("host", 10);
    expect(claimed).toEqual([hostId]);
    expect(readRow(hostId)).toMatchObject({
      status: "RUNNING",
      claimedBy: "host",
    });
    expect(readRow(inlineId)?.status).toBe("QUEUED");
    expect(readRow(nullId)?.status).toBe("QUEUED");
  });

  it("inline 领 NULL 与 'inline' 两种行，且领取时把 NULL 覆写成显式 'inline'", async () => {
    const { hostId, inlineId, nullId } = await seedThreeOwned();
    const claimed = await impl.claimNextQueued("inline", 10);
    // FIFO：createdAt 升序（inline 行早于 NULL 行）
    expect(claimed).toEqual([inlineId, nullId]);
    expect(readRow(inlineId)).toMatchObject({
      status: "RUNNING",
      claimedBy: "inline",
    });
    expect(readRow(nullId)).toMatchObject({
      status: "RUNNING",
      claimedBy: "inline",
    });
    expect(readRow(hostId)?.status).toBe("QUEUED");
  });

  it("take 截断：只领最早的 N 行，剩下的留给下一轮", async () => {
    const { inlineId, nullId } = await seedThreeOwned();
    expect(await impl.claimNextQueued("inline", 1)).toEqual([inlineId]);
    // 第二轮才领到 NULL 行——两次的并集恰是两行、无重叠（单语句原子性的
    // 可观测面：第一轮领走的行不可能被第二轮再看到）。
    expect(await impl.claimNextQueued("inline", 10)).toEqual([nullId]);
  });

  it("非 QUEUED 行不参与领取（RUNNING / SUCCEEDED 各一行都不被碰）", async () => {
    await seed({ status: "RUNNING", claimedBy: "host" });
    await seed({ status: "SUCCEEDED", claimedBy: "host" });
    expect(await impl.claimNextQueued("host", 10)).toHaveLength(0);
  });

  it("无可领行时返回空数组且零副作用（他方归属的行不动）", async () => {
    const hostId = await seed({ claimedBy: "host" });
    // inline 面对「只有 host 行」的队列表：空手而归，且不碰别人的行
    expect(await impl.claimNextQueued("inline", 10)).toEqual([]);
    expect(readRow(hostId)).toMatchObject({
      status: "QUEUED",
      claimedBy: "host",
    });
    // 同一行随后可被正主领走
    expect(await impl.claimNextQueued("host", 10)).toEqual([hostId]);
  });
});
