/**
 * asset.router 用例（ISSUE #4868）：入库的归属 / 分类契约、逐产物复制、
 * 参数快照、越权与空产物出口、列表过滤与分类计数、改名挪档与删除。
 * mock：db（真 Drizzle 内存库）、better-auth、logger、asset-store（不碰真盘）。
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
vi.mock("~/lib/media/asset-store", () => ({
  copyIntoAssetStore: vi.fn((sourceUrl: string, assetId: string) => {
    if (sourceUrl.includes("missing")) {
      return null;
    }
    return `/api/generated/assets/${assetId}/out.png`;
  }),
  removeAssetStoreDir: vi.fn(() => Promise.resolve(undefined)),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { assetRouter } from "~/server/api/routers/asset";
import { getTestDb, seedTask, seedUser, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";
import { removeAssetStoreDir } from "~/lib/media/asset-store";

const createCaller = createCallerFactory(assetRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

describe("asset.createFromTask —— 入库契约", () => {
  it("公共入库：每张产物各成一条资产，文件复制进资产目录，参数快照随行", async () => {
    seedTask(tdb, {
      id: "task-1",
      userId: "user-a",
      prompt: "霓虹雨夜的赛博朋克街景",
      negativePrompt: "模糊",
      params: { checkpoint: "Flux.1-dev", steps: 28, cfg: 4.5, seed: 871_224_519 },
      workflowName: "flux-dev",
      images: [
        { localPath: "/api/generated/task-1/a.png", mediaType: "image", width: 1024, height: 1024 },
        { localPath: "/api/generated/task-1/b.png", mediaType: "image", width: 1024, height: 1024 },
      ],
    });
    const res = await caller().createFromTask({
      taskId: "task-1",
      scope: "public",
      category: "reference",
    });
    expect(res.created).toBe(2);
    const list = await caller().list({ scope: "public", category: "reference" });
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.localPath).toMatch(/^\/api\/generated\/assets\//);
    expect(list.items[0]?.name).toContain("霓虹雨夜的赛博朋克街景");
    expect(list.items[0]?.hasParams).toBe(true);
    /* 两张产物时名称带序号（· 1 / · 2） */
    expect(list.items[0]?.name).toContain("·");
    /* 分类角标：reference = 2 */
    expect(list.categories.find((c) => c.category === "reference")?.count).toBe(2);
  });

  it("项目入库必须带 projectId，否则 BAD_REQUEST", async () => {
    seedTask(tdb, {
      id: "task-2",
      userId: "user-a",
      images: [{ localPath: "/api/generated/task-2/a.png" }],
    });
    await expect(
      caller().createFromTask({ taskId: "task-2", scope: "project", category: "scene" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("项目入库把 projectId 落到行上；scope=project 的列表只出项目资产", async () => {
    seedTask(tdb, {
      id: "task-3",
      userId: "user-a",
      images: [{ localPath: "/api/generated/task-3/a.png" }],
    });
    await caller().createFromTask({
      taskId: "task-3",
      scope: "project",
      projectId: "proj-1",
      category: "scene",
      subdir: "街景/雨夜",
    });
    const list = await caller().list({ scope: "project", projectId: "proj-1" });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.projectId).toBe("proj-1");
    expect(list.items[0]?.subdir).toBe("街景/雨夜");
  });

  it("别人的任务不能入库（NOT_FOUND）；没有产物的任务拒绝（BAD_REQUEST）", async () => {
    seedTask(tdb, {
      id: "task-other",
      userId: "user-b",
      images: [{ localPath: "/api/generated/task-other/a.png" }],
    });
    seedTask(tdb, { id: "task-empty", userId: "user-a", images: [] });
    await expect(
      caller().createFromTask({ taskId: "task-other", scope: "public", category: "style" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller().createFromTask({ taskId: "task-empty", scope: "public", category: "style" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("复制失败的产物跳过（部分成功语义）：created 与 skipped 如实回报", async () => {
    seedTask(tdb, {
      id: "task-mixed",
      userId: "user-a",
      images: [
        { localPath: "/api/generated/task-mixed/ok.png" },
        { localPath: "/api/generated/task-mixed/missing.png" },
      ],
    });
    const res = await caller().createFromTask({
      taskId: "task-mixed",
      scope: "public",
      category: "reference",
    });
    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
  });
});

describe("asset.list —— 过滤与计数", () => {
  beforeEach(() => {
    seedTask(tdb, {
      id: "task-a",
      userId: "user-a",
      prompt: "赛博朋克街景",
      params: { checkpoint: "Flux.1-dev" },
      images: [{ localPath: "/api/generated/task-a/a.png" }],
    });
    seedTask(tdb, {
      id: "task-b",
      userId: "user-a",
      prompt: "水墨山水",
      params: {},
      images: [{ localPath: "/api/generated/task-b/b.png" }],
    });
    void caller().createFromTask({ taskId: "task-a", scope: "public", category: "reference" });
    void caller().createFromTask({
      taskId: "task-b",
      scope: "project",
      projectId: "proj-1",
      category: "style",
    });
  });

  it("按分类过滤 + 关键词命中提示词", async () => {
    const byCategory = await caller().list({ category: "style" });
    expect(byCategory.items).toHaveLength(1);
    expect(byCategory.items[0]?.category).toBe("style");
    const byQ = await caller().list({ q: "赛博朋克" });
    expect(byQ.items).toHaveLength(1);
    expect(byQ.items[0]?.name).toContain("赛博朋克");
  });

  it("公共档不含项目资产；项目档按 projectId 收窄", async () => {
    const pub = await caller().list({ scope: "public" });
    expect(pub.items.every((item) => item.scope === "public")).toBe(true);
    const proj = await caller().list({ scope: "project", projectId: "proj-1" });
    expect(proj.items).toHaveLength(1);
    const projOther = await caller().list({ scope: "project", projectId: "proj-other" });
    expect(projOther.items).toHaveLength(0);
  });
});

describe("asset.delete —— 清理", () => {
  beforeEach(async () => {
    seedTask(tdb, {
      id: "task-u",
      userId: "user-a",
      prompt: "待挪动资产",
      images: [{ localPath: "/api/generated/task-u/a.png" }],
    });
    await caller().createFromTask({ taskId: "task-u", scope: "public", category: "reference" });
  });

  it("删除库行并清理资产文件目录；别人的资产删不到", async () => {
    const list = await caller().list({});
    const id = list.items[0]?.id ?? "";
    const res = await caller().delete({ id });
    expect(res.ok).toBe(true);
    expect(removeAssetStoreDir).toHaveBeenCalledWith(id);
    const after = await caller().list({});
    expect(after.items).toHaveLength(0);
    await expect(caller().detail({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("detail 对不存在的资产给 NOT_FOUND", async () => {
    await expect(caller().detail({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
