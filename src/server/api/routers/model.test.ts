/**
 * model.router 的闸门用例（体检清单 ⑨ 第二刀）。
 *
 * 这个 router 的「本机状态」是**每个用户启用哪些模型目录**（`userModelConfig`），
 * 目录名同时是 ComfyUI 里的路径片段。判三件事：
 *   · 写侧一律带会话用户 —— `addOrEnable` / `deleteForUser` 收到的是 `ctx.user.id`，
 *     关掉「禁用某个目录」的闸门必须只能落在自己那行上（别人的同名配置一个字都不动）；
 *   · 读侧 `configList` 的 override 只吃自己的行 —— 否则 A 启用/禁用的目录会串到 B 的界面；
 *   · `comfyReachable` 是**降级**而不是故障：ComfyUI 没起时 `fetch` 抛错要吞成 false，
 *     不能让整个配置页 500（口径同 comfy/stats 那条：可达性判据不许把面板带崩）。
 *
 * mock 边界：`~/server/db`（内存库 + 真 Drizzle，配置行是真的按 userId 过滤）、
 * `~/lib/models` 与 `~/lib/comfyui/client`（会真扫 ComfyUI 目录 / 发 HTTP，换成记账替身）、
 * `globalThis.fetch`（可达性）、`~/server/better-auth`、`~/lib/core/logger`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scan, comfy } = vi.hoisted(() => ({
  scan: {
    syncModels: vi.fn(async (_userId: string) => 7),
    modelCountsByFolder: vi.fn(async () => ({ checkpoints: 3 })),
  },
  comfy: {
    listModelFolders: vi.fn(async () => ["vae", "checkpoints"] as string[]),
    comfyBase: vi.fn(() => "http://127.0.0.1:8188"),
  },
}));

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});
vi.mock("~/server/better-auth", () => ({
  auth: { api: { getSession: vi.fn(async () => null) } },
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
import {
  modelRepository,
  userModelConfigRepository,
} from "~/lib/core/repository";
import { modelRouter } from "~/server/api/routers/model";
import {
  getTestDb,
  seedUser,
  type TestDb,
} from "../../../../tests/helpers/test-db";
import { makeCtx, makeUser } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(modelRouter);
const tdb: TestDb = getTestDb();
const caller = () => createCaller(makeCtx());
const asUser = (id: string) =>
  createCaller(makeCtx({ user: makeUser({ id }) }));

async function codeOf(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "OK",
    (e: { code?: string }) => e?.code ?? "UNKNOWN",
  );
}

beforeEach(() => {
  tdb.$reset();
  vi.clearAllMocks();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 200 })),
  );
});

describe("model.configSave / configDelete —— 写侧只动自己那行", () => {
  it("启用目录时带的是会话用户，不是写死的 id", async () => {
    await caller().configSave({ folder: "checkpoints", enabled: true });
    const rows = await userModelConfigRepository.listByUser("user-a");
    expect(rows.map((r) => r.folder)).toEqual(["checkpoints"]);
    expect(await userModelConfigRepository.listByUser("user-b")).toHaveLength(
      0,
    );
  });

  it("禁用只删自己的行：别人的同名配置还在", async () => {
    await userModelConfigRepository.addOrEnable("user-a", "vae", null);
    await userModelConfigRepository.addOrEnable("user-b", "vae", null);
    await asUser("user-a").configDelete({ folder: "vae" });
    expect(await userModelConfigRepository.listByUser("user-a")).toHaveLength(
      0,
    );
    expect(await userModelConfigRepository.listByUser("user-b")).toHaveLength(
      1,
    );
  });

  it("enabled=false 走删除分支，而不是写一行 disabled", async () => {
    await userModelConfigRepository.addOrEnable("user-a", "vae", null);
    await caller().configSave({ folder: "vae", enabled: false });
    expect(await userModelConfigRepository.listByUser("user-a")).toHaveLength(
      0,
    );
  });

  it("folder 传空串 → BAD_REQUEST（min(1) 挡住，不落库）", async () => {
    expect(
      await codeOf(caller().configSave({ folder: "", enabled: true })),
    ).toBe("BAD_REQUEST");
    expect(await userModelConfigRepository.listByUser("user-a")).toHaveLength(
      0,
    );
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
});

describe("model.list / sync —— 上下文与透传", () => {
  it("同步按会话用户落库（模型行归属到人）", async () => {
    await caller().sync();
    expect(scan.syncModels).toHaveBeenCalledWith("user-a");
  });

  it("列表把 input 原样给仓储；不传时是空对象而不是 undefined", async () => {
    const list = vi
      .spyOn(modelRepository, "list")
      .mockResolvedValue([] as never);
    await caller().list({ type: "checkpoints", q: "sd" });
    expect(list).toHaveBeenCalledWith({ type: "checkpoints", q: "sd" });
    await caller().list();
    expect(list.mock.lastCall?.[0]).toEqual({});
    list.mockRestore();
  });
});
