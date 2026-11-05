/**
 * series.router 集成测试（FR-SR-01/02，#2477）：覆盖系列/季/集 CRUD + 项目挂载、跨用户 FORBIDDEN
 * （同 project.test.ts 口径）、trpc-surface-executors 执行者判据全通过；mock ~/server/db（内存库）、better-auth、logger。
 * 注意 `createCaller(seriesRouter)` 的 procedure 为顶层命名（`caller.create`…），挂 root 后才成 `series.create` 路径。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(() => null) } },
}));
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/comfyui/executor-continuation", () => ({
  kickQueue: vi.fn(),
}));
vi.mock("~/lib/comfyui/executor-mode", () => ({
  resolveExecutorClaim: vi.fn(() => "inline" as const),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { seriesRouter } from "./series";
import { seriesGenerationRouter } from "./series-generation";
import * as schema from "~/server/db/schema";
import {
  getTestDb,
  seedUser,
  seedProject,
  seedProduction,
} from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(seriesRouter);
const createGenCaller = createCallerFactory(seriesGenerationRouter);
const tdb = getTestDb();
const tdbDb = tdb as unknown as SqliteRemoteDatabase<typeof schema>;
const userCaller = () => createCaller(makeCtx());
const otherCaller = () =>
  createCaller(makeCtx({ user: { id: "user-b", email: "b@test.dev", name: null } }));
const genCaller = () => createGenCaller(makeCtx());

/** 断言非空的种子 helper（create 类 procedure 返回 `T | undefined`）。 */
async function addSeries(caller = userCaller(), title = "S") {
  const s = await caller.create({ title });
  if (!s) {
    throw new Error("seed series failed");
  }
  return s;
}
async function addSeason(seriesId: string, caller = userCaller()) {
  const se = await caller.createSeason({ seriesId });
  if (!se) {
    throw new Error("seed season failed");
  }
  return se;
}
async function addEpisode(seasonId: string, caller = userCaller()) {
  const ep = await caller.createEpisode({ seasonId });
  if (!ep) {
    throw new Error("seed ep failed");
  }
  return ep;
}

/** 造 系列→季→集 三级，返回各级（已断言非空）。 */
async function makeHierarchy(caller = userCaller()) {
  const s = await addSeries(caller, "S1");
  const se = await addSeason(s.id, caller);
  const ep = await addEpisode(se.id, caller);
  return { s, se, ep };
}

/** 造一个角色库实体（createCharacter 返回 `T | undefined`）。 */
async function addCharacter(seriesId: string, name = "角色", caller = userCaller()) {
  const ch = await caller.createCharacter({ seriesId, name });
  if (!ch) {
    throw new Error("seed character failed");
  }
  return ch;
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

describe("series.list / create", () => {
  it("新建后出现在自己的列表", async () => {
    await userCaller().create({ title: "我的系列" });
    const list = await userCaller().list();
    expect(list.map((x) => x.title)).toContain("我的系列");
  });
  it("空库返回空列表", async () => {
    expect(await userCaller().list()).toEqual([]);
  });
});

describe("series.update / delete", () => {
  it("改名生效", async () => {
    const s = await addSeries(userCaller(), "旧");
    const updated = await userCaller().update({ id: s.id, title: "新" });
    expect(updated?.title).toBe("新");
  });
  it("删除后列表不再含它", async () => {
    const s = await addSeries(userCaller(), "要删");
    await userCaller().delete({ id: s.id });
    const list = await userCaller().list();
    expect(list.find((x) => x.id === s.id)).toBeUndefined();
  });
  it("他人系列 → FORBIDDEN，且对方行不变", async () => {
    const s = await addSeries(otherCaller(), "别人的");
    await expect(userCaller().update({ id: s.id, title: "偷改" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(userCaller().delete({ id: s.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("season 列表 / 增改删", () => {
  it("createSeason 落在正确系列下", async () => {
    const s = await addSeries(userCaller(), "S");
    const se = await addSeason(s.id, userCaller());
    expect(se.seriesId).toBe(s.id);
    const list = await userCaller().seasons({ seriesId: s.id });
    expect(list.map((x) => x.id)).toContain(se.id);
  });
  it("updateSeason 改名、deleteSeason 删除", async () => {
    const s = await addSeries(userCaller(), "S");
    const se = await addSeason(s.id, userCaller());
    const updated = await userCaller().updateSeason({ id: se.id, title: "秋" });
    expect(updated?.title).toBe("秋");
    await userCaller().deleteSeason({ id: se.id });
    expect(await userCaller().seasons({ seriesId: s.id })).toEqual([]);
  });
  it("他人系列的季 → FORBIDDEN", async () => {
    const s = await addSeries(otherCaller(), "别人的");
    await expect(userCaller().createSeason({ seriesId: s.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("episode 列表 / 增改删", () => {
  it("createEpisode 落在正确季下，可列可改可删", async () => {
    const s = await addSeries(userCaller(), "S");
    const se = await addSeason(s.id, userCaller());
    const ep = await addEpisode(se.id, userCaller());
    expect(ep.seasonId).toBe(se.id);
    const list = await userCaller().episodes({ seasonId: se.id });
    expect(list.map((x) => x.id)).toContain(ep.id);
    const updated = await userCaller().updateEpisode({
      id: ep.id,
      title: "E-改",
      status: "producing",
    });
    expect(updated?.title).toBe("E-改");
    expect(updated?.status).toBe("producing");
    await userCaller().deleteEpisode({ id: ep.id });
    expect(await userCaller().episodes({ seasonId: se.id })).toEqual([]);
  });
  it("他人季下的集 → FORBIDDEN", async () => {
    const s = await addSeries(otherCaller(), "别人的");
    const se = await addSeason(s.id, otherCaller());
    await expect(userCaller().createEpisode({ seasonId: se.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("episode.byProject / assignProject（项目挂载）", () => {
  it("把项目挂到集后，byProject 能定位回来", async () => {
    seedProject(tdb, { id: "p1", userId: "user-a", name: "项目1" });
    const { se } = await makeHierarchy();
    const ep = await addEpisode(se.id, userCaller());
    await userCaller().assignProject({ episodeId: ep.id, projectId: "p1" });
    const found = await userCaller().byProject({ projectId: "p1" });
    expect(found?.id).toBe(ep.id);
  });
  it("未挂载的项目 → byProject 返回 null", async () => {
    seedProject(tdb, { id: "p2", userId: "user-a", name: "项目2" });
    expect(await userCaller().byProject({ projectId: "p2" })).toBeNull();
  });
  it("他人不可读我项目的归属（byProject 不越权泄漏）", async () => {
    seedProject(tdb, { id: "p3", userId: "user-a", name: "项目3" });
    const { se } = await makeHierarchy();
    const ep = await addEpisode(se.id, userCaller());
    await userCaller().assignProject({ episodeId: ep.id, projectId: "p3" });
    expect(await otherCaller().byProject({ projectId: "p3" })).toBeNull();
  });
  it("assignProject 改挂为 null 后 byProject 不再命中", async () => {
    seedProject(tdb, { id: "p4", userId: "user-a", name: "项目4" });
    const { se } = await makeHierarchy();
    const ep = await addEpisode(se.id, userCaller());
    await userCaller().assignProject({ episodeId: ep.id, projectId: "p4" });
    await userCaller().assignProject({ episodeId: ep.id, projectId: null });
    expect(await userCaller().byProject({ projectId: "p4" })).toBeNull();
  });
});

describe("character 列表 / 增改删（FR-SR-03）", () => {
  it("createCharacter 落在正确系列下", async () => {
    const { s } = await makeHierarchy();
    const ch = await addCharacter(s.id, "阿明");
    expect(ch.seriesId).toBe(s.id);
    const list = await userCaller().characters({ seriesId: s.id });
    expect(list.map((x) => x.id)).toContain(ch.id);
  });

  it("updateCharacter 改名、deleteCharacter 删除", async () => {
    const { s } = await makeHierarchy();
    const ch = await addCharacter(s.id, "旧名");
    const updated = await userCaller().updateCharacter({ id: ch.id, name: "新名" });
    expect(updated?.name).toBe("新名");
    await userCaller().deleteCharacter({ id: ch.id });
    expect(await userCaller().characters({ seriesId: s.id })).toEqual([]);
  });

  it("他人系列的 createCharacter → FORBIDDEN", async () => {
    const s = await addSeries(otherCaller(), "别人的系列");
    await expect(userCaller().createCharacter({ seriesId: s.id, name: "x" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });

  it("他人系列的 characters 查询 → FORBIDDEN", async () => {
    const s = await addSeries(otherCaller(), "别人的系列");
    await expect(userCaller().characters({ seriesId: s.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("episode ↔ character 关联", () => {
  it("link / unlink + episodeCharacters 列表（重复关联幂等）", async () => {
    const { s, ep } = await makeHierarchy();
    const ch1 = await addCharacter(s.id, "主角");
    await addCharacter(s.id, "配角");
    await userCaller().linkCharacter({ episodeId: ep.id, characterId: ch1.id });
    const linked = await userCaller().episodeCharacters({ episodeId: ep.id });
    expect(linked.map((l) => l.character.id)).toContain(ch1.id);
    expect(linked.find((l) => l.character.id === ch1.id)?.role).toBe("");
    await userCaller().linkCharacter({ episodeId: ep.id, characterId: ch1.id });
    const linked2 = await userCaller().episodeCharacters({ episodeId: ep.id });
    expect(linked2.filter((l) => l.character.id === ch1.id).length).toBe(1);
    await userCaller().unlinkCharacter({ episodeId: ep.id, characterId: ch1.id });
    const linked3 = await userCaller().episodeCharacters({ episodeId: ep.id });
    expect(linked3.find((l) => l.character.id === ch1.id)).toBeUndefined();
  });

  it("跨系列关联 → BAD_REQUEST（同一用户拥有两系列时，角色不属于本系列）", async () => {
    const { ep } = await makeHierarchy();
    const otherSeries = await addSeries(userCaller(), "别的系列（同主）");
    const chOther = await addCharacter(otherSeries.id, "外人");
    await expect(
      userCaller().linkCharacter({ episodeId: ep.id, characterId: chOther.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("characterEpisodes 反向列出「该角色被哪些集引用」（FR-SR-03 ②）", async () => {
    const { s, se, ep } = await makeHierarchy();
    const ch = await addCharacter(s.id, "主角");
    await userCaller().linkCharacter({ episodeId: ep.id, characterId: ch.id, role: "男主" });
    const refs = await userCaller().characterEpisodes({ characterId: ch.id });
    expect(refs.length).toBe(1);
    expect(refs[0]?.episodeId).toBe(ep.id);
    expect(refs[0]?.seasonId).toBe(se.id);
    expect(refs[0]?.seasonNumber).toBe(1);
    expect(refs[0]?.episodeNumber).toBe(1);
    expect(refs[0]?.role).toBe("男主");
    await userCaller().unlinkCharacter({ episodeId: ep.id, characterId: ch.id });
    expect(await userCaller().characterEpisodes({ characterId: ch.id })).toEqual([]);
  });

  it("他人角色的 characterEpisodes → FORBIDDEN", async () => {
    const s = await addSeries(otherCaller(), "别人的系列");
    const ch = await addCharacter(s.id, "外人", otherCaller());
    await expect(userCaller().characterEpisodes({ characterId: ch.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("production ↔ 系列库 双向同步（提升 / 注入）", () => {
  it("promoteFromProduction 同名只建一份并关联到本集", async () => {
    seedProduction(tdb, {
      id: "p1",
      userId: "user-a",
      characters: [
        { id: "pc1", name: "阿明", ageGender: "男", appearance: "黑发" },
        { id: "pc2", name: "阿明", ageGender: "男", appearance: "黑发" },
      ],
    });
    const { s, ep } = await makeHierarchy();
    await userCaller().assignProject({ episodeId: ep.id, projectId: "p1" });
    const res = await userCaller().promoteFromProduction({ projectId: "p1" });
    expect(res.created).toBe(1);
    expect(res.linked).toBe(1);
    const list = await userCaller().characters({ seriesId: s.id });
    expect(list.map((x) => x.name)).toContain("阿明");
    const linked = await userCaller().episodeCharacters({ episodeId: ep.id });
    expect(linked.length).toBe(1);
  });

  it("promoteFromProduction 重复跑只更新不新增", async () => {
    seedProduction(tdb, {
      id: "p2",
      userId: "user-a",
      characters: [{ id: "pc3", name: "小红", appearance: "红衣" }],
    });
    const { s, ep } = await makeHierarchy();
    await userCaller().assignProject({ episodeId: ep.id, projectId: "p2" });
    await userCaller().promoteFromProduction({ projectId: "p2" });
    const res = await userCaller().promoteFromProduction({ projectId: "p2" });
    expect(res.created).toBe(0);
    expect(res.updated).toBeGreaterThanOrEqual(1);
    const list = await userCaller().characters({ seriesId: s.id });
    expect(list.filter((x) => x.name === "小红").length).toBe(1);
  });

  it("injectToProduction 把本集关联角色合并进项目（同名覆盖、新增追加）", async () => {
    seedProduction(tdb, {
      id: "p3",
      userId: "user-a",
      characters: [{ id: "pc4", name: "已有", appearance: "旧" }],
    });
    const { s, ep } = await makeHierarchy();
    await userCaller().assignProject({ episodeId: ep.id, projectId: "p3" });
    const ch = await addCharacter(s.id, "新角");
    await userCaller().linkCharacter({ episodeId: ep.id, characterId: ch.id });
    const res = await userCaller().injectToProduction({ projectId: "p3" });
    expect(res.injected).toBe(1);
    const [prodRow] = await tdbDb
      .select({ characters: schema.production.characters })
      .from(schema.production)
      .where(eq(schema.production.id, "p3"));
    const names = ((prodRow?.characters as Array<{ name: string }> | undefined) ?? []).map(
      (c) => c.name,
    );
    expect(names).toContain("新角");
    expect(names).toContain("已有");
  });

  it("他人项目的 promote / inject → FORBIDDEN", async () => {
    seedProduction(tdb, {
      id: "p4",
      userId: "user-b",
      characters: [{ id: "pc5", name: "x" }],
    });
    const { ep } = await makeHierarchy();
    await userCaller().assignProject({ episodeId: ep.id, projectId: "p4" });
    await expect(userCaller().promoteFromProduction({ projectId: "p4" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(userCaller().injectToProduction({ projectId: "p4" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("FR-SR-04 整季生成进度与批量提交", () => {
  it("seasonGenerationProgress 按集聚合 总/完成/失败/未完成", async () => {
    const { se, ep } = await makeHierarchy();
    const pid = "p-frsr04-prog";
    await tdbDb.insert(schema.production).values({
      id: pid,
      userId: "user-a",
      shots: [{ id: "sh1" }, { id: "sh2" }, { id: "sh3" }],
    });
    await tdbDb.update(schema.episode).set({ projectId: pid }).where(eq(schema.episode.id, ep.id));
    await tdbDb.insert(schema.task).values([
      {
        id: "t-su",
        userId: "user-a",
        type: "IMG",
        prompt: "",
        params: {},
        workflowName: "wt",
        status: "SUCCEEDED",
        projectId: pid,
        shotId: "sh1",
      },
      {
        id: "t-fa",
        userId: "user-a",
        type: "IMG",
        prompt: "",
        params: {},
        workflowName: "wt",
        status: "FAILED",
        projectId: pid,
        shotId: "sh2",
      },
    ]);
    const prog = await genCaller().seasonGenerationProgress({ seasonId: se.id });
    expect(prog.length).toBe(1);
    expect(prog[0]).toMatchObject({
      episodeId: ep.id,
      total: 3,
      done: 1,
      failed: 1,
      running: 0,
      pending: 1,
    });
  });

  it("seasonGenerationProgress 他人季 → FORBIDDEN", async () => {
    const s = await addSeries(otherCaller(), "别人的系列");
    const se = await addSeason(s.id, otherCaller());
    await expect(genCaller().seasonGenerationProgress({ seasonId: se.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("batchGenerateSeason 幂等：已 SUCCEEDED 的镜不重排，只入队未完成镜", async () => {
    const { se, ep } = await makeHierarchy();
    const pid = "p-frsr04-batch";
    await tdbDb.insert(schema.production).values({
      id: pid,
      userId: "user-a",
      shots: [{ id: "sh1" }, { id: "sh2" }],
    });
    await tdbDb.update(schema.episode).set({ projectId: pid }).where(eq(schema.episode.id, ep.id));
    await tdbDb.insert(schema.task).values({
      id: "t-done",
      userId: "user-a",
      type: "IMG",
      prompt: "",
      params: {},
      workflowName: "wt",
      status: "SUCCEEDED",
      projectId: pid,
      shotId: "sh1",
    });
    await tdbDb.insert(schema.workflowTemplate).values({
      id: "wt-frsr04",
      userId: "user-a",
      name: "默认工作流",
      taskType: "IMG",
      rawJson: { nodes: [] },
    });
    const res = await genCaller().batchGenerateSeason({
      seasonId: se.id,
      workflowId: "wt-frsr04",
    });
    expect(res).toEqual({ enqueued: 1, skipped: 1 });
    const tasks = await tdbDb.select().from(schema.task).where(eq(schema.task.projectId, pid));
    expect(tasks.length).toBe(2);
  });

  it("batchGenerateSeason 不存在的工作流 → NOT_FOUND", async () => {
    const { se, ep } = await makeHierarchy();
    const pid = "p-frsr04-nf";
    await tdbDb.insert(schema.production).values({
      id: pid,
      userId: "user-a",
      shots: [{ id: "sh1" }],
    });
    await tdbDb.update(schema.episode).set({ projectId: pid }).where(eq(schema.episode.id, ep.id));
    await expect(
      genCaller().batchGenerateSeason({
        seasonId: se.id,
        workflowId: "nope",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("batchGenerateSeason 他人季 → FORBIDDEN", async () => {
    const s = await addSeries(otherCaller(), "别人的系列");
    const se = await addSeason(s.id, otherCaller());
    await expect(
      genCaller().batchGenerateSeason({
        seasonId: se.id,
        workflowId: "nope",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
