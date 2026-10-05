/**
 * `repository-task-impl.ts` 的 16 个 exec-chain 方法的契约测（12 方法主体来自
 * P3 §5 Phase 2-A-1；`claimNextQueued` 为 Phase 3-A 追加，见下方专组；
 * `replaceRawCli` / `findRawCli` 为 Phase 4-B2 追加）。
 *
 * 为什么单独一份测试、而不是加进 `repository.test.ts`：impl 是**双宿主共用**的
 * 实现（Next 侧与未来 executor host 都走同一份），它的正确性独立于 `TaskRepository`
 * 类的 delegate 装配——测试直接吃 `createTaskRepoImpl(db, { owner })`（同一份内存
 * 库上挂 inline / host 两份实例，只差构造期的归属声明，§14 D4 那一组靠它们对测
 * 两片的写入），锁的是 SQL 主体的语义（compare-and-set 判据、终态与归属两条守卫、
 * 4 条件 AND、有/无 workflowSnapshot 的 spread、`validationErrors` 归一、
 * `replaceLogs` 的 swallow 等）。
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
/** host 归属那一片的实例：与 `impl` 同库、只差构造期的 owner 声明。 */
let hostImpl: TaskRepoImpl;
let userId: string;

beforeAll(() => {
  tdb = createTestDb();
  // 内存测试库结构上是同一份 drizzle builder，运行时类型名义不同（better-sqlite3
  // vs libsql）；一次性断言、之后所有 impl 方法都用这个 `db`。
  impl = createTaskRepoImpl(tdb as unknown as TaskRepoDb, { owner: "inline" });
  hostImpl = createTaskRepoImpl(tdb as unknown as TaskRepoDb, {
    owner: "host",
  });
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

/** `claimedAt` 的毫秒值（没写过就是 null）。
 *  测试库把 `*At` 结尾的列统一还原成 `Date`（`tests/helpers/test-db.ts` 的
 *  `parseRow`），所以这里比 `getTime()` 而不是比对象身份——每次读都是新构造的
 *  `Date`，`toBe` 会恒假。 */
function claimedMs(id: string): number | null {
  const value = readRow(id)?.claimedAt;
  return value instanceof Date ? value.getTime() : null;
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

  it("node 快照随进度落 progressNode 列；帧无节点信息时不覆写（3-C D1）", async () => {
    const id = await seed({ status: "QUEUED" });
    const node = { id: "76", value: 3, max: 20, label: "KSampler" };
    expect(await impl.updateProgress(id, 30, node)).toBe(true);
    expect(readRow(id)?.progressNode).toEqual(node);
    // 下一帧没带节点：progress 更新、progressNode 保留上一个（标签不闪没）
    expect(await impl.updateProgress(id, 40)).toBe(true);
    expect(readRow(id)?.progress).toBe(40);
    expect(readRow(id)?.progressNode).toEqual(node);
  });

  it("progressNode 原样存 classType（4-B2：画布读 label、状态栏读类名）", async () => {
    const id = await seed({ status: "QUEUED" });
    const node = {
      id: "76",
      value: 3,
      max: 20,
      classType: "KSampler",
      label: "采样器",
    };
    expect(await impl.updateProgress(id, 30, node)).toBe(true);
    expect(readRow(id)?.progressNode).toEqual(node);
  });

  it("第一条进度帧把 claimedAt 从 NULL 定格，后续帧不刷新（4-B2 的耗时基准）", async () => {
    const id = await seed({ status: "QUEUED" });
    await impl.updateProgress(id, 10, { id: "1", value: 1, max: 10 });
    expect(claimedMs(id)).not.toBeNull();
    const first = claimedMs(id);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await impl.updateProgress(id, 20, { id: "2", value: 2, max: 10 });
    /* COALESCE 而不是无条件覆写：进度帧每几秒一发，跟着刷就等于「已运行」永远
     * 接近零。 */
    expect(claimedMs(id)).toBe(first);
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

  it("没写过进度时由 markRunning 定格 claimedAt；已有则不覆写（4-B2）", async () => {
    const id = await seed({ status: "QUEUED" });
    expect(await impl.markRunning(id, "pid-a")).toBe(true);
    expect(claimedMs(id)).not.toBeNull();

    const other = await seed({ status: "QUEUED" });
    await impl.updateProgress(other, 10, { id: "1", value: 1, max: 10 });
    const fromProgress = claimedMs(other);
    await new Promise((resolve) => setTimeout(resolve, 5));
    /* raw 路径的 promptId 常常整轮跑完才回传（#1184 实测），若这里无条件覆写，
     * 状态栏的耗时会从收尾那一刻重新开始。 */
    expect(await impl.markRunning(other, "pid-b")).toBe(true);
    expect(claimedMs(other)).toBe(fromProgress);
    expect(readRow(other)?.promptId).toBe("pid-b");
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

describe("listStaleUnownedQueued（reaper 的死信扫描：5 条件 AND，ISSUE #1204）", () => {
  const oldDate = new Date(Date.now() - 60_000);
  const freshDate = new Date();
  const cutoff = new Date(Date.now() - 30_000);
  /** 没有任何宿主片会领的归属值——本条规则**唯一**的命中形状。 */
  const unowned = "worker";

  it("命中：QUEUED + finishedAt=null + createdAt<cutoff + promptId=null + 无主归属", async () => {
    const id = await seed({
      status: "QUEUED",
      createdAt: oldDate,
      promptId: null,
      claimedBy: unowned,
    });
    const got = await impl.listStaleUnownedQueued(cutoff, 10);
    expect(got.map((r) => r.id)).toContain(id);
    /* 判死原因要把「哪个归属值没人领」说出来，所以 claimedBy 必须在投影里。 */
    expect(got.find((r) => r.id === id)?.claimedBy).toBe(unowned);
  });

  const broken: Array<[string, Record<string, unknown>]> = [
    ["已 finishedAt 不返", { finishedAt: new Date() }],
    ["createdAt 不早于 cutoff 不返（还没过时限）", { createdAt: freshDate }],
    [
      "有 promptId 不返（归 ComfyUI 负责，由 listStaleRunning 对账）",
      { promptId: "pid" },
    ],
    [
      "status 不是 QUEUED 不返（RUNNING 走 listStaleRunning 对账）",
      { status: "RUNNING" },
    ],
  ];
  it.for(broken)("破一条：%s", async ([, extra]) => {
    await seed({
      status: "QUEUED",
      createdAt: oldDate,
      claimedBy: unowned,
      ...extra,
    });
    expect(await impl.listStaleUnownedQueued(cutoff, 10)).toHaveLength(0);
  });

  /* 本刀的正面对象：三种正常归属的 aged `QUEUED` 行**一律不返**。pull 模型下它们
   *  是健康的等待态（等槽 / 等本片宿主起来 / 等 ComfyUI 就绪），归领取循环负责；
   *  旧判据会把新宿主 boot 第一拍还没赶上的遗留行当场判成「请重新执行」——实测
   *  boot 诊断 `hostShardQueued=1` 与 1.4s 后的 FAILED 说的就是同一行（ISSUE #1204）。
   *  这一条同时钉住 `ownedBy()` 的 NULL 归 inline 语义不许漂。 */
  it("正常归属（NULL / 'inline' / 'host'）的 aged QUEUED 行一律不返", async () => {
    await seed({ status: "QUEUED", createdAt: oldDate });
    await seed({ status: "QUEUED", createdAt: oldDate, claimedBy: "inline" });
    await seed({ status: "QUEUED", createdAt: oldDate, claimedBy: "host" });
    expect(await impl.listStaleUnownedQueued(cutoff, 10)).toHaveLength(0);
  });
});
describe("listStaleRunning（reaper 扫 RUNNING 孤儿：状态/时限/归属三条 AND，promptId 可为空）", () => {
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

  it("无 promptId 的 RUNNING 行也交出来（ISSUE #1184：以前这条条件把它挡成回收黑洞）", async () => {
    const id = await seed({
      status: "RUNNING",
      createdAt: oldDate,
      promptId: null,
    });
    expect(
      (await impl.listStaleRunning(cutoff, 10)).map((r) => r.id),
    ).toContain(id);
  });

  it("归属分片（Phase 3-B0）：RUNNING 片同样按 claimedBy 切，与领取谓词同一条判据", async () => {
    const hostOrphan = await seed({
      status: "RUNNING",
      createdAt: oldDate,
      promptId: "pid-h",
      claimedBy: "host",
    });
    const inlineOrphan = await seed({
      status: "RUNNING",
      createdAt: oldDate,
      promptId: "pid-i",
      claimedBy: "inline",
    });
    const nullOrphan = await seed({
      status: "RUNNING",
      createdAt: oldDate,
      promptId: "pid-n",
    });
    expect(
      (await impl.listStaleRunning(cutoff, 10, "host")).map((r) => r.id),
    ).toEqual([hostOrphan]);
    expect(
      (await impl.listStaleRunning(cutoff, 10, "inline"))
        .map((r) => r.id)
        .sort(),
    ).toEqual([inlineOrphan, nullOrphan].sort());
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

  it("领取把 claimedAt 写成当前时刻，且**不复用**上一轮的时刻（4-B2）", async () => {
    const staleAt = new Date(Date.now() - 60_000);
    const id = await seed({ claimedBy: "host", claimedAt: staleAt });

    expect(await hostImpl.claimNextQueued("host", 1)).toEqual([id]);

    const stamped = claimedMs(id);
    expect(stamped).not.toBeNull();
    /* 与 `updateProgress` / `markRunning` 那两处的 COALESCE 相反，这里是无条件覆写：
     * 一次领取就是新一轮执行的起点，崩溃后重领的行不该带着上一轮的耗时基准。 */
    expect(stamped).toBeGreaterThan(staleAt.getTime());
    expect(Math.abs((stamped ?? 0) - Date.now())).toBeLessThan(5_000);
  });
});

describe("findExecJob（Phase 3-B1：host 重建 Job 的行读）", () => {
  it("返回 workflowName / execPayload / params 三列（不回查模板）", async () => {
    const id = await seed({
      claimedBy: "host",
      execPayload: { nodes: [{ id: "1", type: "KSampler" }] },
      params: { workflowInputs: [{ nodeId: "1", name: "text", value: "x" }] },
    });
    // findExecJob 是 host 领取后重建 Job 的读，所以走 host 那片（带归属条件后，
    // 用 inline 实例读会正确地被挡成 null，见下方 §14 D4 那一组）。
    const job = await hostImpl.findExecJob(id);
    expect(job?.workflowName).toBe("w");
    expect(job?.execPayload).toEqual({
      nodes: [{ id: "1", type: "KSampler" }] as unknown[],
    });
    expect(job?.params).toMatchObject({
      workflowInputs: [{ nodeId: "1", name: "text", value: "x" }],
    });
  });

  it("未知 id 返回 null；execPayload 缺省行为该列回 null（调用方判失败用）", async () => {
    expect(await impl.findExecJob("nope")).toBeNull();
    const bare = await seed({});
    expect((await impl.findExecJob(bare))?.execPayload ?? null).toBeNull();
  });
});

/**
 * 收口写入的两条守卫（P3 §5 ADR §14 D4）：终态不再被改写 + 只动自己那一片。
 *
 * 钉住两个真实事故面：① host 把用户取消的行 SIGKILL 之后，被杀进程的退出收口
 * 会走到 `finalizeFailure`，而它曾是**无条件 UPDATE**——把 `CANCELLED` 改写回
 * `FAILED`（用户体感「点了取消却显示失败」）；② 两个宿主并存时，任何一侧按 id
 * 裸写都可能落到对侧名下的行。
 */
describe("收口写入的终态守卫与归属守卫（Phase 4-A1 / ADR §14 D4）", () => {
  it("取消之后迟到的失败收口落不进去（CANCELLED 不再被覆盖成 FAILED）", async () => {
    const id = await seed({
      status: "RUNNING",
      claimedBy: "inline",
      promptId: "p-1",
    });
    expect(await impl.cancel(id)).toBe("written");
    expect(
      await impl.finalizeFailure(id, "comfy-cli 异常退出（code=null）"),
    ).toBe("skipped-terminal");
    expect(readRow(id)).toMatchObject({ status: "CANCELLED" });
  });

  it("对已经结束的任务点取消不翻状态（SUCCEEDED 保持 SUCCEEDED）", async () => {
    const id = await seed({ status: "SUCCEEDED", claimedBy: "inline" });
    expect(await impl.cancel(id)).toBe("skipped-terminal");
    expect(readRow(id)?.status).toBe("SUCCEEDED");
  });

  it("成功收口之后失败收口落不进去，且返回值说清是谁赢了", async () => {
    const id = await seed({ status: "RUNNING", claimedBy: "inline" });
    expect(
      await impl.finalizeSuccess(id, { resultImages: [], params: {} }),
    ).toBe("written");
    expect(await impl.finalizeFailure(id, "后到的原因")).toBe(
      "skipped-terminal",
    );
    expect(readRow(id)?.status).toBe("SUCCEEDED");
  });

  it("inline 实例改不动 host 名下的行，原因回 skipped-not-owned", async () => {
    const id = await seed({
      status: "RUNNING",
      claimedBy: "host",
      promptId: "p-2",
    });
    expect(
      await impl.finalizeSuccess(id, { resultImages: [], params: {} }),
    ).toBe("skipped-not-owned");
    expect(await impl.updateProgress(id, 55)).toBe(false);
    expect(await impl.markRunning(id, "p-3")).toBe(false);
    expect(readRow(id)).toMatchObject({ status: "RUNNING", claimedBy: "host" });
  });

  it("host 实例对自己那片照常落库", async () => {
    const id = await seed({ status: "RUNNING", claimedBy: "host" });
    expect(await hostImpl.finalizeFailure(id, "真的失败")).toBe("written");
    expect(readRow(id)?.status).toBe("FAILED");
  });

  it("cancel 是唯一免归属的写：Next 侧实例能取消 host 名下的行", async () => {
    const id = await seed({
      status: "RUNNING",
      claimedBy: "host",
      promptId: "p-4",
    });
    expect(await impl.cancel(id)).toBe("written");
    expect(readRow(id)?.status).toBe("CANCELLED");
  });

  it("replaceLogs 带归属守卫、不带终态守卫（收口后的尾随日志不许被抹掉）", async () => {
    const hostRow = await seed({ status: "RUNNING", claimedBy: "host" });
    await impl.replaceLogs(hostRow, [{ level: "info", message: "越片写入" }]);
    expect(readRow(hostRow)?.logs).not.toEqual([
      { level: "info", message: "越片写入" },
    ]);
    await hostImpl.replaceLogs(hostRow, [{ level: "info", message: "归我" }]);
    expect(readRow(hostRow)?.logs).toEqual([
      { level: "info", message: "归我" },
    ]);

    const done = await seed({ status: "SUCCEEDED", claimedBy: "inline" });
    await impl.replaceLogs(done, [
      { level: "info", message: "收口之后的尾行" },
    ]);
    expect(readRow(done)?.logs).toEqual([
      { level: "info", message: "收口之后的尾行" },
    ]);
  });

  it("findExecJob 跨片读不到（要交给 ComfyUI 的图不许读成别人的）", async () => {
    const id = await seed({
      claimedBy: "host",
      execPayload: { prompt: "host 的图" },
    });
    expect(await impl.findExecJob(id)).toBeNull();
    expect(await hostImpl.findExecJob(id)).toMatchObject({
      execPayload: { prompt: "host 的图" },
    });
  });

  it("reaper 的 repo 实例与 configureReaper 的 owner 不同源时收口被挡下", async () => {
    // 两处的 owner 必须同源（host 脚本里就是同一个 hostRepo 实例）；不同源时
    // 表现是「判了却没落库」，守卫返回的原因就是排障的唯一线索。
    const id = await seed({ status: "RUNNING", claimedBy: "host" });
    expect(await impl.finalizeFromReaper(id, "FAILED", "对账判失败")).toBe(
      "skipped-not-owned",
    );
    expect(readRow(id)?.status).toBe("RUNNING");
  });

  it("行不存在时回 skipped-missing（与「已被别处收口」区分开）", async () => {
    expect(await impl.finalizeFailure("no-such-task", "x")).toBe(
      "skipped-missing",
    );
    expect(await impl.cancel("no-such-task")).toBe("skipped-missing");
  });
});

/** `replaceRawCli` / `findRawCli`（P3 §5 ADR §14 D1 的 4-B2）。
 *
 *  钉的是「查看完整输出」这个排障入口的**跨宿主可见性**：原文由执行侧在收口时
 *  整包写一次，读侧不再碰执行进程的内存——host 执行的任务此前点进去永远是空态。
 *  守卫形态与 `replaceLogs` 同族（只带归属、不带终态），尾随输出不该被挡掉。 */
describe("replaceRawCli / findRawCli", () => {
  it("整包重写，且**终态行也写**（只带归属守卫）", async () => {
    const id = await seed({ status: "SUCCEEDED" });
    await impl.replaceRawCli(id, ["a", "b"]);
    expect(await impl.findRawCli(id)).toEqual(["a", "b"]);
    // 再写一次是整包替换，不是追加（与 replaceLogs 同形）
    await impl.replaceRawCli(id, ["c"]);
    expect(await impl.findRawCli(id)).toEqual(["c"]);
  });

  it("写不进别人那一片（归属守卫），但读是跨归属的", async () => {
    const id = await seed({ claimedBy: "host" });
    await impl.replaceRawCli(id, ["x"]);
    expect(await hostImpl.findRawCli(id)).toBeNull();
    // 正主写一次……
    await hostImpl.replaceRawCli(id, ["h"]);
    // ……inline 作为**读侧**照样看得见（这一列是给用户的排障入口，不是执行状态）
    expect(await impl.findRawCli(id)).toEqual(["h"]);
  });

  it("没写过的行与不存在的行都回 null；写入空数组回空数组", async () => {
    const id = await seed({});
    expect(await impl.findRawCli(id)).toBeNull();
    expect(await impl.findRawCli("no-such-task")).toBeNull();
    await impl.replaceRawCli(id, []);
    expect(await impl.findRawCli(id)).toEqual([]);
  });
});
