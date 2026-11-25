import type * as LoggerModule from "~/lib/core/logger";
import type * as EnvfileModule from "~/lib/envfile";
import type * as RawModule from "~/lib/comfyui/raw";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";
import type * as ImportSourceModule from "~/lib/comfyui/importSource";
/**
 * rawJson 的 `extra` 字段 round-trip 测试：ComfyUI 前端 App Mode 把「选中的输入/输出引脚」
 * 写进工作流 JSON 的 `extra.linearData`（随 RAW 原件保存）。应用要靠这个字段把
 * 「原生界面里选的引脚」读回 `workflowIO`，所以导入（create）与保存（update）两条链
 * 都必须原样保留 `extra`，任何一处重建对象时丢字段，App Mode 的选择就会静默消失。
 * mock 面与 workflow.test.ts 同形（db / auth / logger / envfile / 设置 / importSource /
 * fetchObjectInfo），只测真实实现的数据保真，不测转换器。
 */
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
/* 本机 app-settings.json 各不相同：清空 comfyuiPath，让判据不随开发机安装漂。 */
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

import { createCallerFactory } from "~/server/api/trpc";
import { workflowRouter } from "~/server/api/routers/workflow";
import { getTestDb, seedUser } from "../../../../tests/helpers/test-db";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(workflowRouter);
const tdb = getTestDb();

/** App Mode 写进 `extra.linearData` 的形状（inputs: [widgetId, name, config?]，outputs: nodeId[]）。
 *  widgetId 的规范格式由映射层单独钉住，这里只关心「整包 extra 原样进出」。 */
const LINEAR_DATA = {
  inputs: [
    ["6:0", "text", { widget: "textarea" }],
    ["3:seed", "seed"],
  ],
  outputs: ["9"],
};

/** 一份带 App Mode 选择结果的最小 RAW 工作流。 */
const RAW_WF_WITH_EXTRA = {
  last_node_id: 3,
  last_link_id: 0,
  nodes: [
    { id: 1, type: "CheckpointLoaderSimple", pos: [10, 20] },
    { id: 2, type: "CLIPTextEncode", pos: [30, 40] },
    { id: 3, type: "KSampler", pos: [50, 60] },
  ],
  links: [],
  extra: { linearData: LINEAR_DATA },
};

describe("rawJson extra.linearData round-trip（App Mode 引脚选择随 RAW 原件进出）", () => {
  beforeEach(() => {
    tdb.$reset();
    seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  });

  it("create：extra.linearData 随 RAW 原件逐字落库", async () => {
    const res = await createCaller(makeCtx()).create({ raw: RAW_WF_WITH_EXTRA });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === res.id);
    expect(row).toBeDefined();
    /* 用匹配器直接读 unknown，不靠不安全断言把 rawJson 收窄。 */
    expect(row?.rawJson).toMatchObject({ extra: { linearData: LINEAR_DATA } });
  });

  it("update（positions 合并路径重建 rawJson）：extra.linearData 不被写丢", async () => {
    const created = await createCaller(makeCtx()).create({ raw: RAW_WF_WITH_EXTRA });
    await createCaller(makeCtx()).update({
      id: created.id,
      name: "改名不改图",
      positions: { "1": [100, 200] },
    });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === created.id);
    /* 用匹配器直接读 unknown，不靠不安全断言把 rawJson 收窄。 */
    expect(row?.rawJson).toMatchObject({ extra: { linearData: LINEAR_DATA } });
    expect(row?.name).toBe("改名不改图");
  });

  it("update（显式 rawJson）：新原件里的 extra.linearData 原样保留", async () => {
    const created = await createCaller(makeCtx()).create({ raw: RAW_WF_WITH_EXTRA });
    const nextRaw = {
      ...RAW_WF_WITH_EXTRA,
      nodes: [{ id: 1, type: "CheckpointLoaderSimple", pos: [0, 0] }],
      extra: { linearData: { inputs: [["7:1", "image"]], outputs: ["9", "10"] } },
    };
    await createCaller(makeCtx()).update({ id: created.id, rawJson: nextRaw });
    const row = tdb.$tables.workflowTemplates.find((r) => r.id === created.id);
    expect(row?.rawJson).toEqual(nextRaw);
  });
});
