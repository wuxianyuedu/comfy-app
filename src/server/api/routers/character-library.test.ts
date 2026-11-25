/**
 * characterLibrary 路由用例（ISSUE #5009）：预置幂等入库、标签 AND 过滤与分面、
 * 手工增改删（标签随描述重提、撞名 409）、批量生图入队（只取待生成 / 失败档，
 * 已就绪角色仅显式点名时重跑）与生成对账回写（成功入候选、失败落 failed）。
 * mock：db（真 Drizzle 内存库）、better-auth、logger、character-store（不碰真盘）、
 * workflow-run.server（不读契约 / 尺寸表磁盘）、执行器派发。
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
vi.mock("~/lib/character/character-store", async () => {
  /* readArtifactBytes 返回一张 8×8 纯色 PNG（确定性低分样张）：打分规则本身
   * 在 quality-check 的单测里覆盖，这里只验路由的接线与落库。 */
  const { deflateSync } = await import("node:zlib");
  const size = 8;
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size);
  ihdrView.setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(new Uint8Array((size * 3 + 1) * size));
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    new Uint8Array([0, 0, 0, 13, 73, 72, 68, 82, ...ihdr, 0, 0, 0, 0]),
    new Uint8Array([
      (idat.length >>> 24) & 0xff,
      (idat.length >>> 16) & 0xff,
      (idat.length >>> 8) & 0xff,
      idat.length & 0xff,
      73,
      68,
      65,
      84,
      ...idat,
      0,
      0,
      0,
      0,
    ]),
    new Uint8Array([0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0]),
  ];
  const flatPng = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    flatPng.set(part, offset);
    offset += part.length;
  }
  return {
    copyIntoCharacterStore: vi.fn((_sourceUrl: string, characterId: string) => {
      return Promise.resolve(`/api/generated/character-library/${characterId}/out.png`);
    }),
    removeCharacterStoreDir: vi.fn(() => Promise.resolve(undefined)),
    readArtifactBytes: vi.fn(() => Promise.resolve(flatPng)),
  };
});
vi.mock("~/lib/workshop/workflow-run.server", () => ({
  prepareWorkflowRun: vi.fn((_userId: string, workflowId: string) => {
    if (workflowId !== "wf-1") {
      return null;
    }
    return {
      contractIds: [],
      io: {},
      mode: null,
      sizeTable: {},
      tpl: {
        id: "wf-1",
        name: "minimax_h3_image",
        taskType: "TXT2IMG",
        modes: "[]",
        defaultMode: null,
        paramMap: null,
        workflowIO: null,
        rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
        hasRaw: true,
        positions: null,
        sourcePath: null,
        sourceChecksum: null,
        sourceMtime: null,
        createdAt: new Date(),
        userId: "user-a",
      },
    };
  }),
  buildWorkflowRunParams: vi.fn(
    (ctx: { tpl: { id: string } }, values: { negativePrompt?: string; prompt?: string }) => ({
      ...(values.negativePrompt === undefined ? {} : { negative: values.negativePrompt }),
      prompt: values.prompt ?? "",
      workflow: ctx.tpl.id,
      workflowInputs: [],
    }),
  ),
}));
vi.mock("~/lib/comfyui/executor-continuation", () => ({
  kickQueue: vi.fn(),
}));
vi.mock("~/lib/comfyui/executor-mode", () => ({
  resolveExecutorClaim: vi.fn(() => "inline" as const),
}));

import { eq } from "drizzle-orm";

import { createCallerFactory } from "~/server/api/trpc";
import { characterLibraryRouter } from "~/server/api/routers/character-library";
import { removeCharacterStoreDir } from "~/lib/character/character-store";
import { db } from "~/server/db";
import { characterProfile, task } from "~/server/db/schema";
import { getTestDb, seedTask, seedUser, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx, makeUser } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(characterLibraryRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

/** 造一个「已入队生图」的角色 + 对应任务行（status 可指定终态）。 */
async function seedGeneratingCharacter(taskId: string, status = "QUEUED"): Promise<string> {
  const created = await caller().create({
    name: `对账角色 ${taskId}`,
    description: "银白色的长发，猫耳。",
  });
  await caller().enqueueGeneration({ workflowId: "wf-1", ids: [created.id] });
  await tdb.update(characterProfile).set({ taskId }).where(eq(characterProfile.id, created.id));
  seedTask(tdb, {
    id: taskId,
    userId: "user-a",
    status,
    images: status === "SUCCEEDED" ? [{ localPath: "/api/generated/x/out.png" }] : [],
  });
  return created.id;
}

describe("characterLibrary.seed —— 预置入库", () => {
  it("按数量产出角色，标签随描述提取，状态都是 draft", async () => {
    const res = await caller().seed({ count: 120, seed: 7 });
    expect(res.created).toBe(120);
    const list = await caller().list({ status: "all" });
    expect(list.items).toHaveLength(120);
    expect(list.statusCounts.draft).toBe(120);
    for (const item of list.items) {
      expect(item.tags.length).toBeGreaterThanOrEqual(3);
      expect(item.source).toBe("seed");
      expect(item.status).toBe("draft");
    }
    /* 标签分面有内容（每个标签带命中数，降序） */
    expect(list.tagFacets.length).toBeGreaterThan(0);
    for (const facet of list.tagFacets) {
      expect(facet.count).toBeGreaterThanOrEqual(1);
    }
  });

  it("同种子重跑幂等：撞名跳过，不翻倍", async () => {
    await caller().seed({ count: 100, seed: 7 });
    const second = await caller().seed({ count: 100, seed: 7 });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(100);
    const list = await caller().list({ status: "all" });
    expect(list.items).toHaveLength(100);
  });

  it("角色库按用户隔离：user-b 看不见 user-a 的角色", async () => {
    await caller().seed({ count: 10, seed: 7 });
    const other = createCaller(makeCtx({ user: makeUser({ id: "user-b", email: "b@test.dev" }) }));
    const list = await other.list({ status: "all" });
    expect(list.items).toHaveLength(0);
  });
});

describe("characterLibrary.list —— 检索", () => {
  beforeEach(async () => {
    await caller().create({
      name: "银发猫娘",
      archetype: "魔法少女",
      gender: "女",
      description: "银白色的长发梳成双马尾，金色的瞳孔，头顶猫耳，性格傲娇，穿水手服。",
    });
    await caller().create({
      name: "金发剑士",
      archetype: "剑士",
      gender: "女",
      description: "金色的长发，祖母绿般的眼瞳，头顶狐耳，性格高冷，穿铠甲。",
    });
  });

  it("关键词命中名字 / 描述", async () => {
    const byName = await caller().list({ q: "银发猫娘" });
    expect(byName.items).toHaveLength(1);
    const byDesc = await caller().list({ q: "狐耳" });
    expect(byDesc.items.map((item) => item.name)).toEqual(["金发剑士"]);
  });

  it("标签 AND 过滤：多标签取交集", async () => {
    const catOnly = await caller().list({ tags: ["猫耳"] });
    expect(catOnly.items.map((item) => item.name)).toEqual(["银发猫娘"]);
    const catAndSilver = await caller().list({ tags: ["猫耳", "银发"] });
    expect(catAndSilver.items).toHaveLength(1);
    const foxAndSilver = await caller().list({ tags: ["狐耳", "银发"] });
    expect(foxAndSilver.items).toHaveLength(0);
  });

  it("标签分面按当前过滤条件计数", async () => {
    const facets = await caller().list({ tags: ["猫耳"] });
    const catCount = facets.tagFacets.find((facet) => facet.tag === "猫耳")?.count;
    expect(catCount).toBe(1);
    const all = await caller().list({});
    expect(all.tagFacets.find((facet) => facet.tag === "猫耳")?.count).toBe(1);
    expect(all.tagFacets.find((facet) => facet.tag === "狐耳")?.count).toBe(1);
  });

  it("状态过滤：只有被点名的状态出列", async () => {
    const list = await caller().list({ status: "all" });
    const id = list.items[0]?.id ?? "";
    /* 造一个 ready：直接把行改状态（生图回写在 syncGeneration 用例里覆盖）。 */
    await tdb.update(characterProfile).set({ status: "ready" }).where(eq(characterProfile.id, id));
    const ready = await caller().list({ status: "ready" });
    expect(ready.items.map((item) => item.id)).toEqual([id]);
    const draft = await caller().list({ status: "draft" });
    expect(draft.items.map((item) => item.id)).not.toContain(id);
  });
});

describe("characterLibrary.create / update / delete —— 手工档案", () => {
  it("创建时从描述提取标签；撞名 409", async () => {
    const created = await caller().create({
      name: "测试角色",
      archetype: "巫女",
      description: "黑色的长直发，红色的眼瞳，穿巫女服，性格三无。",
    });
    expect(created.tags).toContain("黑发");
    expect(created.tags).toContain("巫女服");
    expect(created.tags).toContain("三无");

    await expect(
      caller().create({ name: "测试角色", description: "另一个人。" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("更新描述后标签重提；更新名字撞名 409", async () => {
    const created = await caller().create({
      name: "旧描述角色",
      description: "银白色的长发。",
    });
    const updated = await caller().update({
      id: created.id,
      description: "火红色的短发，性格元气。",
    });
    expect(updated.tags).toContain("红发");
    expect(updated.tags).toContain("短发");
    expect(updated.tags).not.toContain("银发");

    await caller().create({ name: "另一个名字", description: "黑发。" });
    await expect(caller().update({ id: created.id, name: "另一个名字" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("删除：库行消失，立绘目录一并清理", async () => {
    const created = await caller().create({ name: "待删除角色", description: "黑发。" });
    const removed = await caller().delete({ id: created.id });
    expect(removed.ok).toBe(true);
    const list = await caller().list({});
    expect(list.items).toHaveLength(0);
    expect(removeCharacterStoreDir).toHaveBeenCalledWith(created.id);
  });
});

describe("characterLibrary.enqueueGeneration —— 批量生图入队", () => {
  it("工作流不存在 → NOT_FOUND；无可执行内容 → PRECONDITION_FAILED", async () => {
    await expect(caller().enqueueGeneration({ workflowId: "wf-missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("只对 draft / failed 角色入队；任务行与角色状态同步落库", async () => {
    await caller().seed({ count: 5, seed: 7 });
    const res = await caller().enqueueGeneration({ workflowId: "wf-1", limit: 50 });
    expect(res.enqueued).toBe(5);
    expect(res.workflowName).toBe("minimax_h3_image");

    const tasks = await db.select().from(task);
    expect(tasks).toHaveLength(5);
    for (const row of tasks) {
      expect(row.status).toBe("QUEUED");
      expect(row.workflowName).toBe("minimax_h3_image");
      expect(row.prompt).toContain("单人角色立绘");
    }
    const list = await caller().list({ status: "generating" });
    expect(list.items).toHaveLength(5);

    /* 再入队：没有新的 draft / failed，入队数为 0。 */
    const again = await caller().enqueueGeneration({ workflowId: "wf-1" });
    expect(again.enqueued).toBe(0);
  });

  it("limit 收口本批数量；显式点名 ids 可对已就绪角色重跑（新候选）", async () => {
    await caller().seed({ count: 30, seed: 7 });
    const first = await caller().enqueueGeneration({ workflowId: "wf-1", limit: 10 });
    expect(first.enqueued).toBe(10);

    /* 把第一批标记为 ready（模拟已生成完），显式点名其中一个重跑。 */
    const generating = await caller().list({ status: "generating" });
    const target = generating.items[0];
    expect(target).toBeDefined();
    await tdb
      .update(characterProfile)
      .set({ status: "ready" })
      .where(eq(characterProfile.id, target?.id ?? ""));
    const rerun = await caller().enqueueGeneration({
      workflowId: "wf-1",
      ids: [target?.id ?? ""],
    });
    expect(rerun.enqueued).toBe(1);
  });
});

describe("characterLibrary.syncGeneration —— 生成对账回写", () => {
  it("任务成功：产物复制进角色目录，立绘入候选，状态 ready", async () => {
    const id = await seedGeneratingCharacter("task-ok", "SUCCEEDED");
    const res = await caller().syncGeneration();
    expect(res.ready).toBe(1);
    const detail = await caller().detail({ id });
    expect(detail.status).toBe("ready");
    expect(detail.portraitUrl).toContain("/api/generated/character-library/");
    expect(detail.portraits).toHaveLength(1);
  });

  it("任务失败：状态落 failed；任务还在排队：保持 generating", async () => {
    const failedId = await seedGeneratingCharacter("task-fail", "FAILED");
    const queuedId = await seedGeneratingCharacter("task-queued", "QUEUED");
    const res = await caller().syncGeneration();
    expect(res.failed).toBe(1);
    expect(res.pending).toBe(1);
    const failed = await caller().detail({ id: failedId });
    expect(failed.status).toBe("failed");
    const queued = await caller().detail({ id: queuedId });
    expect(queued.status).toBe("generating");
  });
});

describe("characterLibrary.scoreQuality / scoreAllQuality / regenerateFlagged —— 质量打分", () => {
  it("单张打分：读立绘文件，分数与问题落库，低分判为需要重新生成", async () => {
    const id = await seedGeneratingCharacter("task-score", "SUCCEEDED");
    await caller().syncGeneration();
    const res = await caller().scoreQuality({ id });
    expect(res.score).toBeLessThan(60);
    expect(res.needsRegeneration).toBe(true);
    expect(res.issues.length).toBeGreaterThan(0);
    const detail = await caller().detail({ id });
    expect(detail.qualityScore).toBe(res.score);
    expect(detail.qualityIssues).toEqual(res.issues);
  });

  it("未生成 / 无立绘的角色打分 → BAD_REQUEST；不存在的角色 → NOT_FOUND", async () => {
    const created = await caller().create({ name: "无立绘角色", description: "黑发。" });
    await expect(caller().scoreQuality({ id: created.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller().scoreQuality({ id: "missing-id" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("批量打分：依次给每张就绪立绘打分，低分的进 flagged 清单", async () => {
    await seedGeneratingCharacter("task-score-a", "SUCCEEDED");
    await seedGeneratingCharacter("task-score-b", "SUCCEEDED");
    await caller().syncGeneration();
    const res = await caller().scoreAllQuality();
    expect(res.scored).toBe(2);
    expect(res.flagged).toHaveLength(2);
    expect(res.threshold).toBe(60);
    for (const item of res.flagged) {
      expect(item.score).toBeLessThan(60);
      expect(item.issues.length).toBeGreaterThan(0);
    }
  });

  it("regenerateFlagged：低分角色退回待生成并按原链重新入队", async () => {
    const id = await seedGeneratingCharacter("task-regen", "SUCCEEDED");
    await caller().syncGeneration();
    await caller().scoreAllQuality();
    const before = await caller().detail({ id });
    expect(before.status).toBe("ready");
    const res = await caller().regenerateFlagged({ workflowId: "wf-1" });
    expect(res.regenerated).toBe(1);
    const after = await caller().detail({ id });
    expect(after.status).toBe("generating");
    /* 旧立绘保留为候选，不先删。 */
    expect(after.portraits.length).toBe(1);
    /* 新任务已入队（QUEUED）。 */
    const tasks = await db.select().from(task);
    expect(tasks.some((row) => row.status === "QUEUED")).toBe(true);
  });
});
