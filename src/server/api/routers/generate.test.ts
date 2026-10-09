import type * as LoggerModule from "~/lib/core/logger";
/**
 * generate.router 集成测试。
 *
 * mock 边界：~/server/db（内存数据库替身）、~/server/better-auth、
 * ~/lib/core/logger（静音）、~/lib/comfyui/enqueue（enqueue 整体 mock——
 * 真模块 import 时会启动 reaper 定时器并连 ComfyUI WS）、
 * repository 走真实实现（内置模板 + token 替换已移除，故不再 mock
 * `~/lib/comfyui/client` 的 listModels）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as AppRuntimeLogModule from "~/lib/log/app-runtime-log";
/* 业务里程碑日志（`generateRuntimeLog`，模块内 `createAppRuntimeLogger("generate")`）
 * 是**真实写盘**副作用：不隔离就会往开发者/CI 的
 * `log/services/app-runtime.log` 里写字（实测 `pnpm test` 会在仓库根新建 `log/`
 * 并多出一行「生成任务已入队 …」）。这里把它整个换成只写临时目录的实例，
 * 让用例的写盘副作用自包含。 */
/* `vi.mock` 会被 hoist 到 imports 之上，因此临时目录必须用 `vi.hoisted`
 * 造（直接引用模块级 const 会踩 TDZ）。 */
const runtimeLogFile = vi.hoisted(() => {
  // `vi.hoisted` 块在 imports 之前求值：这里只用 `process` 拼出唯一路径，
  // 不引入任何模块（目录本身由 `createAppRuntimeLogger` 按需 mkdir）。
  return `${process.env.TMPDIR ?? "/tmp"}/generate-router-log-${process.pid}-${Date.now()}/app-runtime.log`;
});
vi.mock("~/lib/log/app-runtime-log", async (importOriginal) => {
  const actual = await importOriginal<typeof AppRuntimeLogModule>();
  return {
    ...actual,
    createAppRuntimeLogger: (ns: string) =>
      actual.createAppRuntimeLogger(ns, runtimeLogFile),
  };
});

const { kickMock } = vi.hoisted(() => ({
  kickMock: vi.fn<(job: unknown) => void>(() => undefined),
}));

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
vi.mock("~/lib/comfyui/executor-continuation", () => ({
  kickQueue: kickMock,
  subscribe: vi.fn(),
  getLogs: vi.fn(),
  cancelTask: vi.fn(),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { generateRouter } from "~/server/api/routers/generate";
import {
  getTestDb,
  seedUser,
  seedWorkflowTemplate,
} from "../../../../tests/helpers/test-db";
import { errorEnvelope, makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(generateRouter);
const tdb = getTestDb();

const RAW_WF = { nodes: [{ id: "1", type: "KSampler" }] };

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

// ────────────────────────────── 工作流库路径 ──────────────────────────────

describe("generate.generate（工作流库工作流）", () => {
  it("rawJson 工作流：建 QUEUED 任务并入队（workflowInputs 作 overrides）", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-lib",
      userId: "user-a",
      name: "库生图",
      taskType: "T2I",
      rawJson: RAW_WF,
    });
    const res = await createCaller(makeCtx()).generate({
      workflow: "wf-lib",
      prompt: "a cat",
      negative: "blur",
      referenceImages: ["ref.png"],
      workflowInputs: [{ nodeId: "1", name: "text", value: "a cat" }],
    });
    expect(typeof res.taskId).toBe("string");
    const row = tdb.$tables.tasks.find((t) => t.id === res.taskId);
    expect(row).toBeDefined();
    expect(row?.userId).toBe("user-a");
    expect(row?.status).toBe("QUEUED");
    expect(row?.type).toBe("T2I");
    expect(row?.workflowName).toBe("库生图");
    expect(row?.prompt).toBe("a cat");
    expect(row?.negativePrompt).toBe("blur");
    expect(row?.referenceImages).toEqual(["ref.png"]);
    // 3-B1 决定 4：inline 模式建行也**显式**写 claimedBy（NULL 只服务历史行）
    expect(row?.claimedBy).toBe("inline");
    // 执行载荷建行即落库（host 模式共用同一建行形状）
    expect(row?.execPayload).toEqual(RAW_WF);
    // 派发不再经内存 Job（§14 D1 第二刀）：载荷只随行走（上面两条断言：
    // claimedBy=inline 与 execPayload），这里踢一次只是省掉等 2s 节拍。
    expect(kickMock).toHaveBeenCalledTimes(1);
    expect(
      (row?.params as { workflowInputs?: unknown }).workflowInputs,
    ).toEqual([{ nodeId: "1", name: "text", value: "a cat" }]);
  });

  /**
   * 归属列：健康度条要能回答「这一镜出过图吗」，靠的就是建行时这两列。
   * 三条断言各有其因：写了要落库、**没写必须是 NULL 而不是空串**（否则「无归属」
   * 与「归属为空」在库里同一形状，历史行会被误并进统计），以及 shotId 不写时同样落 NULL。
   */
  it("带上 projectId / shotId 时落进归属列，缺省时落 NULL 而不是空串", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-lib",
      userId: "user-a",
      name: "库生图",
      taskType: "T2I",
      rawJson: RAW_WF,
    });
    const attributed = await createCaller(makeCtx()).generate({
      workflow: "wf-lib",
      prompt: "a cat",
      projectId: "proj_1",
      shotId: "shot-3",
    });
    const rowA = tdb.$tables.tasks.find((t) => t.id === attributed.taskId);
    expect(rowA?.projectId).toBe("proj_1");
    expect(rowA?.shotId).toBe("shot-3");

    const bare = await createCaller(makeCtx()).generate({
      workflow: "wf-lib",
      prompt: "a cat",
    });
    const rowB = tdb.$tables.tasks.find((t) => t.id === bare.taskId);
    expect(rowB?.projectId).toBeNull();
    expect(rowB?.shotId).toBeNull();
  });

  it("host 模式（COMFY_EXECUTOR=host）：建 host 归属行 + 落 execPayload，**不**进程内 enqueue", async () => {
    process.env.COMFY_EXECUTOR = "host";
    try {
      seedWorkflowTemplate(tdb, {
        id: "wf-host",
        userId: "user-a",
        name: "host生图",
        taskType: "T2I",
        rawJson: RAW_WF,
      });
      const res = await createCaller(makeCtx()).generate({
        workflow: "wf-host",
        prompt: "a cat",
      });
      // 执行整个让给 host：Next 不驱动这一行。kick 仍然会调一次，但双执行不成立
      // ——领取谓词 ownedBy("inline") 看不见 host 行（由 impl 的 §6 归属组钉住）。
      expect(kickMock).toHaveBeenCalledTimes(1);
      const row = tdb.$tables.tasks.find((t) => t.id === res.taskId);
      expect(row?.status).toBe("QUEUED");
      expect(row?.claimedBy).toBe("host");
      // 载荷随行走：host 不回查模板（模板改/删不影响在队任务）
      expect(row?.execPayload).toEqual(RAW_WF);
    } finally {
      delete process.env.COMFY_EXECUTOR;
    }
  });

  it("工作流不存在 → NOT_FOUND（不入队、不落任务行）", async () => {
    await expect(
      createCaller(makeCtx()).generate({ workflow: "no-such-workflow" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(kickMock).not.toHaveBeenCalled();
    expect(tdb.$tables.tasks).toHaveLength(0);
  });

  it("Zod 校验失败：超长 prompt / 空 workflow → BAD_REQUEST", async () => {
    const caller = createCaller(makeCtx());
    await expect(
      caller.generate({ workflow: "wf-lib", prompt: "x".repeat(2001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.generate({ workflow: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(kickMock).not.toHaveBeenCalled();
    expect(tdb.$tables.tasks).toHaveLength(0);
  });
});

// ────────────────────────────── 工作流库路径（RAW 原件） ──────────────────────────────

describe("generate.generate（RAW 原件执行路径）", () => {
  it("模板 rawJson → comfy-cli 原始执行路径（rawJson + overrides 入队）", async () => {
    const rawJson = { nodes: [{ id: "1", type: "KSampler" }] };
    seedWorkflowTemplate(tdb, {
      id: "wf-raw",
      userId: "user-a",
      taskType: "T2V",
      rawJson,
    });
    const res = await createCaller(makeCtx()).generate({
      workflow: "wf-raw",
      workflowInputs: [{ nodeId: "1", name: "text", value: "hi" }],
    });
    const row = tdb.$tables.tasks.find((t) => t.id === res.taskId);
    expect(row?.type).toBe("T2V");
    // 载荷随行：execPayload 就是模板的 RAW 原件，覆盖项在 params.workflowInputs。
    // 「不再走 /prompt」这条口径现在由 dispatch 只读 execPayload 保证
    // （见 executor-dispatch.test.ts 的「两种载荷都只交 comfy-cli」组）。
    expect(row?.execPayload).toEqual(rawJson);
    expect(
      (row?.params as { workflowInputs?: unknown }).workflowInputs,
    ).toEqual([{ nodeId: "1", name: "text", value: "hi" }]);
  });

  it("边界：模板 rawJson 为空 → 报「没有可执行内容」", async () => {
    /* rawJson 列可空：库里没有原件的行（历史数据 / 手工插行）走不通。 */
    seedWorkflowTemplate(tdb, {
      id: "wf-empty",
      userId: "user-a",
      rawJson: null,
    });
    const env = await errorEnvelope(
      createCaller(makeCtx()).generate({ workflow: "wf-empty" }),
    );
    expect(env.code).toBe("PRECONDITION_FAILED");
    expect(env.message).toContain("没有可执行内容");
    expect(kickMock).not.toHaveBeenCalled();
  });

  it("越权与不存在同形：非本人和不存在的 workflow 给同一个码", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-b",
      userId: "user-b",
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
    });
    await expect(
      createCaller(makeCtx()).generate({ workflow: "wf-b" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createCaller(makeCtx()).generate({ workflow: "wf-missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tdb.$tables.tasks).toHaveLength(0);
  });
});
