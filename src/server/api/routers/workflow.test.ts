import type * as LoggerModule from "~/lib/core/logger";
import type * as EnvfileModule from "~/lib/envfile";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";
import type * as ImportSourceModule from "~/lib/comfyui/importSource";
/**
 * workflow.router 集成测试。
 *
 * mock 边界：~/server/db（内存 Prisma 替身，见 tests/helpers/test-db.ts）、
 * ~/server/better-auth（getSession）、~/lib/core/logger（静音）、
 * ~/lib/envfile（屏蔽真实 .env 的 LOCAL_WORKFLOWS_PATH）、
 * ~/lib/comfyui/importSource（本地文件导入/重导入，避免真实磁盘依赖）。
 * 其余（repository、workflow-types、workflow.ts、workflow-detail、
 * localWorkflows、raw 的 detectFormat/extractPositions）全部走真实实现 —— 导入链
 * 里**不再有**「转 API 图」这一步，所以不需要再 mock 转换器。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<(args: { headers: Headers }) => Promise<unknown>>(
    async () => null,
  ),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: getSessionMock } },
}));
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/envfile", async (importOriginal) => ({
  ...(await importOriginal<typeof EnvfileModule>()),
  readEnvVar: vi.fn(() => null),
}));
/* 本地工作流根目录由「设置里的 ComfyUI 路径」推导，而 data/app-settings.json 是
 * 每台机器各一份：不抹掉这层，判据就随开发机的真实安装目录而变（本机装了
 * ComfyUI 时 localRoots 非空，空库用例会假失败）。这里保留其余字段的真实取值，
 * 只把 comfyuiPath 清空。 */
vi.mock("~/lib/app-settings/app-settings.server", async (importOriginal) => {
  const mod = await importOriginal<typeof AppSettingsModule>();
  return {
    ...mod,
    getSettingsSync: vi.fn(() => ({
      ...mod.getSettingsSync(),
      comfyuiPath: "",
    })),
  };
});
vi.mock("~/lib/comfyui/importSource", async (importOriginal) => ({
  ...(await importOriginal<typeof ImportSourceModule>()),
  importFromLocalPath: vi.fn(),
  reimportFromSource: vi.fn(),
}));

import { createCallerFactory, createTRPCContext } from "~/server/api/trpc";
import { workflowRouter } from "~/server/api/routers/workflow";
import {
  importFromLocalPath,
  reimportFromSource,
} from "~/lib/comfyui/importSource";
import {
  getTestDb,
  seedUser,
  seedWorkflowTemplate,
} from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(workflowRouter);
const tdb = getTestDb();

/** 一份最小的 ComfyUI 原始工作流（RAW / LiteGraph）—— 唯一支持的导入形态。 */
const RAW_WF = {
  last_node_id: 3,
  last_link_id: 0,
  nodes: [
    { id: 1, type: "CheckpointLoaderSimple", pos: [10, 20] },
    { id: 2, type: "CLIPTextEncode", pos: [30, 40] },
    { id: 3, type: "KSampler", pos: [50, 60] },
  ],
  links: [],
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

  it("按用户隔离返回并完成 enrichment（hasRaw/usable/typeLabel/modelTags）", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedUser(tdb, { id: "user-b", email: "b@test.dev" });
    const withRaw = seedWorkflowTemplate(tdb, {
      id: "wf-raw",
      userId: "user-a",
      name: "Raw One",
      taskType: "T2I",
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
      modelTags: [{ id: "tag-1", userId: "user-a", name: "SDXL" }],
      createdAt: new Date(1000),
    });
    const noRaw = seedWorkflowTemplate(tdb, {
      id: "wf-empty",
      userId: "user-a",
      name: "Empty One",
      taskType: "T2I",
      rawJson: null,
      createdAt: new Date(2000),
    });
    // 他人工作流不得出现
    seedWorkflowTemplate(tdb, {
      id: "wf-other",
      userId: "user-b",
      name: "Other",
    });

    const res = await createCaller(makeCtx()).list();

    expect(res.workflows.map((w) => w.id)).toEqual(["wf-empty", "wf-raw"]); // createdAt desc
    const emptyRow = res.workflows[0]!;
    expect(emptyRow.source).toBe("online");
    expect(emptyRow.sourceRoot).toBeUndefined();
    /* 没有 RAW 原件 → 不可执行（库里唯一可执行的形态就是 RAW 原件）。 */
    expect(emptyRow.hasRaw).toBe(false);
    expect(emptyRow.usable).toBe(false);
    expect(emptyRow.id).toBe(noRaw.id);

    const rawRow = res.workflows[1]!;
    expect(rawRow.hasRaw).toBe(true);
    expect(rawRow.usable).toBe(true);
    expect(rawRow.modelTags).toEqual(["SDXL"]);
    expect(rawRow.id).toBe(withRaw.id);
  });

  it("type 过滤命中任务类型", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedWorkflowTemplate(tdb, {
      id: "wf-img",
      userId: "user-a",
      taskType: "T2I",
    });
    seedWorkflowTemplate(tdb, {
      id: "wf-video",
      userId: "user-a",
      taskType: "T2V",
    });
    const res = await createCaller(makeCtx()).list({ type: "T2V" });
    expect(res.workflows.map((w) => w.id)).toEqual(["wf-video"]);
  });

  it("category 过滤（video → T2V/I2V 等 code 的 in 查询）", async () => {
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    seedWorkflowTemplate(tdb, {
      id: "wf-img",
      userId: "user-a",
      taskType: "T2I",
    });
    seedWorkflowTemplate(tdb, {
      id: "wf-video",
      userId: "user-a",
      taskType: "T2V",
    });
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

  it("RAW 原件导入：默认名、坐标与原件一起落库", async () => {
    const res = await createCaller(makeCtx()).create({ raw: RAW_WF });
    expect(res.name).toBe("未命名工作流");
    expect(res.hasPositions).toBe(true);
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === res.id);
    expect(row).toBeDefined();
    expect(row?.userId).toBe("user-a");
    expect(row?.rawJson).toEqual(RAW_WF);
    expect(row?.positions).toEqual({
      "1": [10, 20],
      "2": [30, 40],
      "3": [50, 60],
    });
  });

  it("API 格式导入不受支持 → BAD_REQUEST（本应用只吃原始工作流格式）", async () => {
    const caller = createCaller(makeCtx());
    await expect(
      caller.create({
        raw: { "1": { class_type: "KSampler", inputs: {} } },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("缺少工作流 JSON → BAD_REQUEST", async () => {
    await expect(createCaller(makeCtx()).create({})).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("nodes 为空数组 → BAD_REQUEST", async () => {
    await expect(
      createCaller(makeCtx()).create({ raw: { nodes: [] } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("本地文件导入：成功路径（名称回退为文件名）", async () => {
    vi.mocked(importFromLocalPath).mockResolvedValueOnce({
      taskType: "T2I",
      rawJson: RAW_WF,
      positions: null,
      sourcePath: "C:/wf/my-flow.json",
      sourceChecksum: "abc123",
      sourceMtime: 1234,
      warnings: [],
      format: "raw",
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
    vi.mocked(importFromLocalPath).mockRejectedValueOnce(
      new Error("文件不存在"),
    );
    await expect(
      createCaller(makeCtx()).create({ sourcePath: "C:/wf/missing.json" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "文件不存在" });
  });

  it("Zod 校验：name 超长 → BAD_REQUEST", async () => {
    await expect(
      createCaller(makeCtx()).create({
        name: "x".repeat(201),
        raw: RAW_WF,
      }),
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
      rawJson: {
        nodes: [{ id: "1", type: "KSampler", pos: [9, 9] }],
        links: [],
      },
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
    await expect(
      caller.update({ id: "nope", name: "X" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      caller.update({ id: "wf-b", name: "X" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("resetPositionsScope 顶层：只清裸 id 与导轨，子图命名空间的坐标留着", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-reset-top",
      userId: "user-a",
      rawJson: {
        nodes: [{ id: "1", type: "KSampler", pos: [9, 9] }],
        links: [],
      },
      positions: {
        "1": [111, 222],
        "grp:bpin:inputs": [0, 0],
        "4:1670": [1000, 1000],
      },
    });
    await createCaller(makeCtx()).update({
      id: "wf-reset-top",
      resetPositionsScope: "",
    });
    const row = tdb.$tables.workflowTemplates.find(
      (r) => r.id === "wf-reset-top",
    )!;
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
    await createCaller(makeCtx()).update({
      id: "wf-reset-sub",
      resetPositionsScope: "4",
    });
    const row = tdb.$tables.workflowTemplates.find(
      (r) => r.id === "wf-reset-sub",
    )!;
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
    await createCaller(makeCtx()).update({
      id: "wf-reset-empty",
      resetPositionsScope: "",
    });
    const row = tdb.$tables.workflowTemplates.find(
      (r) => r.id === "wf-reset-empty",
    )!;
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
    const row = tdb.$tables.workflowTemplates.find(
      (r) => r.id === "wf-reset-excl",
    )!;
    expect(row.positions).toBeNull();
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
    expect(
      tdb.$tables.workflowTemplates.find((r) => r.id === "wf-1"),
    ).toBeUndefined();
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
        rawJson: RAW_WF,
        paramMap: null,
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
    expect(row.rawJson).toEqual(RAW_WF);
    expect(reimportFromSource).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePath: "C:/wf/a.json",
        sourceChecksum: "chk-1",
      }),
    );
  });

  it("模板不存在 → NOT_FOUND", async () => {
    await expect(
      createCaller(makeCtx()).resync({ id: "nope" }),
    ).rejects.toMatchObject({
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
      (u) => u.email === (process.env.DEMO_USER_EMAIL ?? "demo@comfy.app"),
    );
    expect(demo).toBeDefined();
  });

  it("createTRPCContext：session 有用户 email → 经 userRepository 解析出 ctx.user", async () => {
    seedUser(tdb, { id: "db-u1", email: "sess@test.dev", name: "Sess" });
    getSessionMock.mockResolvedValueOnce({
      user: { id: "auth-1", email: "sess@test.dev", name: "Sess" },
    });
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.user).toEqual({
      id: "db-u1",
      email: "sess@test.dev",
      name: "Sess",
    });
  });

  it("createTRPCContext：无 session → user 为 null", async () => {
    const ctx = await createTRPCContext({ headers: new Headers() });
    expect(ctx.user).toBeNull();
  });
});
