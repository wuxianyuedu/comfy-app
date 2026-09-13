import type * as LoggerModule from "~/server/lib/logger";
import type * as EnvfileModule from "@/lib/envfile";
import type * as ImportSourceModule from "@/lib/comfyui/importSource";
import type * as RawModule from "@/lib/comfyui/raw";
/**
 * workflow.router 集成测试。
 *
 * mock 边界：~/server/db（内存 Prisma 替身，见 tests/helpers/test-db.ts）、
 * ~/server/better-auth（getSession）、~/server/lib/logger（静音）、
 * @/lib/envfile（屏蔽真实 .env 的 LOCAL_WORKFLOWS_PATH）、
 * @/lib/comfyui/importSource（本地文件导入/重导入，避免真实磁盘依赖）、
 * @/lib/comfyui/raw（convertRawToApi 需要访问 ComfyUI /object_info， mock 后走
 * 路由自身的 fallback 分支）。其余（repository、workflow-types、workflow.ts、
 * workflow-detail、localWorkflows、raw 的 detectFormat/fallback）全部走真实实现。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<(args: { headers: Headers }) => Promise<unknown>>(
    async () => null
  ),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("~/server/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/envfile", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvfileModule>()),
  readEnvVar: vi.fn(() => null),
}));
vi.mock("@/lib/comfyui/importSource", async (importOriginal) => ({
  ...(await importOriginal<typeof ImportSourceModule>()),
  importFromLocalPath: vi.fn(),
  reimportFromSource: vi.fn(),
}));
vi.mock("@/lib/comfyui/raw", async (importOriginal) => ({
  ...(await importOriginal<typeof RawModule>()),
  convertRawToApi: vi.fn(async () => {
    throw new Error("object_info unreachable");
  }),
}));

import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import { workflowRouter } from "~/server/api/routers/workflow";
import {
  importFromLocalPath,
  reimportFromSource,
} from "@/lib/comfyui/importSource";
import { getTestDb, seedUser, seedWorkflowTemplate } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(workflowRouter);
const tdb = getTestDb();

const API_GRAPH = {
  "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "a.safetensors" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "hello" } },
  "3": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } },
};

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(null);
});

// ───────────────────────────────────── list ─────────────────────────────────────

describe("workflow.list", () => {
  it("空库返回空列表且 localRoots 为 null", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    const caller = createCaller(makeCtx());
    const res = await caller.list();
    expect(res.workflows).toEqual([]);
    expect(res.localPending).toEqual([]);
    expect(res.localRoots).toBeNull();
  });

  it("按用户隔离返回并完成 enrichment（hasApi/hasRaw/format/typeLabel/modelTags）", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedUser(tdb, { id: "user-b", email: "b@test.dev" });
    const rawOnly = seedWorkflowTemplate(tdb, {
      id: "wf-raw",
      userId: "user-a",
      name: "Raw One",
      taskType: "T2I",
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      graph: null,
      createdAt: new Date(1000),
    });
    const apiOnly = seedWorkflowTemplate(tdb, {
      id: "wf-api",
      userId: "user-a",
      name: "Api One",
      taskType: "T2I",
      graph: API_GRAPH,
      modelTags: [{ id: "tag-1", userId: "user-a", name: "SDXL" }],
      createdAt: new Date(2000),
    });
    // 他人工作流不得出现
    seedWorkflowTemplate(tdb, { id: "wf-other", userId: "user-b", name: "Other" });

    const res = await createCaller(makeCtx()).list();

    expect(res.workflows.map((w) => w.id)).toEqual(["wf-api", "wf-raw"]); // createdAt desc
    const apiRow = res.workflows[0]!;
    expect(apiRow.source).toBe("online");
    expect(apiRow.hasApi).toBe(true);
    expect(apiRow.hasRaw).toBe(false);
    expect(apiRow.usable).toBe(true);
    expect(apiRow.format).toBe("api");
    expect(apiRow.apiOrigin).toBe("user");
    expect(apiRow.modelTags).toEqual(["SDXL"]);
    expect(apiRow.sourceRoot).toBeUndefined();
    const rawRow = res.workflows[1]!;
    expect(rawRow.hasApi).toBe(false);
    expect(rawRow.hasRaw).toBe(true);
    expect(rawRow.usable).toBe(false);
    expect(rawRow.format).toBe("raw");
    expect(rawRow.apiOrigin).toBeNull();
    expect(rawRow.id).toBe(rawOnly.id);
    expect(apiRow.id).toBe(apiOnly.id);
  });

  it("type 过滤命中任务类型", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedWorkflowTemplate(tdb, { id: "wf-img", userId: "user-a", taskType: "T2I" });
    seedWorkflowTemplate(tdb, { id: "wf-video", userId: "user-a", taskType: "T2V" });
    const res = await createCaller(makeCtx()).list({ type: "T2V" });
    expect(res.workflows.map((w) => w.id)).toEqual(["wf-video"]);
  });

  it("category 过滤（video → T2V/I2V 等 code 的 in 查询）", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedWorkflowTemplate(tdb, { id: "wf-img", userId: "user-a", taskType: "T2I" });
    seedWorkflowTemplate(tdb, { id: "wf-video", userId: "user-a", taskType: "T2V" });
    const res = await createCaller(makeCtx()).list({ category: "video" });
    expect(res.workflows.map((w) => w.id)).toEqual(["wf-video"]);
  });

  it("model 过滤（逗号分隔 → modelTags some in）", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedWorkflowTemplate(tdb, {
      id: "wf-sdxl",
      userId: "user-a",
      modelTags: [{ id: "tag-1", userId: "user-a", name: "SDXL" }],
    });
    seedWorkflowTemplate(tdb, {
      id: "wf-flux",
      userId: "user-a",
      modelTags: [{ id: "tag-2", userId: "user-a", name: "FLUX" }],
    });
    const res = await createCaller(makeCtx()).list({ model: "FLUX, Unknown" });
    expect(res.workflows.map((w) => w.id)).toEqual(["wf-flux"]);
  });
});

// ──────────────────────────────────── create ────────────────────────────────────

describe("workflow.create", () => {
  beforeEach(() => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  });

  it("API graph 导入：默认名、detectParamMap、落库", async () => {
    const res = await createCaller(makeCtx()).create({ graph: API_GRAPH });
    expect(res.name).toBe("未命名工作流");
    expect(res.format).toBe("api");
    expect(res.hasPositions).toBe(false);
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === res.id);
    expect(row).toBeDefined();
    expect(row?.userId).toBe("user-a");
    expect(row?.graph).toEqual(API_GRAPH);
  });

  it("显式 format=api 但节点缺 class_type → BAD_REQUEST", async () => {
    const caller = createCaller(makeCtx());
    await expect(
      caller.create({ format: "api", graph: { "1": { inputs: {} } } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("缺少工作流 JSON → BAD_REQUEST", async () => {
    await expect(createCaller(makeCtx()).create({})).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("无法识别的格式 → BAD_REQUEST", async () => {
    await expect(
      createCaller(makeCtx()).create({ graph: { foo: "bar" } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("raw 格式：convertRawToApi 失败时走 fallback 分支并保留 rawJson/positions/warnings", async () => {
    const raw = { nodes: [{ id: 1, type: "KSampler", pos: [10, 20] }] };
    // convertRawToApi 被 mock 为 reject → 路由内部 catch → fallbackRawToApi
    const res = await createCaller(makeCtx()).create({
      raw,
      name: "Raw Import",
    });
    expect(res.format).toBe("raw");
    expect(res.hasPositions).toBe(true);
    expect(res.warnings).toBeDefined();
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === res.id);
    expect(row?.rawJson).toEqual(raw);
    expect(row?.graph).toBeTruthy();
  });

  it("本地文件导入：成功路径（名称回退为文件名）", async () => {
    vi.mocked(importFromLocalPath).mockResolvedValueOnce({
      taskType: "T2I",
      apiGraph: API_GRAPH,
      paramMap: { positiveNode: "2" },
      rawJson: null,
      positions: null,
      sourcePath: "C:/wf/my-flow.json",
      sourceChecksum: "abc123",
      sourceMtime: 1234,
      warnings: [],
      format: "api",
    });
    const res = await createCaller(makeCtx()).create({
      sourcePath: "C:/wf/my-flow.json",
    });
    expect(res.name).toBe("my-flow"); // body.name 缺省 → 文件名
    expect(res.source).toBe("local");
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === res.id);
    expect(row?.sourceChecksum).toBe("abc123");
  });

  it("本地文件导入失败 → BAD_REQUEST（透传错误消息）", async () => {
    vi.mocked(importFromLocalPath).mockRejectedValueOnce(new Error("文件不存在"));
    await expect(
      createCaller(makeCtx()).create({ sourcePath: "C:/wf/missing.json" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "文件不存在" });
  });

  it("Zod 校验：name 超长 → BAD_REQUEST", async () => {
    await expect(
      createCaller(makeCtx()).create({ name: "x".repeat(201), graph: API_GRAPH })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ──────────────────────────────────── detail ────────────────────────────────────

describe("workflow.detail", () => {
  it("归属校验读取自己的模板", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedWorkflowTemplate(tdb, { id: "wf-1", userId: "user-a", name: "Mine" });
    const res = await createCaller(makeCtx()).detail({ id: "wf-1" });
    expect(res.template.name).toBe("Mine");
  });

  it("不存在 / 他人模板 → NOT_FOUND；非法输入 → BAD_REQUEST", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedUser(tdb, { id: "user-b", email: "b@test.dev" });
    seedWorkflowTemplate(tdb, { id: "wf-b", userId: "user-b" });
    const caller = createCaller(makeCtx());
    await expect(caller.detail({ id: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.detail({ id: "wf-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.detail({} as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

// ──────────────────────────────────── update ────────────────────────────────────

describe("workflow.update", () => {
  beforeEach(() => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  });

  it("改名 + taskType 归一化 + positions merge + rawJson 节点回写 + modelTags 关系替换", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-1",
      userId: "user-a",
      name: "Old",
      taskType: "T2I",
      rawJson: { nodes: [{ id: "1", type: "KSampler", pos: [9, 9] }], links: [] },
      positions: { "5": [0, 0] },
    });
    const res = await createCaller(makeCtx()).update({
      id: "wf-1",
      name: "Renamed",
      taskType: "t2i",
      positions: { "1": [1, 2] },
      mergePositions: true,
      modelTags: ["SDXL"],
    });
    expect(res.template.name).toBe("Renamed");
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-1")!;
    expect(row.taskType).toBe("T2I"); // normalizeTaskType("t2i") → 规范大写 "T2I"
    expect(row.positions).toEqual({ "5": [0, 0], "1": [1, 2] }); // merge 不清空另一命名空间
    const rawJson = row.rawJson as { nodes: Array<{ pos?: unknown }> };
    expect(rawJson.nodes[0]?.pos).toEqual([1, 2]);
    expect(row.modelTags).toEqual([
      expect.objectContaining({ name: "SDXL", userId: "user-a" }),
    ]);
    expect(tdb.$tables.workflowModelTags).toHaveLength(1);
  });

  it("仅 modelTags 更新：跳过模板列写入（drizzle 空 patch 抛 No values to set），标签关系照常落库", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-2",
      userId: "user-a",
      name: "Keep",
      taskType: "T2I",
    });
    const res = await createCaller(makeCtx()).update({
      id: "wf-2",
      modelTags: ["z-image", "SD3.5"],
    });
    expect(res.template.name).toBe("Keep");
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-2")!;
    expect(row.modelTags).toEqual([
      expect.objectContaining({ name: "z-image", userId: "user-a" }),
      expect.objectContaining({ name: "SD3.5", userId: "user-a" }),
    ]);
  });

  it("不存在 / 他人模板 → NOT_FOUND", async () => {
    seedUser(tdb, { id: "user-b", email: "b@test.dev" });
    seedWorkflowTemplate(tdb, { id: "wf-b", userId: "user-b" });
    const caller = createCaller(makeCtx());
    await expect(caller.update({ id: "nope", name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.update({ id: "wf-b", name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("resetPositionsScope 顶层：只清裸 id 与导轨，子图命名空间的坐标留着", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-reset-top",
      userId: "user-a",
      rawJson: { nodes: [{ id: "1", type: "KSampler", pos: [9, 9] }], links: [] },
      positions: {
        "1": [111, 222],
        "grp:bpin:inputs": [0, 0],
        "4:1670": [1000, 1000],
      },
    });
    await createCaller(makeCtx()).update({ id: "wf-reset-top", resetPositionsScope: "" });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-reset-top")!;
    expect(row.positions).toEqual({ "4:1670": [1000, 1000] });
  });

  it("resetPositionsScope 子图：只清本层拼接键，wrapper 本体与更深一层都不动", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-reset-sub",
      userId: "user-a",
      positions: {
        "4": [10, 10],
        "4:1670": [1000, 1000],
        "4:1671": [1200, 1000],
        "4:5:1670": [500, 500],
        "9:1670": [700, 700],
      },
    });
    await createCaller(makeCtx()).update({ id: "wf-reset-sub", resetPositionsScope: "4" });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-reset-sub")!;
    expect(row.positions).toEqual({
      "4": [10, 10],
      "4:5:1670": [500, 500],
      "9:1670": [700, 700],
    });
  });

  it("重置清空后写入 null 而不是空对象（空对象会被当「有坐标」把节点堆到原点）", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-reset-empty",
      userId: "user-a",
      positions: { "1": [1, 1] },
    });
    await createCaller(makeCtx()).update({ id: "wf-reset-empty", resetPositionsScope: "" });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-reset-empty")!;
    expect(row.positions).toBeNull();
  });

  it("resetPositionsScope 与 positions 互斥：重置时不被写回的数据覆盖", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-reset-excl",
      userId: "user-a",
      positions: { "1": [1, 1] },
    });
    await createCaller(makeCtx()).update({
      id: "wf-reset-excl",
      resetPositionsScope: "",
      positions: { "1": [999, 999] },
    });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-reset-excl")!;
    expect(row.positions).toBeNull();
  });

  it("upgradeFromApi 非 API 格式 → BAD_REQUEST", async () => {
    seedWorkflowTemplate(tdb, { id: "wf-1", userId: "user-a" });
    await expect(
      createCaller(makeCtx()).update({ id: "wf-1", upgradeFromApi: { nodes: [] } })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ──────────────────────────────────── delete ────────────────────────────────────

describe("workflow.delete", () => {
  it("删除自己的模板；不存在/他人 → NOT_FOUND", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedUser(tdb, { id: "user-b", email: "b@test.dev" });
    seedWorkflowTemplate(tdb, { id: "wf-1", userId: "user-a" });
    seedWorkflowTemplate(tdb, { id: "wf-b", userId: "user-b" });
    const caller = createCaller(makeCtx());
    expect(await caller.delete({ id: "wf-1" })).toEqual({ ok: true });
    expect(tdb.$tables.workflowTemplates.find((r) => r.id === "wf-1")).toBeUndefined();
    await expect(caller.delete({ id: "wf-1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.delete({ id: "wf-b" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ──────────────────────────────────── resync ────────────────────────────────────

describe("workflow.resync", () => {
  beforeEach(() => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedWorkflowTemplate(tdb, {
      id: "wf-1",
      userId: "user-a",
      sourcePath: "C:/wf/a.json",
      sourceChecksum: "chk-1",
      sourceMtime: 100,
    });
  });

  it("源文件丢失 → { missing: true }", async () => {
    vi.mocked(reimportFromSource).mockResolvedValueOnce({
      missing: true,
    });
    expect(await createCaller(makeCtx()).resync({ id: "wf-1" })).toEqual({
      missing: true,
    });
  });

  it("内容未变化 → { unchanged: true } 且不落库", async () => {
    vi.mocked(reimportFromSource).mockResolvedValueOnce({
      unchanged: true,
    });
    expect(await createCaller(makeCtx()).resync({ id: "wf-1" })).toEqual({
      unchanged: true,
    });
  });

  it("重新导入成功 → 更新模板并返回 { updated: true, template }", async () => {
    vi.mocked(reimportFromSource).mockResolvedValueOnce({
      update: {
        graph: API_GRAPH,
        rawJson: { nodes: [] },
        paramMap: { positiveNode: "2" },
        positions: { "1": [3, 4] },
        sourceMtime: 200,
        sourceChecksum: "chk-2",
        taskType: "T2I",
      },
    });
    const res = await createCaller(makeCtx()).resync({ id: "wf-1" });
    expect(res).toMatchObject({ updated: true });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-1")!;
    expect(row.sourceChecksum).toBe("chk-2");
    expect(row.sourceMtime).toBe(200);
    expect(row.graph).toEqual(API_GRAPH);
    expect(reimportFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: "C:/wf/a.json", sourceChecksum: "chk-1" })
    );
  });

  it("模板不存在 → NOT_FOUND", async () => {
    await expect(createCaller(makeCtx()).resync({ id: "nope" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ────────────────────── 鉴权分支：demo 兜底 + context 解析 ──────────────────────

describe("workflow 鉴权分支", () => {
  it("authedProcedure：无 session 时走 demo-user 兜底（自动建用户）", async () => {
    const caller = createCaller(makeCtx({ user: null }));
    const res = await caller.list();
    expect(res.workflows).toEqual([]);
    const demo = tdb.$tables.users.find(
      (u) => u.email === (process.env.DEMO_USER_EMAIL ?? "demo@comfy.app")
    );
    expect(demo).toBeDefined();
  });

  it("createTRPCContext：session 有用户 email → 经 userRepository 解析出 ctx.user", async () => {
    seedUser(tdb, { id: "db-u1", email: "sess@test.dev", name: "Sess" });
    getSessionMock.mockResolvedValueOnce({
      user: { id: "auth-1", email: "sess@test.dev", name: "Sess" },
    });
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.user).toEqual({ id: "db-u1", email: "sess@test.dev", name: "Sess" });
  });

  it("createTRPCContext：无 session → user 为 null", async () => {
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.user).toBeNull();
  });
});
