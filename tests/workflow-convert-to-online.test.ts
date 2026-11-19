/**
 * 本地工作流一键转在线（ISSUE #4372）的行为契约。转换 = 解除磁盘跟踪
 * （sourcePath / sourceMtime / sourceChecksum 置空），内容以库中当前版本为准：
 * 1) 本地行转换后三字段置空，名称 / rawJson / 工坊封装等其余列原样保留；
 * 2) 转换后 `workflow.list` 里该行归为「在线」，磁盘原文件落入 localPending
 *    （未载入池）—— 这正是用户诉求「原有的本地工作流变为未载入状态」的判据；
 * 3) 已是在线的行重复转换幂等（converted:false，不写库）；
 * 4) 不存在的 id / 他人（越权）行 → NOT_FOUND。
 * 全部走真 router + 内存 SQLite（tests/helpers/test-db），目录推导用真实
 * deriveComfyuiWorkflowsDir（临时目录搭出 ComfyUI/user/default/workflows 布局）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";

const { getSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(() => ({ comfyuiPath: "" })),
}));

/* mock 边界的实现体在 ./helpers/wire-mock-boundary（与同族测试共用一份），
 * 这里只留 vi.mock 声明（vitest 会 hoist 到 import 之前）。 */
vi.mock("~/server/db", async () => {
  const { dbMockBoundary } = await import("./helpers/wire-mock-boundary");
  return dbMockBoundary();
});
vi.mock("~/server/better-auth", async () => {
  const { sessionMockBoundary } = await import("./helpers/wire-mock-boundary");
  return sessionMockBoundary();
});
vi.mock("~/lib/core/logger", async (importOriginal) => {
  const { loggerMockBoundary } = await import("./helpers/wire-mock-boundary");
  return loggerMockBoundary(await importOriginal<typeof LoggerModule>());
});
/* 设置只回本用例关心的那一格（comfyuiPath），故意不满型 —— 就地行级豁免
 * （B5 清账：文件级豁免收到行级）。 */
vi.mock("~/lib/app-settings/app-settings.server", async (importOriginal) => {
  const mod = await importOriginal<typeof AppSettingsModule>();
  return {
    ...mod,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    getSettingsSync: getSettingsMock as unknown as typeof mod.getSettingsSync,
  };
});
/* 不读真实 .env：否则本机 LOCAL_WORKFLOWS_PATH 会把真实目录扫进 localPending，
 * 污染「localPending 恰好含这一个文件」的断言。 */
vi.mock("~/lib/envfile", () => ({ readEnvVar: () => null }));

import { createCallerFactory } from "~/server/api/trpc";
import { workflowRouter } from "~/server/api/routers/workflow";
import { getTestDb, seedUser, seedWorkflowTemplate } from "./helpers/test-db";
import { errorEnvelope, makeCtx } from "./helpers/trpc";

const createCaller = createCallerFactory(workflowRouter);
const tdb = getTestDb();
const USER = "user-a";

const RAW = { nodes: [{ id: "1", type: "KSampler" }] };

let workflowsDir = "";

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  /* 搭一个真实存在的 ComfyUI 工作流目录：<root>/ComfyUI/user/default/workflows。
   * deriveComfyuiWorkflowsDir 按「root 优先、root/ComfyUI 回退」逐个试存在性，
   * 这里让第二个候选命中 —— 推导逻辑本身不被 mock，扫得出才算数。 */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wf-convert-"));
  const comfyuiRoot = path.join(home, "comfyui-root");
  workflowsDir = path.join(comfyuiRoot, "ComfyUI", "user", "default", "workflows");
  fs.mkdirSync(workflowsDir, { recursive: true });
  getSettingsMock.mockReturnValue({ comfyuiPath: comfyuiRoot });
  seedUser(tdb, { id: USER, email: "a@test.dev" });
});

/** 造一个绑定磁盘文件的本地工作流：文件真实存在于扫描根下。 */
function seedLocalWorkflow(id: string, name: string) {
  const sourcePath = path.join(workflowsDir, `${name}.json`);
  fs.writeFileSync(sourcePath, JSON.stringify(RAW));
  seedWorkflowTemplate(tdb, {
    id,
    userId: USER,
    name,
    taskType: "T2I",
    modes: '["T2I"]',
    rawJson: RAW,
    sourcePath,
    sourceMtime: 1000,
    sourceChecksum: "oldchecksum",
  });
  return { id, sourcePath };
}

describe("本地工作流一键转在线（ISSUE #4372）", () => {
  it("本地行转换：解除磁盘跟踪，其余列原样保留", async () => {
    const { id } = seedLocalWorkflow("wf-1", "本地工作流");
    const caller = createCaller(makeCtx());

    const res = await caller.convertToOnline({ id });
    expect(res).toEqual({ ok: true, converted: true });

    const row = tdb.$tables.workflowTemplates.find((r) => r.id === id);
    expect(row?.sourcePath).toBeNull();
    expect(row?.sourceMtime).toBeNull();
    expect(row?.sourceChecksum).toBeNull();
    /* 内容与工坊封装相关的列一律不动。 */
    expect(row?.name).toBe("本地工作流");
    expect(row?.rawJson).toEqual(RAW);
    expect(row?.taskType).toBe("T2I");
    expect(row?.modes).toBe('["T2I"]');
  });

  it("转换后该行在列表里归为在线，磁盘原文件落入未载入池（localPending）", async () => {
    const { id, sourcePath } = seedLocalWorkflow("wf-2", "转在线工作流");
    const caller = createCaller(makeCtx());

    /* 转换前：文件被该行引用，不在未载入池。 */
    const before = await caller.list(undefined);
    expect(before.localPending.some((p) => p.sourcePath === sourcePath)).toBe(false);

    await caller.convertToOnline({ id });

    const after = await caller.list(undefined);
    const row = after.workflows.find((w) => w.id === id);
    expect(row?.source).toBe("online");
    const pending = after.localPending.find((p) => p.sourcePath === sourcePath);
    expect(pending?.name).toBe("转在线工作流");
  });

  it("已是在线的行重复转换幂等（不写库）", async () => {
    const { id } = seedLocalWorkflow("wf-3", "幂等工作流");
    const caller = createCaller(makeCtx());
    await caller.convertToOnline({ id });

    const res = await caller.convertToOnline({ id });
    expect(res).toEqual({ ok: true, converted: false });
  });

  it("不存在的 id → NOT_FOUND", async () => {
    const caller = createCaller(makeCtx());
    const env = await errorEnvelope(caller.convertToOnline({ id: "no-such-wf" }));
    expect(env.code).toBe("NOT_FOUND");
  });

  it("他人（越权）的行同样 NOT_FOUND", async () => {
    seedUser(tdb, { id: "user-b", email: "b@test.dev" });
    seedWorkflowTemplate(tdb, {
      id: "wf-other",
      userId: "user-b",
      name: "别人的工作流",
      sourcePath: path.join(workflowsDir, "other.json"),
    });
    const caller = createCaller(makeCtx());
    const env = await errorEnvelope(caller.convertToOnline({ id: "wf-other" }));
    expect(env.code).toBe("NOT_FOUND");
  });
});
