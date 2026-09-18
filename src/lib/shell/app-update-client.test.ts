import { afterEach, describe, expect, it, vi } from "vitest";

import { checkAppUpdate, relaunchApp } from "./app-update-client";

/** 模拟「是否在桌面壳内」：node 测试环境默认无 window（非壳）；
 *  传入 true 时在 globalThis 上打上 Tauri 标记。 */
function withShell(on: boolean) {
  const g = globalThis as unknown as Record<string, unknown>;
  if (on) {
    g.window = { __TAURI_INTERNALS__: {} };
  } else {
    delete g.window;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // 清掉测试内 stub 的 window，避免污染其它用例
  delete (globalThis as unknown as Record<string, unknown>).window;
});

describe("checkAppUpdate", () => {
  it("非桌面壳环境返回不可用", async () => {
    withShell(false);
    const res = await checkAppUpdate();
    expect(res.ok).toBe(false);
    expect(res.available).toBe(false);
  });

  it("无更新时返回 ok 且 available=false", async () => {
    withShell(true);
    vi.stubGlobal("__tauri_plugin_updater_mock__", true);
    vi.doMock("@tauri-apps/plugin-updater", () => ({
      check: vi.fn().mockResolvedValue(null),
    }));
    const mod = await import("./app-update-client");
    const res = await mod.checkAppUpdate();
    expect(res.ok).toBe(true);
    expect(res.available).toBe(false);
    expect(res.detail).toContain("最新");
  });

  it("发现更新时返回版本信息", async () => {
    withShell(true);
    vi.doMock("@tauri-apps/plugin-updater", () => ({
      check: vi.fn().mockResolvedValue({
        version: "1.2.0",
        currentVersion: "1.0.0",
        date: "2026-09-01",
        body: "修复若干问题",
      }),
    }));
    const mod = await import("./app-update-client");
    const res = await mod.checkAppUpdate();
    expect(res.available).toBe(true);
    expect(res.update?.version).toBe("1.2.0");
    expect(res.update?.currentVersion).toBe("1.0.0");
  });

  it("插件抛错时返回可读失败信息", async () => {
    withShell(true);
    vi.doMock("@tauri-apps/plugin-updater", () => ({
      check: vi.fn().mockRejectedValue(new Error("pubkey required")),
    }));
    const mod = await import("./app-update-client");
    const res = await mod.checkAppUpdate();
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("pubkey required");
  });
});

describe("downloadAndInstallUpdate", () => {
  it("无更新时不触发安装", async () => {
    withShell(true);
    vi.doMock("@tauri-apps/plugin-updater", () => ({
      check: vi.fn().mockResolvedValue(null),
    }));
    const mod = await import("./app-update-client");
    const res = await mod.downloadAndInstallUpdate();
    expect(res.ok).toBe(false);
    expect(res.triggered).toBe(false);
  });

  it("有更新时下载并安装，透出进度事件", async () => {
    withShell(true);
    const updateObj = {
      downloadAndInstall: vi.fn(async (cb: (e: unknown) => void) => {
        cb({ event: "Started", data: { contentLength: 100 } });
        cb({ event: "Progress", data: { chunkLength: 30 } });
        cb({ event: "Finished" });
      }),
    };
    vi.doMock("@tauri-apps/plugin-updater", () => ({
      check: vi.fn().mockResolvedValue(updateObj),
    }));
    const mod = await import("./app-update-client");
    const progress = vi.fn();
    const res = await mod.downloadAndInstallUpdate(progress);
    expect(res.ok).toBe(true);
    expect(res.triggered).toBe(true);
    expect(progress).toHaveBeenCalledWith(0, 100);
    expect(progress).toHaveBeenCalledWith(30, 100);
  });
});

describe("relaunchApp", () => {
  it("非桌面壳返回不可用", async () => {
    withShell(false);
    const res = await relaunchApp();
    expect(res.ok).toBe(false);
  });

  it("壳内重启成功", async () => {
    withShell(true);
    vi.doMock("@tauri-apps/plugin-process", () => ({
      relaunch: vi.fn().mockResolvedValue(undefined),
    }));
    const mod = await import("./app-update-client");
    const res = await mod.relaunchApp();
    expect(res.ok).toBe(true);
  });
});
