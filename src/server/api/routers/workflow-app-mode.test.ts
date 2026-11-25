import type * as LoggerModule from "~/lib/core/logger";
import type * as EnvfileModule from "~/lib/envfile";
import type * as RawModule from "~/lib/comfyui/raw";
import type * as ClientModule from "~/lib/comfyui/client";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";
import type * as ImportSourceModule from "~/lib/comfyui/importSource";
/**
 * App Mode 选引脚三条 procedure 的集成测试（exportForAppMode / applyAppModeSelection /
 * appModeInfo）。mock 面与 workflow-extra-linear-data.test.ts 同形；读文件 / checksum /
 * linearData 映射走真实实现，LOCAL_WORKFLOWS_PATH 指向本用例的临时目录。
 */
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<(args: { headers: Headers }) => Promise<unknown>>(() =>
    Promise.resolve(null),
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
vi.mock("~/lib/comfyui/raw", async (importOriginal) => ({
  ...(await importOriginal<typeof RawModule>()),
  fetchObjectInfo: vi.fn(() => null),
}));
vi.mock("~/lib/comfyui/client", async (importOriginal) => ({
  ...(await importOriginal<typeof ClientModule>()),
  resolveComfyBase: vi.fn(() => Promise.resolve("http://127.0.0.1:8188")),
}));

import { createCallerFactory } from "~/server/api/trpc";
import { workflowRouter } from "~/server/api/routers/workflow";
import { readEnvVar } from "~/lib/envfile";
import { resolveComfyBase } from "~/lib/comfyui/client";
import { isPlainRecord } from "~/lib/is-record";
import { parseWorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import { getTestDb, seedUser, seedWorkflowTemplate } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(workflowRouter);
const tdb = getTestDb();

const ROOT_ID = "6e5d96b7-1687-4e3d-8559-6c3e5468c193";

/** 与映射层测试同构的最小图：9=SaveImage（输出）、23=子图包装（promoted widget）。 */
const RAW_NODES = [
  {
    id: 9,
    type: "SaveImage",
    inputs: [{ name: "images", type: "IMAGE", link: 1 }],
    outputs: [{ name: "images" }],
  },
  {
    id: 23,
    type: "b350fbfc-0ff8-4af1-8d09-09f50d84fcaa",
    inputs: [
      { name: "replace", type: "STRING", widget: { name: "replace" }, link: null },
      { name: "seed", type: "INT", widget: { name: "seed" }, link: null },
    ],
    outputs: [{ name: "IMAGE" }],
  },
];

const RAW_WF = { id: ROOT_ID, last_node_id: 23, last_link_id: 1, nodes: RAW_NODES, links: [] };

async function writeJson(absPath: string, value: unknown): Promise<void> {
  await writeFile(absPath, JSON.stringify(value, null, 2), "utf8");
}

describe("workflow.exportForAppMode", () => {
  let workDir: string;
  beforeEach(() => {
    tdb.$reset();
    vi.clearAllMocks();
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    workDir = mkdtempSync(path.join(tmpdir(), "appmode-export-"));
    vi.mocked(readEnvVar).mockReturnValue(workDir);
  });

  it("新建 ComfyAPP- 前缀文件、补 root id 并登记 sourcePath", async () => {
    const seeded = seedWorkflowTemplate(tdb, {
      id: "wf-export-1",
      userId: "user-a",
      name: "我的出图",
      rawJson: { last_node_id: 23, nodes: RAW_NODES, links: [] },
    });
    const res = await createCaller(makeCtx()).exportForAppMode({ id: "wf-export-1" });
    /* id 短码：去符号取前 8 位 → "wfexport"。 */
    expect(res.fileName).toBe("ComfyAPP-wfexport-我的出图.json");
    expect(res.sourcePath).toBe(path.join(workDir, res.fileName));
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === seeded.id);
    expect(row?.sourcePath).toBe(res.sourcePath);
    expect(row?.sourceChecksum).toBeTruthy();
    /* 原 rawJson 没有根 id → 导出时注入并同批写回模板（深链要用）。 */
    const storedRaw = row?.rawJson;
    const storedId =
      isPlainRecord(storedRaw) && typeof storedRaw.id === "string" ? storedRaw.id : "";
    expect(storedId).not.toBe("");
  });

  it("目标文件已存在 → CONFLICT（绝不覆盖既有文件）", async () => {
    seedWorkflowTemplate(tdb, {
      id: "wf-export-2",
      userId: "user-a",
      name: "撞名",
      rawJson: RAW_WF,
    });
    const fileName = "ComfyAPP-wfexport-撞名.json";
    await writeJson(path.join(workDir, fileName), { already: "there" });
    await expect(
      createCaller(makeCtx()).exportForAppMode({ id: "wf-export-2" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("没有可用的工作流目录 → BAD_REQUEST", async () => {
    vi.mocked(readEnvVar).mockReturnValue(null);
    seedWorkflowTemplate(tdb, { id: "wf-export-3", userId: "user-a", rawJson: RAW_WF });
    await expect(
      createCaller(makeCtx()).exportForAppMode({ id: "wf-export-3" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("workflow.applyAppModeSelection", () => {
  let workDir: string;
  beforeEach(() => {
    tdb.$reset();
    vi.clearAllMocks();
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    workDir = mkdtempSync(path.join(tmpdir(), "appmode-apply-"));
    vi.mocked(readEnvVar).mockReturnValue(workDir);
  });

  it("读回 linearData：映射暴露面、保留幸存键元数据、上报 skipped", async () => {
    const sourcePath = path.join(workDir, "ComfyAPP-apply.json");
    await writeJson(sourcePath, {
      ...RAW_WF,
      extra: {
        linearData: {
          inputs: [
            [`${ROOT_ID}:23:replace`, "replace"],
            [`${ROOT_ID}:23:seed`, "seed"],
            [`${ROOT_ID}:77:ghost`, "ghost"],
          ],
          outputs: ["9"],
        },
      },
    });
    seedWorkflowTemplate(tdb, {
      id: "wf-apply-1",
      userId: "user-a",
      rawJson: RAW_WF,
      sourcePath,
      workflowIO: {
        "23::widget::replace": {
          direction: "input",
          kind: "widget",
          name: "replace",
          nodeId: "23",
          label: "正面提示词",
          required: true,
        },
        "14::widget::megapixels": {
          direction: "input",
          kind: "widget",
          name: "megapixels",
          nodeId: "14",
          label: "百万像素",
        },
      },
    });
    const res = await createCaller(makeCtx()).applyAppModeSelection({ id: "wf-apply-1" });
    expect(res.applied).toBe(3);
    expect(res.skipped).toEqual([
      { kind: "input", reason: "节点 77 不在当前图中", ref: `${ROOT_ID}:77:ghost` },
    ]);
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-apply-1");
    const io = parseWorkflowIOMap(row?.workflowIO);
    /* 幸存键：作者元数据（label/required）保留；落选键移除；新键只带身份字段。 */
    expect(io["23::widget::replace"]?.label).toBe("正面提示词");
    expect(io["23::widget::replace"]?.required).toBe(true);
    expect(io["14::widget::megapixels"]).toBeUndefined();
    expect(io["23::widget::seed"]).toMatchObject({
      direction: "input",
      kind: "widget",
      name: "seed",
      nodeId: "23",
    });
    expect(io["9::output::images"]).toMatchObject({
      direction: "output",
      kind: "output",
      name: "images",
      nodeId: "9",
    });
  });

  it("没有 sourcePath → BAD_REQUEST", async () => {
    seedWorkflowTemplate(tdb, { id: "wf-apply-2", userId: "user-a", rawJson: RAW_WF });
    await expect(
      createCaller(makeCtx()).applyAppModeSelection({ id: "wf-apply-2" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("源文件里没有 linearData → BAD_REQUEST", async () => {
    const sourcePath = path.join(workDir, "ComfyAPP-nolinear.json");
    await writeJson(sourcePath, RAW_WF);
    seedWorkflowTemplate(tdb, {
      id: "wf-apply-3",
      userId: "user-a",
      rawJson: RAW_WF,
      sourcePath,
    });
    await expect(
      createCaller(makeCtx()).applyAppModeSelection({ id: "wf-apply-3" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("源文件不在允许目录内 → BAD_REQUEST", async () => {
    const outside = path.join(tmpdir(), "outside-allowed", "wf.json");
    seedWorkflowTemplate(tdb, {
      id: "wf-apply-4",
      userId: "user-a",
      rawJson: RAW_WF,
      sourcePath: outside,
    });
    await expect(
      createCaller(makeCtx()).applyAppModeSelection({ id: "wf-apply-4" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("workflow.appModeInfo", () => {
  let workDir: string;
  beforeEach(() => {
    tdb.$reset();
    vi.clearAllMocks();
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
    workDir = mkdtempSync(path.join(tmpdir(), "appmode-info-"));
    vi.mocked(readEnvVar).mockReturnValue(workDir);
  });

  it("返回选择规模、文件在位与原生前端地址", async () => {
    const sourcePath = path.join(workDir, "ComfyAPP-info.json");
    await writeJson(sourcePath, {
      ...RAW_WF,
      extra: { linearData: { inputs: [[`${ROOT_ID}:23:replace`, "replace"]], outputs: ["9"] } },
    });
    seedWorkflowTemplate(tdb, {
      id: "wf-info-1",
      userId: "user-a",
      rawJson: RAW_WF,
      sourcePath,
    });
    const res = await createCaller(makeCtx()).appModeInfo({ id: "wf-info-1" });
    expect(res.hasLinearData).toBe(true);
    expect(res.inputCount).toBe(1);
    expect(res.outputCount).toBe(1);
    expect(res.fileMissing).toBe(false);
    expect(res.sourcePath).toBe(sourcePath);
    expect(res.comfyBase).toBe("http://127.0.0.1:8188");
  });

  it("源文件丢了 → fileMissing；原生前端不可达 → comfyBase 为 null", async () => {
    vi.mocked(resolveComfyBase).mockRejectedValueOnce(new Error("实例没起"));
    seedWorkflowTemplate(tdb, {
      id: "wf-info-2",
      userId: "user-a",
      rawJson: RAW_WF,
      sourcePath: path.join(workDir, "gone.json"),
    });
    const res = await createCaller(makeCtx()).appModeInfo({ id: "wf-info-2" });
    expect(res.fileMissing).toBe(true);
    expect(res.hasLinearData).toBe(false);
    expect(res.comfyBase).toBeNull();
  });
});
