/**
 * model.router 闸门用例（⑨ 第二刀）：本机状态是每用户启用的模型目录（`userModelConfig`），目录名同时是 ComfyUI 路径片段。判三件事：
 * 写侧带会话用户（`addOrEnable` / `deleteForUser` 收 `ctx.user.id`，别人的同名配置一字不动）；读侧 `configList` 只吃自己的 override。
 * `comfyReachable` 是降级而非故障：ComfyUI 没起时 `fetch` 抛错吞成 false，不能让配置页 500。mock：db（真 Drizzle，按 userId 过滤）、`~/lib/models`、`~/lib/comfyui/client`、`fetch`、better-auth、logger。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scan, comfy } = vi.hoisted(() => ({
  scan: {
    syncModels: vi.fn((_userId: string) => 7),
    modelCountsByFolder: vi.fn(() => ({ checkpoints: 3 })),
  },
  comfy: {
    listModelFolders: vi.fn(
      /* SAFETY: 类型断言已复核 */
      () => ["vae", "checkpoints"] as Array<string>,
    ),
    comfyBase: vi.fn(() => "http://127.0.0.1:8188"),
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

import { createCallerFactory } from "~/server/api/trpc";
import { modelRepository, userModelConfigRepository } from "~/lib/core/repository";
import { modelRouter } from "~/server/api/routers/model";
import { getTestDb, seedUser, type TestDb } from "../../../../tests/helpers/test-db";
import { makeCtx, makeUser } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(modelRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());
const asUser = (id: string) => createCaller(makeCtx({ user: makeUser({ id }) }));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- rejection 值是外部抛出的任意值，回调参数按 { code? } 标窄，`?.` 是运行期防线
    (error: { code?: string }) => error?.code ?? "UNKNOWN",
  );
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Response("", { status: 200 })),
  );
});

describe("model.configSave / configDelete —— 写侧只动自己那行", () => {
  it("启用目录时带的是会话用户，不是写死的 id", async () => {
    await caller().configSave({ folder: "checkpoints", enabled: true });
    const rows = await userModelConfigRepository.listByUser("user-a");
    expect(rows.map((r) => r.folder)).toEqual(["checkpoints"]);
    expect(await userModelConfigRepository.listByUser("user-b")).toHaveLength(0);
  });

  it("禁用只删自己的行：别人的同名配置还在", async () => {
    await userModelConfigRepository.addOrEnable("user-a", "vae", null);
    await userModelConfigRepository.addOrEnable("user-b", "vae", null);
    await asUser("user-a").configDelete({ folder: "vae" });
    expect(await userModelConfigRepository.listByUser("user-a")).toHaveLength(0);
    expect(await userModelConfigRepository.listByUser("user-b")).toHaveLength(1);
  });

  it("enabled=false 走删除分支，而不是写一行 disabled", async () => {
    await userModelConfigRepository.addOrEnable("user-a", "vae", null);
    await caller().configSave({ folder: "vae", enabled: false });
    expect(await userModelConfigRepository.listByUser("user-a")).toHaveLength(0);
  });

  it("folder 传空串 → BAD_REQUEST（min(1) 挡住，不落库）", async () => {
    expect(await codeOf(caller().configSave({ folder: "", enabled: true }))).toBe("BAD_REQUEST");
    expect(await userModelConfigRepository.listByUser("user-a")).toHaveLength(0);
  });
});

describe("model.configList —— 读侧只看自己的 override", () => {
  beforeEach(async () => {
    await userModelConfigRepository.addOrEnable("user-a", "vae", "我的 VAE");
  });

  it("自己的 override 生效，别人的行不参与", async () => {
    await userModelConfigRepository.addOrEnable("user-b", "checkpoints", null);
    const res = await caller().configList();
    const byFolder = new Map(res.folders.map((f) => [f.folder, f]));
    expect(byFolder.get("vae")?.enabled).toBe(true);
    expect(byFolder.get("vae")?.hasConfig).toBe(true);
    expect(byFolder.get("checkpoints")?.enabled).toBe(false);
    expect(res.rows.map((r) => r.folder)).toEqual(["vae"]);
  });

  it("目录按名排序、带展示 label 与每目录计数", async () => {
    const res = await caller().configList();
    expect(res.folders.map((f) => f.folder)).toEqual(["checkpoints", "vae"]);
    expect(res.folders[0]?.count).toBe(3);
  });

  it("ComfyUI 不可达时降级成 false，不让配置页 500", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await caller().configList();
    expect(res.comfyReachable).toBe(false);
    expect(res.folders.length).toBeGreaterThan(0);
  });

  /**
   * 可达性必须走全库唯一口径 `probeBaseOnce`，而不是这里原本那份 `fetch(根路径) + res.ok`：
   * 后者把 HTTP 500 读成「进程没起」，而显存爆掉的 ComfyUI 仍然活着（ISSUE #685 就是收这个）。
   * 两条断言各钉一半 —— 只钉「500 算活」的话，改回探根路径 + `catch(()=>false)` 也能过。
   */
  it("存活判据走 /system_stats 且「连上即存活」（500 不算未连接）", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 500 }));
    const res = await caller().configList();
    expect(res.comfyReachable).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("http://127.0.0.1:8188/system_stats");
  });
});

describe("model.list / sync —— 上下文与透传", () => {
  it("同步按会话用户落库（模型行归属到人）", async () => {
    await caller().sync();
    expect(scan.syncModels).toHaveBeenCalledWith("user-a");
  });

  it("列表把 input 原样给仓储；不传时是空对象而不是 undefined", async () => {
    const list = vi
      .spyOn(modelRepository, "list")
      /* SAFETY: 类型断言已复核 */
      .mockResolvedValue([] as never);
    await caller().list({ type: "checkpoints", q: "sd" });
    expect(list).toHaveBeenCalledWith({ type: "checkpoints", q: "sd" });
    await caller().list();
    expect(list.mock.lastCall?.[0]).toEqual({});
    list.mockRestore();
  });
});
