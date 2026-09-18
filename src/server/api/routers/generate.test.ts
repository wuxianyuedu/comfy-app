import type * as LoggerModule from "~/lib/core/logger";
/**
 * generate.router 集成测试。
 *
 * mock 边界：~/server/db（内存 Prisma 替身）、~/server/better-auth、
 * ~/lib/core/logger（静音）、~/lib/comfyui/enqueue（enqueue 整体 mock——
 * 真模块 import 时会启动 reaper 定时器并连 ComfyUI WS）、
 * `buildCustomWorkflow` / repository 均走真实实现（内置模板 + token 替换已移除，
 * 故不再 mock `~/lib/comfyui/client` 的 listModels）。
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

const { enqueueMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn<(job: unknown) => void>(() => undefined),
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
vi.mock("~/lib/comfyui/enqueue", () => ({
  enqueue: enqueueMock,
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

// ────────────────────────────── 工作流库路径 ──────────────────────────────

describe("generate.generate（工作流库工作流）", () => {
  it("rawJson 工作流：建 QUEUED 任务并入队（workflowInputs 作 overrides）", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-lib",
      userId: "user-a",
      name: "库生图",
      taskType: "T2I",
      graph: CUSTOM_GRAPH,
      rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
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
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const job = enqueueMock.mock.calls[0]?.[0] as {
      taskId: string;
      rawJson?: unknown;
      overrides?: unknown;
    };
    expect(job.taskId).toBe(res.taskId);
    expect(job.rawJson).toBeDefined();
    expect(job.overrides).toEqual([
      { nodeId: "1", name: "text", value: "a cat" },
    ]);
  });

  it("工作流不存在且无 canvasGraph → 抛 Workflow not found（不入队）", async () => {
    await expect(
      createCaller(makeCtx()).generate({ workflow: "no-such-workflow" }),
    ).rejects.toThrow("Workflow not found");
    expect(enqueueMock).not.toHaveBeenCalled();
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
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(tdb.$tables.tasks).toHaveLength(0);
  });
});

// ────────────────────────────── 自定义工作流路径 ──────────────────────────────

describe("generate.generate（自定义工作流）", () => {
  it("canvasGraph：经 buildCustomWorkflow 回填 prompt 并入队", async () => {
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
    });
    const row = tdb.$tables.tasks.find((t) => t.id === res.taskId);
    expect(row?.type).toBe("T2I");
    expect(row?.workflowName).toBe("My Custom");
    const job = enqueueMock.mock.calls[0]?.[0] as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(job.prompt["1"]?.inputs.text).toBe("hello");
  });

  it("canvasGraph + workflowInputs：同一份数组也进 overrides（执行点再兜一遍前端专有控件）", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-ov",
      userId: "user-a",
      name: "My Custom",
      taskType: "T2I",
      graph: CUSTOM_GRAPH,
    });
    await createCaller(makeCtx()).generate({
      workflow: "wf-ov",
      prompt: "hello",
      canvasGraph: CUSTOM_GRAPH,
      paramMap: { positiveNode: "1", samplerNode: "2" },
      workflowInputs: [{ nodeId: "1", name: "text", value: "hello" }],
    });

    const job = enqueueMock.mock.calls[0]?.[0] as {
      overrides?: unknown;
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    /* 结构注入（buildCustomWorkflow）与执行点注入（applyApiOverrides）吃同一份
     * 数组 —— 后者负责 control_after_generate 这类「不入载荷」的前端控件。 */
    expect(job.overrides).toEqual([
      { nodeId: "1", name: "text", value: "hello" },
    ]);
    expect(job.prompt["1"]?.inputs.text).toBe("hello");
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

  it("边界：模板 graph/rawJson 均为空且无 canvasGraph → 报「没有可执行内容」", async () => {
    // graph 列 NOT NULL，「空图」在库里的形态就是空对象 {}
    seedWorkflowTemplate(tdb, { id: "wf-empty", userId: "user-a", graph: {} });
    await expect(
      createCaller(makeCtx()).generate({ workflow: "wf-empty" }),
    ).rejects.toThrow("工作流没有可执行内容");
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("越权/不存在：非本人且不存在的 workflow → 'Workflow not found'", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-b",
      userId: "user-b",
      graph: CUSTOM_GRAPH,
    });
    await expect(
      createCaller(makeCtx()).generate({
        workflow: "wf-b",
        canvasGraph: undefined,
      }),
    ).rejects.toThrow("Workflow not found");
    await expect(
      createCaller(makeCtx()).generate({ workflow: "wf-missing" }),
    ).rejects.toThrow("Workflow not found");
    expect(tdb.$tables.tasks).toHaveLength(0);
  });
});
