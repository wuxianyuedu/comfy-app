/**
 * sidebar.router 的闸门用例（ISSUE #3623）。
 *
 * 这一层要判的是**入参闸**与**两个保存出口的分工**：档位写错的值要在入参这一层
 * 就被打回（不能让用户得到一句「保存成功」却什么都没变）；「保存」与「保存为项目
 * 默认」落在**两个不同的文件**上（本机 `data/` 与入库那份 JSON），还原默认只动前者。
 *
 * mock：落盘层换成真读写临时目录的替身（判据就是「写到哪去了」），其余走真实现。
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { devCheckout } = vi.hoisted(() => ({ devCheckout: { isDevCheckout: vi.fn(() => false) } }));

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
vi.mock("~/lib/shell/dev-checkout.server", () => ({
  isDevCheckout: devCheckout.isDevCheckout,
}));

import { createCallerFactory } from "~/server/api/trpc";
import { sidebarRouter } from "~/server/api/routers/sidebar";
import { isRecord } from "~/lib/is-record";
import { makeCtx } from "../../../../tests/helpers/trpc";

const createCaller = createCallerFactory(sidebarRouter);
const caller = () => createCaller(makeCtx());

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(tmpdir(), "sidebar-router-"));
  vi.clearAllMocks();
  devCheckout.isDevCheckout.mockReturnValue(false);
  /* 落盘层指向临时目录：判据是「写到哪去了」，桩掉 fs 就判不出来。 */
  vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("tabConfigGet —— 读生效配置", () => {
  it("没有本机覆盖时读到的是项目默认，并带上「能不能写项目默认」这一格", async () => {
    const res = await caller().tabConfigGet();
    expect(Object.keys(res.config).length).toBeGreaterThan(0);
    expect(res.config["mode-contract"]).toBe("shared");
    expect(res.projectDefaultEditable).toBe(false);
  });

  it("开发检出才给「保存为项目默认」这个入口（正式包没有源码可写）", async () => {
    devCheckout.isDevCheckout.mockReturnValue(true);
    const res = await caller().tabConfigGet();
    expect(res.projectDefaultEditable).toBe(true);
  });
});

describe("tabConfigSave —— 落本机", () => {
  it("保存后回下发生效值（那份改动落在本机 data/ 下）", async () => {
    const res = await caller().tabConfigSave({
      config: { console: "shared", models: "independent" },
    });
    expect(res.config.console).toBe("shared");
    const file = path.join(root, "data", "sidebar-tab-behavior.json");
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!isRecord(parsed)) {
      throw new Error("本机覆盖那份不是一个对象");
    }
    /* 差集化：与项目默认相同的项不落盘。 */
    expect(parsed).toEqual({ console: "shared" });
  });

  it("档位写错的值在入参这一层就被打回（不落盘）", async () => {
    await expect(
      // @ts-expect-error 故意传一个非法档位：zod 闸要把它挡在入参层
      caller().tabConfigSave({ config: { console: "sometimes" } }),
    ).rejects.toThrow();
    await expect(
      fs.readFile(path.join(root, "data", "sidebar-tab-behavior.json"), "utf8"),
    ).rejects.toThrow();
  });
});

describe("tabConfigSaveProjectDefaults —— 落项目默认（跟代码走）", () => {
  it("非开发检出大声拒绝，且一个字都不写", async () => {
    await expect(
      caller().tabConfigSaveProjectDefaults({ config: { console: "shared" } }),
    ).rejects.toThrow(/只在开发检出可用/);
    await expect(
      fs.readFile(path.join(root, "src", "lib", "shell", "sidebar-tab-defaults.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("开发检出：写进入库那份 JSON，并把路径回传给界面", async () => {
    devCheckout.isDevCheckout.mockReturnValue(true);
    const res = await caller().tabConfigSaveProjectDefaults({
      config: { console: "shared", models: "shared" },
    });
    expect(res.config).toEqual({ console: "shared", models: "shared" });
    expect(res.file).toBe(path.join(root, "src", "lib", "shell", "sidebar-tab-defaults.json"));
  });
});

describe("tabConfigReset —— 还原默认", () => {
  it("删掉本机覆盖后回下发项目默认那份", async () => {
    await caller().tabConfigSave({ config: { console: "shared" } });
    const res = await caller().tabConfigReset();
    expect(res.config.console).toBe("independent");
    await expect(
      fs.readFile(path.join(root, "data", "sidebar-tab-behavior.json"), "utf8"),
    ).rejects.toThrow();
  });
});
