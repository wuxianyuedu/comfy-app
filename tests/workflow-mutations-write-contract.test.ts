/**
 * workflow.create / update 写路径的行为契约（ISSUE #4472 #4473 #4474 #4475）：
 * 1) taskType 归一（#4472）：本地文件导入与粘贴 JSON 导入给同一 defaultMode，
 *    必须落同一个规范码——归一只在共用出口做一次；
 * 2) positions 整体替换的形状防线（#4473）：垃圾 payload 不得顶掉库里已有布局；
 * 3) 「标签 × 模式」唯一性（#4474）：占用查重与落库同事务，冲突 409 且不留半态；
 * 4) 本地目录清单单一出处（#4475）：守卫口径与扫描口径恒等。
 * 全部走真 router + 内存 SQLite（tests/helpers/test-db），目录推导用真实
 * deriveComfyuiWorkflowsDir（临时目录搭出 ComfyUI/user/default/workflows 布局）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as LoggerModule from "~/lib/core/logger";
import type * as AppSettingsModule from "~/lib/app-settings/app-settings.server";

const { getSettingsMock, readEnvVarMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(() => ({ comfyuiPath: "" })),
  readEnvVarMock: vi.fn<(key: string) => string | null>(() => null),
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
/* 不读真实 .env：本机 LOCAL_WORKFLOWS_PATH 会把真实目录扫进来；读数由用例控。 */
vi.mock("~/lib/envfile", () => ({ readEnvVar: readEnvVarMock }));

import { createCallerFactory } from "~/server/api/trpc";
import { workflowRouter } from "~/server/api/routers/workflow";
import { workflowModelTagRepository } from "~/lib/core/repository";
import {
  getAllowedLocalWorkflowRoots,
  getLocalWorkflowRoots,
} from "~/server/api/routers/workflow-local-roots";
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
  readEnvVarMock.mockReturnValue(null);
  /* 搭一个真实存在的 ComfyUI 工作流目录：<root>/ComfyUI/user/default/workflows。
   * deriveComfyuiWorkflowsDir 按「root 优先、root/ComfyUI 回退」逐个试存在性。 */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mutations-"));
  const comfyuiRoot = path.join(home, "comfyui-root");
  workflowsDir = path.join(comfyuiRoot, "ComfyUI", "user", "default", "workflows");
  fs.mkdirSync(workflowsDir, { recursive: true });
  getSettingsMock.mockReturnValue({ comfyuiPath: comfyuiRoot });
  seedUser(tdb, { id: USER, email: "a@test.dev" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("taskType 归一口径（ISSUE #4472）", () => {
  it("本地文件导入与粘贴导入给同一 defaultMode，落库同一个规范码", async () => {
    const sourcePath = path.join(workflowsDir, "本地fl2v.json");
    fs.writeFileSync(sourcePath, JSON.stringify(RAW));
    const caller = createCaller(makeCtx());

    const fromLocal = await caller.create({ sourcePath, defaultMode: "fl2v" });
    const fromPaste = await caller.create({ name: "粘贴fl2v", defaultMode: "fl2v", raw: RAW });

    /* fl2v 是已退役码：两条入口都必须归一到 FLF2V，而不是一边原始串一边规范码。 */
    expect(fromLocal.taskType).toBe("FLF2V");
    expect(fromPaste.taskType).toBe("FLF2V");
    const localRow = tdb.$tables.workflowTemplates.find((r) => r.id === fromLocal.id);
    const pasteRow = tdb.$tables.workflowTemplates.find((r) => r.id === fromPaste.id);
    expect(localRow?.taskType).toBe("FLF2V");
    expect(pasteRow?.taskType).toBe("FLF2V");
  });

  it("两条入口都放行未知自定义码（归一不吞自定义类型）", async () => {
    const sourcePath = path.join(workflowsDir, "自定义.json");
    fs.writeFileSync(sourcePath, JSON.stringify(RAW));
    const caller = createCaller(makeCtx());

    const fromLocal = await caller.create({ sourcePath, defaultMode: "my-custom-type" });
    const fromPaste = await caller.create({
      name: "粘贴自定义",
      defaultMode: "my-custom-type",
      raw: RAW,
    });

    expect(fromLocal.taskType).toBe("my-custom-type");
    expect(fromPaste.taskType).toBe("my-custom-type");
  });
});

describe("positions 整体替换的形状防线（ISSUE #4473）", () => {
  const SAVED = { "1": [10, 20], "2": [30, 40] };

  function seedWithPositions(id: string) {
    seedWorkflowTemplate(tdb, {
      id,
      userId: USER,
      name: `带布局-${id}`,
      rawJson: {
        nodes: [
          { id: "1", type: "KSampler" },
          { id: "2", type: "VAEDecode" },
        ],
      },
      positions: SAVED,
    });
    return id;
  }

  it("垃圾形状（值不是坐标对）走整体替换：该列不动，已有布局保留", async () => {
    const id = seedWithPositions("wf-garbage");
    const caller = createCaller(makeCtx());

    await caller.update({ id, positions: { "4": "x" } });

    const row = tdb.$tables.workflowTemplates.find((r) => r.id === id);
    expect(row?.positions).toEqual(SAVED);
  });

  it("合法形状走整体替换：照常覆盖", async () => {
    const id = seedWithPositions("wf-valid");
    const caller = createCaller(makeCtx());

    await caller.update({ id, positions: { "1": [99, 99] } });

    const row = tdb.$tables.workflowTemplates.find((r) => r.id === id);
    expect(row?.positions).toEqual({ "1": [99, 99] });
  });

  it("合并路径的垃圾来源仍按「保留现有」处理（回归）", async () => {
    const id = seedWithPositions("wf-merge");
    const caller = createCaller(makeCtx());

    await caller.update({ id, positions: { "4": "x" }, mergePositions: true });

    const row = tdb.$tables.workflowTemplates.find((r) => r.id === id);
    expect(row?.positions).toEqual(SAVED);
  });
});

describe("「标签 × 模式」占用唯一性（ISSUE #4474）", () => {
  /** A 已绑 z-image、声明文生图；B 是另一条未绑标签的工作流。 */
  function seedOccupiedPair() {
    seedWorkflowTemplate(tdb, {
      id: "wf-a",
      userId: USER,
      name: "占用者A",
      taskType: "T2I",
      modes: '["T2I"]',
      modelTags: [{ id: "tag-z-image", name: "z-image", userId: USER }],
    });
    seedWorkflowTemplate(tdb, {
      id: "wf-b",
      userId: USER,
      name: "后来者B",
      taskType: "I2I",
      modes: '["I2I"]',
    });
  }

  it("B 抢同一「标签 × 模式」→ 409，点名占用工作流", async () => {
    seedOccupiedPair();
    const caller = createCaller(makeCtx());

    const env = await errorEnvelope(
      caller.update({ id: "wf-b", modelTags: ["z-image"], modes: ["T2I"] }),
    );

    expect(env.code).toBe("CONFLICT");
    expect(env.message).toContain("z-image");
    expect(env.message).toContain("占用者A");
    /* 绑定没有落库：B 名下仍无标签 */
    const b = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-b");
    expect(b?.modelTags).toEqual([]);
  });

  it("查重与落库同事务：占用查询拿到事务执行者（#4474 接线）", async () => {
    seedOccupiedPair();
    const caller = createCaller(makeCtx());
    const spy = vi.spyOn(workflowModelTagRepository, "listBindingsByTagName");

    await errorEnvelope(caller.update({ id: "wf-b", modelTags: ["z-image"], modes: ["T2I"] }));

    expect(spy).toHaveBeenCalled();
    /* 第 4 参是事务执行者 —— 查重落在 immediate 事务（持写锁）内，
     * 不再是事务外的 check-then-act。 */
    expect(spy.mock.calls[0]?.[3]).toBeDefined();
  });

  it("冲突时不留半态：同批提交的改名一并回滚", async () => {
    seedOccupiedPair();
    const caller = createCaller(makeCtx());

    const env = await errorEnvelope(
      caller.update({ id: "wf-b", name: "B-新名", modelTags: ["z-image"], modes: ["T2I"] }),
    );

    expect(env.code).toBe("CONFLICT");
    const b = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-b");
    expect(b?.name).toBe("后来者B");
    expect(b?.modelTags).toEqual([]);
  });

  it("不冲突的绑定照常落库（B 抢 A 未占用的模式）", async () => {
    seedOccupiedPair();
    const caller = createCaller(makeCtx());

    /* A 只占文生图；B 声明图生图 → 不撞，绑定成功 */
    await caller.update({ id: "wf-b", modelTags: ["z-image"], modes: ["I2I"] });

    const b = tdb.$tables.workflowTemplates.find((r) => r.id === "wf-b");
    expect(b?.modelTags).toEqual([{ id: "tag-z-image", name: "z-image", userId: USER }]);
  });
});

describe("本地工作流目录清单单一出处（ISSUE #4475）", () => {
  it("守卫口径与扫描口径恒等（含 LOCAL_WORKFLOWS_PATH 追加目录）", () => {
    readEnvVarMock.mockReturnValue("D:/extra-a\nD:/extra-b");

    expect(getAllowedLocalWorkflowRoots()).toEqual(getLocalWorkflowRoots());
    /* 追加目录真的进了清单（不是两边同时返回空） */
    expect(getLocalWorkflowRoots()).toEqual(
      expect.arrayContaining([expect.stringContaining("workflows"), "D:/extra-a", "D:/extra-b"]),
    );
  });

  it("无追加目录时两口径同样只含推导目录", () => {
    readEnvVarMock.mockReturnValue(null);

    const roots = getLocalWorkflowRoots();
    expect(getAllowedLocalWorkflowRoots()).toEqual(roots);
    expect(roots.length).toBeGreaterThan(0);
  });
});
