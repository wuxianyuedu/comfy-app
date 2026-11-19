/**
 * workflow.updateFromJson / resync 的连线保持与断线报告契约（#4377）：
 *  1) 在线工作流从新 JSON 更新：rawJson 替换；新图里仍存在的端口连线原样保留；
 *     消失的连线摘除并逐条上报（broken），workflowIO 的逐口编辑同样保持 / 摘除；
 *  2) 本地工作流不走该入口（PRECONDITION_FAILED，提示用「同步」）；
 *  3) 非法 JSON → BAD_REQUEST；不存在的 id → NOT_FOUND；
 *  4) 本地工作流 resync：磁盘文件更新后同步，同样上报断线并清洗连线。
 * 真 router + 内存 SQLite（tests/helpers/test-db），与同族路由测试同一套 mock 边界。
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { workflowMutationProcedures } from "~/server/api/routers/workflow-mutations";
import { getTestDb, seedUser, seedWorkflowTemplate } from "../../../../tests/helpers/test-db";
import { makeCtx, errorEnvelope } from "../../../../tests/helpers/trpc";

const router = createTRPCRouter({ ...workflowMutationProcedures });
const createCaller = createCallerFactory(router);
const caller = () => createCaller(makeCtx());
const tdb = getTestDb();
const USER = "user-a";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(tmpdir(), "wf-update-"));
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: USER, email: "a@test.dev" });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** 旧图：节点 1（KSampler）+ 节点 9（SaveImage，新版本里会被删）。 */
const OLD_RAW = {
  nodes: [
    {
      id: 1,
      type: "KSampler",
      inputs: [
        { name: "model", type: "MODEL", link: 1 },
        { name: "seed", type: "INT", widget: { name: "seed" }, link: null },
      ],
      outputs: [{ name: "LATENT", type: "LATENT", links: [2] }],
    },
    {
      id: 9,
      type: "SaveImage",
      inputs: [{ name: "images", type: "IMAGE", link: 2 }],
      outputs: [],
    },
  ],
  links: [
    [1, 2, 0, 1, 0, "MODEL"],
    [2, 1, 0, 9, 0, "IMAGE"],
  ],
};

/** 新图：节点 9 被删（SaveImage 的连线断），节点 1 与 seed 保留。 */
const NEW_RAW = {
  nodes: [
    {
      id: 1,
      type: "KSampler",
      inputs: [{ name: "seed", type: "INT", widget: { name: "seed" }, link: null }],
      outputs: [{ name: "LATENT", type: "LATENT", links: null }],
    },
  ],
  links: [],
};

const PARAM_MAP = {
  source: {
    "mode:T2I": {
      seed: "1::widget::seed",
      images: "9::param::images",
    },
  },
  output: { "mode:T2I": { latent: "1::output::LATENT" } },
};

const WORKFLOW_IO = {
  "1::widget::seed": { nodeId: "1", name: "seed", kind: "widget", direction: "input" },
  "9::param::images": { nodeId: "9", name: "images", kind: "param", direction: "input" },
};

function seedOnlineWorkflow(id: string) {
  return seedWorkflowTemplate(tdb, {
    id,
    userId: USER,
    name: "在线工作流",
    taskType: "T2I",
    rawJson: OLD_RAW,
    paramMap: PARAM_MAP,
    workflowIO: WORKFLOW_IO,
    sourcePath: null,
  });
}

describe("workflow.updateFromJson（#4377）", () => {
  it("在线工作流更新：rawJson 替换，存活连线保留、断线摘除并上报", async () => {
    seedOnlineWorkflow("wf-online");
    const res = await caller().updateFromJson({ id: "wf-online", raw: NEW_RAW });

    expect(res.updated).toBe(true);
    /* 断线逐条上报：SaveImage 节点被删，images 落点断开。 */
    expect(res.broken).toEqual([
      { namespace: "mode:T2I", entryId: "images", ioKey: "9::param::images" },
    ]);
    expect(res.droppedIOKeys).toEqual(["9::param::images"]);

    /* 库里的 rawJson 已替换；paramMap 只保留存活连线；workflowIO 同步清洗。 */
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-online");
    expect(row?.rawJson).toEqual(NEW_RAW);
    expect(row?.paramMap).toEqual({
      source: { "mode:T2I": { seed: "1::widget::seed" } },
      output: { "mode:T2I": { latent: "1::output::LATENT" } },
    });
    expect(row?.workflowIO).toEqual({
      "1::widget::seed": WORKFLOW_IO["1::widget::seed"],
    });
  });

  it("本地工作流不走该入口（提示用「同步」）", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "wf-update-local-"));
    const sourcePath = path.join(dir, "wf.json");
    await fs.writeFile(sourcePath, JSON.stringify(OLD_RAW));
    seedWorkflowTemplate(tdb, {
      id: "wf-local",
      userId: USER,
      name: "本地工作流",
      rawJson: OLD_RAW,
      sourcePath,
      sourceMtime: 1000,
    });

    const env = await errorEnvelope(caller().updateFromJson({ id: "wf-local", raw: NEW_RAW }));
    expect(env.code).toBe("PRECONDITION_FAILED");
  });

  it("非法 JSON → BAD_REQUEST；不存在的 id → NOT_FOUND", async () => {
    seedOnlineWorkflow("wf-bad");
    const bad = await errorEnvelope(caller().updateFromJson({ id: "wf-bad", raw: { nodes: [] } }));
    expect(bad.code).toBe("BAD_REQUEST");

    const missing = await errorEnvelope(caller().updateFromJson({ id: "no-such", raw: NEW_RAW }));
    expect(missing.code).toBe("NOT_FOUND");
  });
});

describe("workflow.resync 的断线报告（#4377）", () => {
  it("本地工作流同步后：消失端口的连线摘除并上报", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "wf-resync-"));
    const sourcePath = path.join(dir, "wf.json");
    await fs.writeFile(sourcePath, JSON.stringify(OLD_RAW));
    seedWorkflowTemplate(tdb, {
      id: "wf-sync",
      userId: USER,
      name: "本地可同步",
      rawJson: OLD_RAW,
      paramMap: PARAM_MAP,
      workflowIO: WORKFLOW_IO,
      sourcePath,
      sourceMtime: Math.floor(Date.now() / 1000) - 60,
    });
    /* 磁盘文件更新为新版本（节点 9 被删）。 */
    await fs.writeFile(sourcePath, JSON.stringify(NEW_RAW));

    const res = await caller().resync({ id: "wf-sync" });
    expect(res.updated).toBe(true);
    expect(res.broken).toEqual([
      { namespace: "mode:T2I", entryId: "images", ioKey: "9::param::images" },
    ]);

    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-sync");
    expect(row?.paramMap).toEqual({
      source: { "mode:T2I": { seed: "1::widget::seed" } },
      output: { "mode:T2I": { latent: "1::output::LATENT" } },
    });
  });
});
