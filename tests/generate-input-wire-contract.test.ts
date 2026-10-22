/**
 * 画布构造的载荷 ↔ `generate.generate` 的入参判据（台账 E4 的第四格）。
 *
 * 这一格修之前长这样：客户端把载荷拼成 `Record<string, unknown>`，在传输前塞一句
 * `payload as GenerateInput`；重试那一头把**任务行 `params` 列里存的旧载荷**原样
 * 送回同一个 cast。类型别名本身不是漂移面（`RouterInputs["generate"]["generate"]`
 * 由 schema 反向派生，字段改名会当场编译红），**那两条 cast 才是**：它们让客户端
 * 这一侧在运行时对「线上要什么形状」一无所知，于是少一个必填键、发一个服务端已经
 * 不收的旧字段，全都到服务端才炸，而界面上只剩一句「生成失败」。
 *
 * 所以这里判的是四件事，缺一不可：
 *   ① 画布**真构造出来的那一形**被**真 router** 收下，并原样落进 `params` 列
 *      （不造夹具载荷 —— 造一份「我以为画布会拼出什么」就等于把「两边各测各的」
 *      那个老毛病搬进判据自己家里）；
 *   ② 缺必填 `workflow` 时，router 与客户端预检**同一份判据同拒**（这条挡的是
 *      「画布那条界面 guard 撤掉之后没人拦」—— 拒的信号必须来自 schema 而不是 guard）；
 *   ③ 从库里翻出来的载荷再走一次入参判据仍然过，而且**第二次真建得出任务**
 *      （重试的幂等前提：写进去的是转换之后的形状，读出来直接重发）；
 *   ④ 旧形状被拒时给的是能读的中文，而不是 zod 的英文原文。
 *
 * mock 边界与同族那份（`tests/task-detail-images-wire-contract.test.ts`）同一套：
 * 只替传输层的依赖（内存库、会话、日志、派发），router、仓储、入参 schema、
 * 画布那侧的三个映射助手全部真实跑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";
import type * as AppRuntimeLogModule from "~/lib/log/app-runtime-log";

import { buildCanvasGeneratePayload } from "~/components/studio/project-canvas/CanvasNode/generate-payload";
import type { WorkflowIOMap } from "~/components/studio/workflow-io";
import type { CanvasNodeData } from "~/lib/project-canvas/canvas-types";
import { defaultData } from "~/lib/project-canvas/canvas-types";
import {
  generateInputSchema,
  parseGenerateInput,
} from "~/lib/workflow/workflow-generate-input";
import { createCallerFactory } from "~/server/api/trpc";
import { generateRouter } from "~/server/api/routers/generate";
import { getTestDb, seedUser, seedWorkflowTemplate } from "./helpers/test-db";
import { errorEnvelope, makeCtx } from "./helpers/trpc";
import { throughJsonWire } from "./helpers/wire-contract";

/* 里程碑日志（`createAppRuntimeLogger("generate")`）是**真实写盘**副作用：不隔离
 * 就会往仓库根的 `log/` 里写一行「生成任务已入队…」。换成本进程专用的临时目录，
 * 口径与 `src/server/api/routers/generate.test.ts` 同一份。 */
const runtimeLogFile = vi.hoisted(
  () =>
    `${process.env.TMPDIR ?? "/tmp"}/generate-input-contract-${process.pid}-${Date.now()}/app-runtime.log`,
);
vi.mock("~/lib/log/app-runtime-log", async (importOriginal) => {
  const actual = await importOriginal<typeof AppRuntimeLogModule>();
  return {
    ...actual,
    createAppRuntimeLogger: (ns: string) =>
      actual.createAppRuntimeLogger(ns, runtimeLogFile),
  };
});
vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
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
  kickQueue: vi.fn(),
  subscribe: vi.fn(),
  getLogs: vi.fn(),
  cancelTask: vi.fn(),
}));

const createCaller = createCallerFactory(generateRouter);
const tdb = getTestDb();

const WORKFLOW_ID = "wf-canvas";

/** 作者勾选的两个对外口（`ioKey` 的形态与线上真实一致：`<节点>::<种类>::<端口>`）。 */
const WF_IO: WorkflowIOMap = {
  "1::widget::text": {
    direction: "input",
    kind: "widget",
    nodeId: "1",
    name: "text",
    label: "提示词",
  },
  "1::widget::seed": {
    direction: "input",
    kind: "widget",
    nodeId: "1",
    name: "seed",
  },
};

/** 画布上一个「选了工作流、填了参数、上游还有一张图」的节点。 */
function canvasNode(over: Partial<CanvasNodeData> = {}): CanvasNodeData {
  return {
    ...defaultData("workflow"),
    workflowId: WORKFLOW_ID,
    workflowInputs: { "1::widget::text": "一只猫", "1::widget::seed": 7 },
    seedModes: { "1::widget::seed": "random" },
    inputImage: "up.png",
    ...over,
  };
}

/** 走完整构造（节点数据 → 入参），不做任何提交。 */
function canvasPayload(over: Partial<CanvasNodeData> = {}) {
  return buildCanvasGeneratePayload({
    d: canvasNode(over),
    wfIO: WF_IO,
    projectId: "proj-1",
  });
}

/** 构造 + 交给真 router。 */
async function submitCanvas(over: Partial<CanvasNodeData> = {}) {
  const input = canvasPayload(over);
  return { input, res: await createCaller(makeCtx()).generate(input) };
}

/** 取任务行的 `params` 列，过一次 JSON（库里它是 JSON 文本：值为 `undefined`
 *  的键在文本里根本不存在 —— 拿进程内那个对象测，测的是「写进去什么就读出什么」
 *  这句废话，而不是线上那份形状）。 */
function storedParams(taskId: string): unknown {
  const row = tdb.$tables.tasks.find((task) => task.id === taskId);
  return throughJsonWire<unknown>(row?.params);
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedWorkflowTemplate(tdb, {
    id: WORKFLOW_ID,
    userId: "user-a",
    name: "画布生图",
    taskType: "T2I",
    rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
  });
});

describe("画布载荷 ⇄ generate 的入参判据", () => {
  it("画布构造出的那一形被真 router 收下，并原样落进 params 列", async () => {
    const { input, res } = await submitCanvas();
    expect(typeof res.taskId).toBe("string");
    /* 构造出的形状本身就过判据（这一步还不经过传输，先把「客户端以为的合法」钉住）。 */
    expect(generateInputSchema.safeParse(input).success).toBe(true);

    const stored = throughJsonWire<Record<string, unknown>>(
      storedParams(res.taskId),
    );
    expect(stored.workflow).toBe(WORKFLOW_ID);
    expect(stored.inputImage).toBe("up.png");
    expect(stored.projectId).toBe("proj-1");
    expect(stored.referenceImages).toEqual(["up.png"]);
    expect(stored.workflowInputs).toEqual([
      { nodeId: "1", name: "text", value: "一只猫" },
      { nodeId: "1", name: "seed", value: 7 },
      /* 种子的「生成后控制」必须并进同一数组：单独下发会被入参判据剥掉，
       * 表现是「选了 random 却永远固定同一个种子」。前端词表 random →
       * ComfyUI 词表 randomize 的换算也在构造这一步完成。 */
      { nodeId: "1", name: "control_after_generate", value: "randomize" },
    ]);
  });

  it("缺必填 `workflow`：router 与客户端预检按同一份 schema 同拒", async () => {
    /* 画布上「还没选工作流」时 `runGenerate` 自己会先拦一句，但那是**界面**的 guard；
     * 撤掉它这条通路不能裸奔 —— 拒的信号必须来自 schema，而不是来自 guard。 */
    const input = canvasPayload({ workflowId: undefined });
    expect(input.workflow).toBe("");
    expect(generateInputSchema.safeParse(input).success).toBe(false);
    /* 逐维比而不是 `toEqual({ok:false, message: expect.stringContaining(…)})`：
     * 后者让 `message` 那格退化成 `any`，而这一条判的正是「文案里点名了缺哪一列」。 */
    const rejected = parseGenerateInput(input);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("这一形必须被拒");
    expect(rejected.message).toContain("缺少要执行的工作流");
    /* 码与文案两维一起取（`errorEnvelope` 的理由就在这里：只比消息的话，
     * 「参数不对」与「工作流不存在」可以是同一句）。 */
    const envelope = await errorEnvelope(
      createCaller(makeCtx()).generate(input),
    );
    expect(envelope.code).toBe("BAD_REQUEST");
    expect(envelope.message).toContain("缺少要执行的工作流");
    expect(tdb.$tables.tasks).toHaveLength(0);
  });

  it("从库里翻出来的载荷再判一次仍然过，第二次真建得出任务", async () => {
    const { res } = await submitCanvas();
    const parsed = parseGenerateInput(storedParams(res.taskId));
    if (!parsed.ok) throw new Error(`预检意外失败：${parsed.message}`);
    const again = await createCaller(makeCtx()).generate(parsed.input);
    expect(typeof again.taskId).toBe("string");
    /* 两次的载荷只差归属之外的部分：幂等判的是「同形状再过一次」，不是「大概能过」。 */
    expect(
      throughJsonWire<Record<string, unknown>>(storedParams(again.taskId))
        .workflow,
    ).toBe(WORKFLOW_ID);
  });

  it("旧形状被拒时给的是能读的中文，不是 zod 的英文原文", () => {
    /* `workflowInputs` 在历史行里有过写成对象的（库里那一列是自由 JSON 文本）。
     * 过去的表现是服务端 BAD_REQUEST 的 flatten 原文（`Expected array, received
     * object`）直接进错误面板 —— 用户分不清是「我配的参数不对」还是「这条记录老了」。 */
    const parsed = parseGenerateInput({
      workflow: WORKFLOW_ID,
      workflowInputs: { "1::widget::text": "一只猫" },
    });
    if (parsed.ok) throw new Error("这一形必须被拒");
    expect(parsed.message).toContain("workflowInputs");
    expect(parsed.message).toContain("没有发出去");
    /* 出路要落在用户做得出的动作上，而不只是「参数错误」。 */
    expect(parsed.message).toContain("重新配置参数");
  });

  it("三层 `paramMap`（`source.mode:<模式>`）仍然收 —— 那一列的权威形状只有一份", () => {
    /* 这一列此前在入参上写作 `z.record(z.string(), z.string())`（一层 key → string），
     * 表达不了库里真实的按模式归拢的三层结构。它复用的是
     * `~/lib/workflow/workflow-param-map` 那一份权威 schema；判它**在入参通路上也生效**，
     * 才挡得住「有人在 generate 这边又收窄一次」。 */
    const paramMap = {
      source: { "mode:T2I": { "1::widget::text": "1::widget::text" } },
      positiveNode: "历史命名空间，原样保留",
    };
    const parsed = parseGenerateInput({
      workflow: WORKFLOW_ID,
      workflowInputs: [{ nodeId: "1", name: "text", value: "一只猫" }],
      paramMap,
    });
    if (!parsed.ok) throw new Error(`不该被拒：${parsed.message}`);
    expect(parsed.input.paramMap).toEqual(paramMap);
  });
});
