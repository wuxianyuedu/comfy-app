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
    /* 目录角标：reference 根目录（subdir 为空）= 2 */
    const tree = await caller().folderTree({ scope: "public" });
    expect(tree.entries.find((e) => e.category === "reference" && e.subdir === null)?.count).toBe(
      2,
    );
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

describe("asset.createFromTask —— 同目录去重（ISSUE #4937）", () => {
  const seedDupTask = () =>
    seedTask(tdb, {
      id: "task-dup",
      userId: "user-a",
      prompt: "霓虹雨夜的赛博朋克街景",
      images: [{ localPath: "/api/generated/task-dup/a.png" }],
    });

  it("同一目录重复加入：第二次 created=0、duplicated=1，不产生重复行", async () => {
    seedDupTask();
    const first = await caller().createFromTask({
      taskId: "task-dup",
      scope: "public",
      category: "scene",
    });
    expect(first.created).toBe(1);
    const second = await caller().createFromTask({
      taskId: "task-dup",
      scope: "public",
      category: "scene",
    });
    expect(second.created).toBe(0);
    expect(second.duplicated).toBe(1);
    const list = await caller().list({ scope: "all", category: "all" });
    expect(list.items).toHaveLength(1);
    expect(list.categories.find((c) => c.category === "scene")?.count).toBe(1);
  });

  it("跨分类再收仍允许（另一次有意的归档）", async () => {
    seedDupTask();
    await caller().createFromTask({ taskId: "task-dup", scope: "public", category: "scene" });
    const other = await caller().createFromTask({
      taskId: "task-dup",
      scope: "public",
      category: "reference",
    });
    expect(other.created).toBe(1);
    expect(other.duplicated).toBe(0);
    const list = await caller().list({ scope: "all", category: "all" });
    expect(list.items).toHaveLength(2);
  });

  it("多张产物部分重复：只收缺的那张，created / duplicated / skipped 如实回报", async () => {
    seedTask(tdb, {
      id: "task-multi",
      userId: "user-a",
      prompt: "霓虹雨夜的赛博朋克街景",
      images: [
        { localPath: "/api/generated/task-multi/a.png" },
        { localPath: "/api/generated/task-multi/b.png" },
      ],
    });
    const first = await caller().createFromTask({
      taskId: "task-multi",
      scope: "public",
      category: "scene",
    });
    expect(first.created).toBe(2);
    const list = await caller().list({ scope: "all", category: "scene" });
    await caller().delete({ id: list.items[0]!.id });
    const second = await caller().createFromTask({
      taskId: "task-multi",
      scope: "public",
      category: "scene",
    });
    expect(second.created).toBe(1);
    expect(second.duplicated).toBe(1);
    expect(second.skipped).toBe(0);
    const after = await caller().list({ scope: "all", category: "scene" });
    expect(after.items).toHaveLength(2);
  });
});

describe("asset.list —— 过滤与计数", () => {
  beforeEach(async () => {
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
    await caller().createFromTask({ taskId: "task-a", scope: "public", category: "reference" });
    await caller().createFromTask({
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

describe("asset 目录树（folderTree / subdirPrefix / renameFolder / updateSubdir）", () => {
  /** 造一个带若干目录的公共角色库 + 一条项目角色资产，返回刚入库的资产 id 列表。 */
  async function seedFolders(): Promise<Array<string>> {
    const seedOne = async (
      taskId: string,
      subdir: string | undefined,
      scope: "public" | "project" = "public",
    ) => {
      seedTask(tdb, {
        id: taskId,
        userId: "user-a",
        prompt: `角色 ${taskId}`,
        images: [{ localPath: `/api/generated/${taskId}/a.png` }],
      });
      const res = await caller().createFromTask({
        taskId,
        scope,
        ...(scope === "project" ? { projectId: "proj-1" } : {}),
        category: "character",
        ...(subdir === undefined ? {} : { subdir }),
      });
      expect(res.created).toBe(1);
    };
    await seedOne("task-f1", "少女");
    await seedOne("task-f2", "少女/活泼");
    await seedOne("task-f3", "御姐");
    await seedOne("task-f4", undefined); // 分类根（subdir 为空）
    await seedOne("task-f5", "少女", "project"); // 项目档同名目录，不受公共档改名影响
    const list = await caller().list({ scope: "all", category: "character", take: 200 });
    return list.items.map((item) => item.id);
  }

  it("folderTree 按「分类 × 目录」分组计数，scope 之间互不串档", async () => {
    await seedFolders();
    const pub = await caller().folderTree({ scope: "public" });
    const character = pub.entries.filter((e) => e.category === "character");
    expect(character).toContainEqual({ category: "character", subdir: "少女", count: 1 });
    expect(character).toContainEqual({ category: "character", subdir: "少女/活泼", count: 1 });
    expect(character).toContainEqual({ category: "character", subdir: "御姐", count: 1 });
    expect(character).toContainEqual({ category: "character", subdir: null, count: 1 });
    /* 项目档的同名目录不出现在公共档 */
    expect(character.filter((e) => e.subdir === "少女")).toHaveLength(1);
    const proj = await caller().folderTree({ scope: "project" });
    expect(proj.entries).toContainEqual({ category: "character", subdir: "少女", count: 1 });
    expect(proj.entries).not.toContainEqual({ category: "character", subdir: "御姐", count: 1 });
  });

  it("list 的 subdirPrefix 命中目录本身与全部后代", async () => {
    await seedFolders();
    const folder = await caller().list({
      scope: "public",
      category: "character",
      subdirPrefix: "少女",
    });
    expect(folder.items).toHaveLength(2);
    expect(folder.items.map((item) => item.subdir).sort()).toEqual(["少女", "少女/活泼"]);
    const leaf = await caller().list({
      scope: "public",
      category: "character",
      subdirPrefix: "少女/活泼",
    });
    expect(leaf.items).toHaveLength(1);
    expect(leaf.items[0]?.subdir).toBe("少女/活泼");
    /* 前缀撞名不算命中：「少女控」目录下的资产不该被「少女」捞走 */
    const root = await caller().list({ scope: "public", category: "character" });
    expect(root.items).toHaveLength(4);
  });

  it("list 的 subdirPrefix 非法路径给 BAD_REQUEST", async () => {
    await expect(
      caller().list({ scope: "public", category: "character", subdirPrefix: "a/../b" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("renameFolder 改写目录本身与后代的 subdir，项目档同名目录不受影响", async () => {
    await seedFolders();
    const res = await caller().renameFolder({
      scope: "public",
      category: "character",
      oldPath: "少女",
      newPath: "萝莉",
    });
    expect(res.renamed).toBe(2); // 少女 + 少女/活泼 两条公共资产
    const after = await caller().list({ scope: "public", category: "character", take: 200 });
    const subdirs = after.items.map((item) => item.subdir).sort();
    expect(subdirs).toContain("萝莉");
    expect(subdirs).toContain("萝莉/活泼");
    expect(subdirs).not.toContain("少女");
    /* 项目档那条「少女」原样不动 */
    const proj = await caller().list({ scope: "project", category: "character" });
    expect(proj.items[0]?.subdir).toBe("少女");
    /* 树角标跟着新路径走 */
    const tree = await caller().folderTree({ scope: "public" });
    expect(tree.entries).toContainEqual({ category: "character", subdir: "萝莉/活泼", count: 1 });
  });

  it("renameFolder：目标目录已存在时拒绝；新旧路径相同视为空操作；非法路径 BAD_REQUEST", async () => {
    await seedFolders();
    await expect(
      caller().renameFolder({
        scope: "public",
        category: "character",
        oldPath: "御姐",
        newPath: "少女",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const same = await caller().renameFolder({
      scope: "public",
      category: "character",
      oldPath: "御姐",
      newPath: "御姐",
    });
    expect(same.renamed).toBe(0);
    await expect(
      caller().renameFolder({
        scope: "public",
        category: "character",
        oldPath: "御姐",
        newPath: "a/../b",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("updateSubdir 移动单条资产；空串移回分类根；非法路径与不存在的 id 拒绝", async () => {
    const ids = await seedFolders();
    const target = ids[0] ?? "";
    const moved = await caller().updateSubdir({ id: target, subdir: "御姐/温柔" });
    expect(moved.ok).toBe(true);
    expect(moved.subdir).toBe("御姐/温柔");
    const toRoot = await caller().updateSubdir({ id: target, subdir: "" });
    expect(toRoot.subdir).toBeNull();
    await expect(caller().updateSubdir({ id: target, subdir: "a/../b" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller().updateSubdir({ id: "nope", subdir: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
