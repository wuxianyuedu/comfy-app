/**
 * model.router 用例：模型库不再有「每用户启用目录」这一层（ISSUE #3368），
 * 目录清单全部来自 ComfyUI 的 `GET /api/models`，所有目录默认启用。判三件事：
 * `sync` 不带用户参数（扫描全部目录）；`configList` 的目录去重 / 排序 / 计数 / label；
 * `comfyReachable` 与 `comfyuiPathConfigured` 是空态降级判据，不能让页面 500。
 * mock：`~/lib/models`、`~/lib/comfyui/client`、`~/lib/app-settings/app-settings.server`、`fetch`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scan, comfy, settings } = vi.hoisted(() => ({
  scan: {
    syncModels: vi.fn(() => 7),
    modelCountsByFolder: vi.fn(() => ({ checkpoints: 3, vae: 2 })),
  },
  comfy: {
    listModelFolders: vi.fn(
      /* SAFETY: 类型断言已复核 */
      () => ["vae", "checkpoints", "vae"] as Array<string>,
    ),
    comfyBase: vi.fn(() => "http://127.0.0.1:8188"),
  },
  settings: {
    getSettingsSync: vi.fn(() => ({ comfyuiPath: String.raw`G:\ComfyUI` })),
  },
}));

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
vi.mock("~/lib/models", () => ({
  syncModels: scan.syncModels,
  modelCountsByFolder: scan.modelCountsByFolder,
}));
vi.mock("~/lib/comfyui/client", () => ({
  listModelFolders: comfy.listModelFolders,
  comfyBase: comfy.comfyBase,
}));
vi.mock("~/lib/app-settings/app-settings.server", () => ({
  getSettingsSync: settings.getSettingsSync,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { modelRepository } from "~/lib/core/repository";
import { modelRouter } from "~/server/api/routers/model";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(modelRouter);
const caller = () => createCaller(makeCtx());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Response("", { status: 200 })),
  );
});

describe("model.configList —— 目录清单来自 ComfyUI，全部默认启用", () => {
  it("目录去重后按名排序，带展示 label 与每目录计数", async () => {
    const res = await caller().configList();
    expect(res.folders.map((f) => f.folder)).toEqual(["checkpoints", "vae"]);
    expect(res.folders.map((f) => f.type)).toEqual(["checkpoints", "vae"]);
    expect(res.folders[0]).toMatchObject({ label: "Checkpoint", count: 3 });
    expect(res.folders[1]).toMatchObject({ label: "VAE", count: 2 });
  });

  it("非模型用途的目录（custom_nodes）同刀排除，不以 count=0 挂在目录列上（ISSUE #3368）", async () => {
    comfy.listModelFolders.mockReturnValueOnce([
      "vae",
      "checkpoints",
      "custom_nodes",
      "Custom Nodes",
    ]);
    const res = await caller().configList();
    expect(res.folders.map((f) => f.folder)).toEqual(["checkpoints", "vae"]);
  });

  it("ComfyUI 不可达时降级成 false，不让模型库 500", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await caller().configList();
    expect(res.comfyReachable).toBe(false);
    expect(res.folders.length).toBeGreaterThan(0);
  });

  /**
   * 可达性必须走全库唯一口径 `probeBaseOnce`，而不是 `fetch(根路径) + res.ok`：
   * 后者把 HTTP 500 读成「进程没起」，而显存爆掉的 ComfyUI 仍然活着（ISSUE #685）。
   * 两条断言各钉一半 —— 只钉「500 算活」的话，改回探根路径 + `catch(()=>false)` 也能过。
   */
  it("存活判据走 /system_stats 且「连上即存活」（500 不算未连接）", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 500 }));
    const res = await caller().configList();
    expect(res.comfyReachable).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("http://127.0.0.1:8188/system_stats");
  });

  it("comfyuiPathConfigured 反映设置里的路径（空白串算没配）", async () => {
    expect((await caller().configList()).comfyuiPathConfigured).toBe(true);
    settings.getSettingsSync.mockReturnValueOnce({ comfyuiPath: "   " });
    expect((await caller().configList()).comfyuiPathConfigured).toBe(false);
  });
});

describe("model.list / sync —— 上下文与透传", () => {
  it("同步扫描全部目录，不再按用户挑目录", async () => {
    const res = await caller().sync();
    expect(scan.syncModels).toHaveBeenCalledWith();
    expect(res).toEqual({ ok: true, count: 7 });
  });

  it("列表把 input 原样给仓储；不传时是空对象而不是 undefined", async () => {
    const list = vi
      .spyOn(modelRepository, "list")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue([]);
    await caller().list({ type: "checkpoints", q: "sd" });
    expect(list).toHaveBeenCalledWith({ type: "checkpoints", q: "sd" });
    await caller().list();
    expect(list.mock.lastCall?.[0]).toEqual({});
    list.mockRestore();
  });
});
