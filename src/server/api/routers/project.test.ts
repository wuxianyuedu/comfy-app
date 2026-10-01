import type * as LoggerModule from "~/lib/core/logger";
/**
 * project.router 集成测试（台账 A3 这一族越权的判据）。
 *
 * 分工不是「把每个 procedure 都跑一遍」，而是把**归属**这条线钉死：本路由的 id
 * 全部由客户端生成（画布 localStorage 里的 `proj_*`，自动保存时随请求一起送），
 * 所以每个读 / 写 / 删都必须证明「越不过去」：
 *  · `upsert` 的 update 分支此前只按 id 定位行 → 任何人抄一个别人的项目 id 就能
 *    把对方的画布整幅覆盖掉（本批修的就是它）；
 *  · `delete` 走 `deleteForUser`（双条件），越界时必须是「什么都没删」而不是报错；
 *  · `get` / `patch` / `outputs` 三个读出口都要拒绝他人项目。
 *
 * mock 边界：~/server/db（内存库 + 真 Drizzle）、~/server/better-auth、
 * ~/lib/core/logger（静音，同时留一个可断言「拒绝要有日志」的句柄）。
 * repository 与限流中间件走真实实现。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createCallerFactory } from "~/server/api/trpc";
import { projectRouter } from "~/server/api/routers/project";
import { logger } from "~/lib/core/logger";
import {
  getTestDb,
  seedUser,
  seedProject,
  seedTask,
  type Row,
} from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(projectRouter);
const tdb = getTestDb();

/** user-b 的 context（越权用例的请求方；`makeCtx()` 缺省是 user-a）。 */
const ctxB = () =>
  makeCtx({ user: { id: "user-b", email: "b@test.dev", name: null } });

const NODES = [{ id: "n1", type: "workflow", position: { x: 0, y: 0 } }];
const EDGES = [{ id: "e1", source: "n1", target: "n1" }];

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

// ───────────────────────────────────── list ─────────────────────────────────────

describe("project.list", () => {
  it("只返回自己的项目，按 updatedAt 倒序", async () => {
    seedProject(tdb, {
      id: "p-old",
      userId: "user-a",
      name: "旧",
      updatedAt: new Date("2026-01-01"),
    });
    seedProject(tdb, {
      id: "p-new",
      userId: "user-a",
      name: "新",
      updatedAt: new Date("2026-06-01"),
    });
    seedProject(tdb, { id: "p-b", userId: "user-b", name: "别人的" });

    const res = await createCaller(makeCtx()).list();
    expect(res.map((p) => p.id)).toEqual(["p-new", "p-old"]);
  });

  it("空库返回空列表", async () => {
    expect(await createCaller(makeCtx()).list()).toEqual([]);
  });
});

// ──────────────────────────────────── upsert ────────────────────────────────────

describe("project.upsert", () => {
  it("新建：行落在请求方名下，nodes/edges 原样存", async () => {
    const res = await createCaller(ctxB()).upsert({
      id: "proj_b1",
      name: "画布一",
      nodes: NODES,
      edges: EDGES,
    });
    expect(res.userId).toBe("user-b");
    const row = tdb.$tables.projects.find((p) => p.id === "proj_b1")!;
    expect(row.name).toBe("画布一");
    expect(row.nodes).toEqual(NODES);
    expect(row.edges).toEqual(EDGES);
  });

  it("覆盖自己的项目：仍然一行，内容换掉", async () => {
    seedProject(tdb, { id: "p1", userId: "user-a", name: "旧名" });
    await createCaller(makeCtx()).upsert({
      id: "p1",
      name: "新名",
      nodes: NODES,
    });
    const rows = tdb.$tables.projects.filter((p) => p.id === "p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("新名");
    expect(rows[0]!.nodes).toEqual(NODES);
  });

  it("他人项目的 id → FORBIDDEN，且对方那一行一字不动（越权写）", async () => {
    seedProject(tdb, {
      id: "p-victim",
      userId: "user-a",
      name: "受害者画布",
      nodes: NODES,
      edges: EDGES,
    });
    await expect(
      createCaller(ctxB()).upsert({
        id: "p-victim",
        name: "被覆盖",
        nodes: [],
        edges: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const row = tdb.$tables.projects.find((p) => p.id === "p-victim")!;
    expect(row.name).toBe("受害者画布");
    expect(row.nodes).toEqual(NODES);
    expect(row.userId).toBe("user-a");
    // 拒绝要有可查的出口（硬规则 4）：这条链路的客户端是「尽力而为的镜像」，
    // 失败被前端吞掉，服务端这一行 warn 是唯一留下的痕迹。
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("p-victim"),
    );
  });

  it("Zod 校验：空 id / 空 name → BAD_REQUEST", async () => {
    const caller = createCaller(makeCtx());
    await expect(caller.upsert({ id: "", name: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(caller.upsert({ id: "p1", name: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

// ────────────────────────────────────── get ──────────────────────────────────────

describe("project.get", () => {
  it("返回自己的项目", async () => {
    seedProject(tdb, { id: "p1", userId: "user-a", name: "我的" });
    const res = await createCaller(makeCtx()).get({ projectId: "p1" });
    expect(res?.name).toBe("我的");
  });

  it("他人项目 / 不存在 → 同一个错误信封，且码是 NOT_FOUND（不给探测 id 用）", async () => {
    seedProject(tdb, { id: "p-b", userId: "user-b", name: "别人的" });
    const caller = createCaller(makeCtx());
    /** 把错误信封整个取出来比 —— 只比 `message` 的话，500 与 404 可以同文案，
     *  「同形」就成了假的；码进比较才是那句口径的机器判据。 */
    const envelope = (p: Promise<unknown>) =>
      p.then(
        () => "OK",
        (e: { code?: string; message?: string }) =>
          `${e?.code ?? "?"}|${e?.message ?? "?"}`,
      );
    const foreign = await envelope(caller.get({ projectId: "p-b" }));
    const missing = await envelope(caller.get({ projectId: "nope" }));
    expect(foreign).toBe(missing);
    expect(foreign.split("|")[0]).toBe("NOT_FOUND");
  });
});

// ──────────────────────────────────── patch ────────────────────────────────────

describe("project.patch", () => {
  it("只覆盖传入的字段，未传的保持原值", async () => {
    seedProject(tdb, {
      id: "p1",
      userId: "user-a",
      name: "旧名",
      nodes: NODES,
    });
    const res = await createCaller(makeCtx()).patch({
      projectId: "p1",
      name: "新名",
    });
    expect(res.name).toBe("新名");
    expect(res.nodes).toEqual(NODES);
  });

  it("三个字段都给 → 一起写回", async () => {
    seedProject(tdb, { id: "p1", userId: "user-a", name: "旧名" });
    const res = await createCaller(makeCtx()).patch({
      projectId: "p1",
      name: "新名",
      nodes: NODES,
      edges: EDGES,
    });
    expect(res).toMatchObject({ name: "新名", nodes: NODES, edges: EDGES });
  });

  it("他人项目 → 不改一行、抛NOT_FOUND", async () => {
    seedProject(tdb, {
      id: "p-a",
      userId: "user-a",
      name: "受害画布",
      nodes: NODES,
    });
    await expect(
      createCaller(ctxB()).patch({ projectId: "p-a", name: "改掉" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const row = tdb.$tables.projects.find((p) => p.id === "p-a")!;
    expect(row.name).toBe("受害画布");
    expect(row.nodes).toEqual(NODES);
  });
});

// ──────────────────────────────────── delete ────────────────────────────────────

describe("project.delete（rateLimitedProcedure）", () => {
  it("删自己的项目", async () => {
    seedProject(tdb, { id: "p1", userId: "user-a", name: "我的" });
    expect(await createCaller(makeCtx()).delete({ projectId: "p1" })).toEqual({
      ok: true,
    });
    expect(tdb.$tables.projects.find((p) => p.id === "p1")).toBeUndefined();
  });

  it("他人项目 → 回 ok 但那一行还在（deleteForUser 的 id+userId 双条件）", async () => {
    seedProject(tdb, { id: "p-b", userId: "user-b", name: "别人的" });
    expect(await createCaller(makeCtx()).delete({ projectId: "p-b" })).toEqual({
      ok: true,
    });
    expect(tdb.$tables.projects.find((p) => p.id === "p-b")).toBeDefined();
  });
});

// ──────────────────────────────────── outputs ────────────────────────────────────

describe("project.outputs", () => {
  const IMG = (id: string, localPath: string): Row => ({
    id,
    localPath,
    mediaType: "image",
    seed: "7",
    width: 512,
    height: 512,
    isCover: true,
    sortIndex: 0,
  });

  it("返回该项目下任务的投影（params 拆字段 + 产出图列表）", async () => {
    seedProject(tdb, { id: "p1", userId: "user-a", name: "我的" });
    seedTask(tdb, {
      id: "t1",
      userId: "user-a",
      projectId: "p1",
      type: "TXT2IMG",
      prompt: "cat",
      params: {
        seed: 7,
        size: "1024x1024",
        steps: 20,
        cfg: 6.5,
        sampler: "euler_a",
        checkpoint: "sd.safetensors",
      },
      referenceImages: ["/api/generated/ref.png"],
      images: [IMG("i1", "/api/generated/p1/t1/img_0.png")],
    });
    // 再种一条「别的项目」的任务：outputs 按项目取任务（项目本身已判过归属），
    // 这条不许混进结果。
    seedTask(tdb, { id: "t2", userId: "user-a", projectId: "p-other" });

    const res = await createCaller(makeCtx()).outputs({ projectId: "p1" });
    expect(res.outputs).toHaveLength(1);
    const [out] = res.outputs;
    expect(out).toMatchObject({
      id: "t1",
      type: "TXT2IMG",
      prompt: "cat",
      seed: "7",
      size: "1024x1024",
      sampler: "euler_a",
      steps: 20,
      cfg: 6.5,
      checkpoint: "sd.safetensors",
    });
    expect(out!.referenceImages).toEqual(["/api/generated/ref.png"]);
    expect(out!.images.map((i: { id: string }) => i.id)).toEqual(["i1"]);
  });

  it("params 是标量或整列为空时不炸，字段一律为 null", async () => {
    seedProject(tdb, { id: "p1", userId: "user-a", name: "我的" });
    // 两种「不是对象」的形状都要走通：库里存的标量（脏数据）与整列 NULL（老行）
    seedTask(tdb, {
      id: "t-num",
      userId: "user-a",
      projectId: "p1",
      params: 42,
    });
    seedTask(tdb, {
      id: "t-null",
      userId: "user-a",
      projectId: "p1",
      params: null,
    });
    const res = await createCaller(makeCtx()).outputs({ projectId: "p1" });
    expect(res.outputs.map((o) => o.id).sort()).toEqual(["t-null", "t-num"]);
    for (const out of res.outputs) {
      expect(out).toMatchObject({
        seed: null,
        size: null,
        steps: null,
        cfg: null,
        sampler: null,
        checkpoint: null,
      });
    }
  });

  it("他人项目 → 抛NOT_FOUND（台账 A3）", async () => {
    seedProject(tdb, { id: "p-b", userId: "user-b", name: "别人的" });
    seedTask(tdb, {
      id: "t-b",
      userId: "user-b",
      projectId: "p-b",
      images: [IMG("i-b", "/api/generated/p-b/t-b/img_0.png")],
    });
    await expect(
      createCaller(makeCtx()).outputs({ projectId: "p-b" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("不存在的项目 → 同一句NOT_FOUND", async () => {
    await expect(
      createCaller(makeCtx()).outputs({ projectId: "nope" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
