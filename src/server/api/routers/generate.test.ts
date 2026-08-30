import type * as LoggerModule from "~/server/lib/logger";
/**
 * generate.router 集成测试。
 *
 * mock 边界：~/server/db（内存 Prisma 替身）、~/server/better-auth、
 * ~/server/lib/logger（静音）、@/lib/comfyui/runner（enqueue 整体 mock——
 * 真模块 import 时会启动 reaper 定时器并连 ComfyUI WS）、
 * @/lib/comfyui/client（listModels 需访问 ComfyUI /api/models）。
 * buildAndValidate / buildCustomWorkflow / getWorkflow / repository 均走真实实现。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const { enqueueMock, listModelsMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn<(job: unknown) => void>(() => undefined),
  listModelsMock: vi.fn<(folder: string) => Promise<string[]>>(async () => []),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
}));
vi.mock("~/server/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/comfyui/runner", () => ({
  enqueue: enqueueMock,
  subscribe: vi.fn(),
  getLogs: vi.fn(),
  cancelTask: vi.fn(),
}));
vi.mock("@/lib/comfyui/client", () => ({ listModels: listModelsMock }));

import { createCallerFactory } from "~/server/api/trpc";
import { generateRouter } from "~/server/api/routers/generate";
import { getTestDb, seedUser, seedWorkflowTemplate } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(generateRouter);
const tdb = getTestDb();

const CUSTOM_GRAPH = {
  "1": { class_type: "CLIPTextEncode", inputs: { text: "seed text" } },
  "2": { class_type: "KSampler", inputs: { seed: 1, steps: 4 } },
};

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
});

// ────────────────────────────── 内置模板路径 ──────────────────────────────

describe("generate.generate（内置工作流）", () => {
  it("txt2img：建 QUEUED 任务并入队（prompt 由模板真实构建）", async () => {
    const res = await createCaller(makeCtx()).generate({
      workflow: "txt2img",
      prompt: "a cat",
      negative: "blur",
      count: 2,
      referenceImages: ["ref.png"],
    });
    expect(typeof res.taskId).toBe("string");
    const row = tdb.$tables.tasks.find((t) => t.id === res.taskId);
    expect(row).toBeDefined();
    expect(row?.userId).toBe("user-a");
    expect(row?.status).toBe("QUEUED");
    expect(row?.type).toBe("TXT2IMG"); // 内置模板 taskType
    expect(row?.workflowName).toBe("txt2img");
    expect(row?.prompt).toBe("a cat");
    expect(row?.negativePrompt).toBe("blur");
    expect(row?.referenceImages).toEqual(["ref.png"]);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const job = enqueueMock.mock.calls[0]?.[0] as {
      taskId: string;
      prompt?: Record<string, unknown>;
    };
    expect(job.taskId).toBe(res.taskId);
    expect(job.prompt && Object.keys(job.prompt).length).toBeGreaterThan(0);
  });

  it("checkpoint 不在 listModels 列表 → 构建失败并抛错（不入队）", async () => {
    listModelsMock.mockResolvedValue(["real.safetensors"]);
    await expect(
      createCaller(makeCtx()).generate({
        workflow: "txt2img",
        checkpoint: "other.safetensors",
      })
    ).rejects.toThrow("模型不可用或文件名不匹配");
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(tdb.$tables.tasks).toHaveLength(0);
  });

  it("Zod 校验失败：steps/count/超长 prompt/非法 loras → BAD_REQUEST", async () => {
    const caller = createCaller(makeCtx());
    await expect(
      caller.generate({ workflow: "txt2img", steps: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.generate({ workflow: "txt2img", count: 9 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.generate({ workflow: "txt2img", prompt: "x".repeat(2001) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 运行时缺 weight 字段 → Zod 校验失败（类型层刻意绕过以构造非法输入）
    const badLora = { name: "a" } as unknown as { name: string; weight: number };
    await expect(
      caller.generate({ workflow: "txt2img", loras: [badLora] })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.generate({ workflow: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(tdb.$tables.tasks).toHaveLength(0);
  });
});

// ────────────────────────────── 自定义工作流路径 ──────────────────────────────

describe("generate.generate（自定义工作流）", () => {
  it("canvasGraph：经 buildCustomWorkflow 回填 prompt/seed/steps 并入队", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-1",
      userId: "user-a",
      name: "My Custom",
      taskType: "T2I",
      graph: CUSTOM_GRAPH,
    });
    const res = await createCaller(makeCtx()).generate({
      workflow: "wf-1",
      prompt: "hello",
      canvasGraph: CUSTOM_GRAPH,
      paramMap: { positiveNode: "1", samplerNode: "2" },
      steps: 5,
      seed: 42,
    });
    const row = tdb.$tables.tasks.find((t) => t.id === res.taskId);
    expect(row?.type).toBe("T2I");
    expect(row?.workflowName).toBe("My Custom");
    const job = enqueueMock.mock.calls[0]?.[0] as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(job.prompt["1"]?.inputs.text).toBe("hello");
    expect(job.prompt["2"]?.inputs.steps).toBe(5);
    expect(job.prompt["2"]?.inputs.seed).toBe(42);
  });

  it("模板 rawJson（无 canvasGraph）→ comfy-cli 原始执行路径（rawJson + overrides 入队）", async () => {
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
    const job = enqueueMock.mock.calls[0]?.[0] as {
      taskId: string;
      rawJson?: unknown;
      overrides?: unknown;
      prompt?: unknown;
    };
    expect(job.rawJson).toEqual(rawJson);
    expect(job.overrides).toEqual([{ nodeId: "1", name: "text", value: "hi" }]);
    expect(job.prompt).toBeUndefined();
  });

  it("仅有 canvasGraph、无模板 → 仍可执行（默认 TXT2IMG / 以输入为名）", async () => {
    const res = await createCaller(makeCtx()).generate({
      workflow: "unknown-wf",
      prompt: "hi",
      canvasGraph: CUSTOM_GRAPH,
    });
    const row = tdb.$tables.tasks.find((t) => t.id === res.taskId);
    expect(row?.type).toBe("TXT2IMG");
    expect(row?.workflowName).toBe("unknown-wf");
    expect(row?.userId).toBe("user-a");
  });

  it("边界：模板 graph/rawJson 均为空且无 canvasGraph → 'Workflow graph is empty'", async () => {
    seedWorkflowTemplate(tdb, { id: "wf-empty", userId: "user-a", graph: null });
    await expect(
      createCaller(makeCtx()).generate({ workflow: "wf-empty" })
    ).rejects.toThrow("Workflow graph is empty");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("越权/不存在：非本人且不存在的 workflow → 'Workflow not found'", async () => {
    seedWorkflowTemplate(tdb, { id: "wf-b", userId: "user-b", graph: CUSTOM_GRAPH });
    await expect(
      createCaller(makeCtx()).generate({ workflow: "wf-b", canvasGraph: undefined })
    ).rejects.toThrow("Workflow not found");
    await expect(
      createCaller(makeCtx()).generate({ workflow: "wf-missing" })
    ).rejects.toThrow("Workflow not found");
    expect(tdb.$tables.tasks).toHaveLength(0);
  });
});
