/**
 * 「本地文件工作流的更新入口」行为契约（用户实测反馈 + 设置项）：
 *
 * > 工作流文件有更新时，切界面后就自动更新了，需要我点同步按钮再更新。
 *
 * PR #806 把默认行为改成「进详情只检出、不写库」，更新入口唯一是
 * `workflow.resync`（同步按钮）。随后补了一个设置项 `autoSyncLocalWorkflow`：
 * 关（默认）= 只检出不写库；开 = 进详情等价于点一次同步（自动写回）。
 *
 * 契约三条，缺一条那个症状就会回来：
 *   1. 默认关时详情路径**只检出**（stat 比 mtime）**不写库**；
 *   2. 开启时详情即写回，且写回后响应反映最新内容（不是同步前的旧值）；
 *   3. `workflow.resync` 仍是「重新导入 + 落库 + 清详情缓存」的入口
 *      —— 否则「点了同步、再进详情还是旧内容」又是新的自相矛盾（缓存 TTL 30s）。
 *
 * 1 / 2 用真实 repository（内存 SQLite，见 tests/helpers/test-db）跑通整条链路，
 * 而不是源码级字符串断言 —— 它们的价值在于「这条路径到底写不写库」，
 * 而那是会随设置开关变化、必须真正执行才能定死的事实。
 * 3 是「唯一写入口」的接线事实，读一眼就能定死，做成集成测试要拖进
 * repository、object_info 解析与磁盘夹具，成本远高于它挡住的风险。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";
import type * as ImportSourceModule from "~/lib/comfyui/importSource";

const { getSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(() => ({ autoSyncLocalWorkflow: false })),
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("./helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/lib/core/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof LoggerModule>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("~/lib/app-settings/app-settings.server", async (importOriginal) => {
  const mod = await importOriginal<typeof AppSettingsModule>();
  return {
    ...mod,
    getSettingsSync: getSettingsMock as unknown as typeof mod.getSettingsSync,
  };
});
vi.mock("~/lib/comfyui/importSource", async (importOriginal) => ({
  ...(await importOriginal<typeof ImportSourceModule>()),
  reimportFromSource: vi.fn(),
}));

import { buildWorkflowDetailFull } from "~/lib/comfyui/workflow-detail";
import { reimportFromSource } from "~/lib/comfyui/importSource";
import { getTestDb, seedUser, seedWorkflowTemplate } from "./helpers/test-db";

const tdb = getTestDb();
const USER = "user-a";

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  getSettingsMock.mockReturnValue({ autoSyncLocalWorkflow: false });
});

/** 造一个绑定到本地文件的工作流：文件存在且 mtime 比库里记录的更新（sourceOutdated）。 */
function seedLocalWorkflow(id: string) {
  seedUser(tdb, { id: USER, email: "a@test.dev" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-autosync-"));
  const sourcePath = path.join(dir, "wf.json");
  fs.writeFileSync(sourcePath, JSON.stringify({ nodes: [] }));
  seedWorkflowTemplate(tdb, {
    id,
    userId: USER,
    name: "Local WF",
    rawJson: { nodes: [{ id: "1", type: "KSampler" }] },
    sourcePath,
    sourceMtime: 1000,
    sourceChecksum: "old",
  });
  return { id, sourcePath };
}

/** 读一段源码做接线断言（只用于「有没有第二个写入口」这类读一眼就能定死的事实）。 */
function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("本地文件工作流 · 自动同步设置", () => {
  it("默认关：进详情只检出、不写库（更新入口仍是『同步』按钮）", async () => {
    getSettingsMock.mockReturnValue({ autoSyncLocalWorkflow: false });
    const { id } = seedLocalWorkflow("wf-off");

    await buildWorkflowDetailFull(USER, id);

    // 详情没有重新导入、没有落库
    expect(reimportFromSource).not.toHaveBeenCalled();
    const row = tdb.$tables.workflowTemplates.find((w) => w.id === id);
    expect(row?.rawJson).toEqual({ nodes: [{ id: "1", type: "KSampler" }] });
  });

  it("开启：进详情即把磁盘最新内容写回库（与 resync 共用链路）", async () => {
    getSettingsMock.mockReturnValue({ autoSyncLocalWorkflow: true });
    const { id } = seedLocalWorkflow("wf-on");

    vi.mocked(reimportFromSource).mockResolvedValue({
      update: {
        rawJson: { nodes: [{ id: "9", type: "NewNode" }] },
        positions: { "9": [1, 2] },
        paramMap: { p: "v" },
        taskType: "I2I",
        sourceChecksum: "new",
        sourceMtime: 2000,
      },
    });

    const detail = await buildWorkflowDetailFull(USER, id);

    // 复用同一份重导入链路
    expect(reimportFromSource).toHaveBeenCalledOnce();
    // 库被写回
    const row = tdb.$tables.workflowTemplates.find((w) => w.id === id);
    expect(row?.rawJson).toEqual({ nodes: [{ id: "9", type: "NewNode" }] });
    expect(row?.sourceMtime).toBe(2000);
    expect(row?.taskType).toBe("I2I");
    // 响应也反映最新内容（不是同步前的旧值）
    expect(detail.rawJson).toEqual({ nodes: [{ id: "9", type: "NewNode" }] });
    expect(detail.sourceOutdated).toBe(false);
  });
});

describe("resync 是写回磁盘内容的唯一入口", () => {
  /* resync 自 workflow.ts 按子域拆分后落在 workflow-mutations.ts（key 逐字不变）。 */
  const src = read("src/server/api/routers/workflow-mutations.ts");

  it("它才做「重新导入 + 落库」", () => {
    expect(src).toMatch(/resync:[\s\S]{0,2000}?reimportFromSource/);
    expect(src).toMatch(/sourceMtime: result\.update\.sourceMtime/);
  });

  it("写回后清掉详情缓存（否则点完同步、详情还是旧内容）", () => {
    expect(src).toMatch(
      /resync:[\s\S]{0,2000}?invalidateWorkflowDetailCache\(ctx\.user\.id, existing\.id\)/,
    );
  });
});
