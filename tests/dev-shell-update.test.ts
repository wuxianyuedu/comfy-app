/**
 * dev 壳启动前的自动更新判据（#4722）：本地壳过期 + 远端 nightly 有更新构建 ⇒ 取壳并换用新壳启动。
 * 钉的是决策与安全边界（缺令牌 / 读不到 / 比较不出先后 / 取壳失败都照常启动），不起真进程、不发真网络。
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  compareShellBuildInfo,
  parseShellBuildInfo,
  readShellStamp,
  runDevShellAutoUpdate,
  stampPathOf,
  writeShellStamp,
} from "../scripts/launcher-core/dev-shell-update.mjs";

const NEWER = { built_at: "2026-11-21T10:00:00Z", commit: "aaaaaaaaaaaa", run_id: "200" };
const OLDER = { built_at: "2026-11-20T10:00:00Z", commit: "bbbbbbbbbbbb", run_id: "100" };

describe("parseShellBuildInfo", () => {
  it("取出 built_at / commit / run_id，缺席字段留空串", () => {
    expect(parseShellBuildInfo(JSON.stringify(NEWER))).toEqual(NEWER);
    expect(parseShellBuildInfo(JSON.stringify({ commit: "abc" }))).toEqual({
      built_at: "",
      commit: "abc",
      run_id: "",
    });
  });

  it("非 JSON / 空对象 / 无任何可读字段 ⇒ null（按读不到处理，不抛）", () => {
    expect(parseShellBuildInfo("not json")).toBeNull();
    expect(parseShellBuildInfo("{}")).toBeNull();
    expect(parseShellBuildInfo("[]")).toBeNull();
  });
});

describe("compareShellBuildInfo：只在能排先后时才说更新", () => {
  it("built_at 远端更新 ⇒ update", () => {
    expect(compareShellBuildInfo(OLDER, NEWER).update).toBe(true);
  });

  it("built_at 远端更旧 / 相等 ⇒ 不更新", () => {
    expect(compareShellBuildInfo(NEWER, OLDER).update).toBe(false);
    expect(compareShellBuildInfo(NEWER, NEWER).update).toBe(false);
  });

  it("built_at 不可用退而 run_id（nightly 递增）", () => {
    const a = { built_at: "", commit: "x", run_id: "100" };
    const b = { built_at: "", commit: "y", run_id: "200" };
    expect(compareShellBuildInfo(a, b).update).toBe(true);
    expect(compareShellBuildInfo(b, a).update).toBe(false);
  });

  it("只有 commit 不同不足以判先后 ⇒ 跳过", () => {
    const a = { built_at: "", commit: "x", run_id: "" };
    const b = { built_at: "", commit: "y", run_id: "" };
    expect(compareShellBuildInfo(a, b)).toMatchObject({ update: false });
  });

  it("本地无标记 / 远端读不到 ⇒ 跳过，不擅自更新", () => {
    expect(compareShellBuildInfo(null, NEWER).update).toBe(false);
    expect(compareShellBuildInfo(OLDER, null).update).toBe(false);
  });
});

describe("构建标记落盘", () => {
  it("写后能读回；标记与壳同目录", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dev-shell-stamp-"));
    const exe = path.join(dir, "app.exe");
    const stamp = stampPathOf(exe);
    expect(stamp).toBe(path.join(dir, ".comfy-shell-build-info.json"));
    expect(writeShellStamp(stamp, NEWER)).toBe(true);
    expect(readShellStamp(stamp)).toEqual(NEWER);
  });
});

describe("runDevShellAutoUpdate：任何一步失败都照常启动（不阻塞、不杀进程）", () => {
  it("本地壳未过期 ⇒ 不取壳", async () => {
    /* 用自己的临时目录造「壳比源码新 + 已有构建标记」的状态：这条用例过去跑在
     * `process.cwd()` 上，结果取决于**本机**有没有壳标记、源码有没有刚被改过、
     * 环境里有没有令牌——三样都不受用例控制（ISSUE #4749 期间实测会真发网络请求）。 */
    const dir = mkdtempSync(path.join(tmpdir(), "dev-shell-fresh-"));
    const exe = path.join(dir, "app.exe");
    writeFileSync(exe, "");
    const src = path.join(dir, "src-tauri", "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "lib.rs"), "// older");
    const fs = await import("node:fs");
    /* 壳（2030）比源码（2020）新 ⇒ 未过期。 */
    fs.utimesSync(exe, new Date("2030-01-01"), new Date("2030-01-01"));
    fs.utimesSync(path.join(src, "lib.rs"), new Date("2020-01-01"), new Date("2020-01-01"));
    writeShellStamp(stampPathOf(exe), NEWER);

    const log = vi.fn();
    const fetchShell = vi.fn();
    const res = await runDevShellAutoUpdate({
      root: dir,
      out: exe,
      log,
      fetchShell,
    });
    expect(res.updated).toBe(false);
    expect(fetchShell).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("本地壳未过期"));
  });

  it("壳过期但缺令牌 ⇒ 跳过远端检查、不取壳", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dev-shell-stale-"));
    const exe = path.join(dir, "app.exe");
    writeFileSync(exe, "");
    /* 造一份比壳新的源码，触发 shellStaleWarning */
    const src = path.join(dir, "src-tauri", "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "lib.rs"), "// newer");
    const fs = await import("node:fs");
    fs.utimesSync(exe, new Date("2020-01-01"), new Date("2020-01-01"));
    fs.utimesSync(path.join(src, "lib.rs"), new Date("2030-01-01"), new Date("2030-01-01"));

    const fetchShell = vi.fn();
    const res = await runDevShellAutoUpdate({
      root: dir,
      out: exe,
      env: {
        ...process.env,
        PATH: process.env.PATH ?? "",
        CNB_RELEASE_TOKEN: "",
        CNB_TOKEN: "",
        CNB_ISSUE_TOKEN: "",
      },
      configPaths: [],
      log: vi.fn(),
      fetchShell,
    });
    expect(res.updated).toBe(false);
    expect(fetchShell).not.toHaveBeenCalled();
  });

  it("壳过期且远端更新 ⇒ 取壳并写标记（供下次比较）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dev-shell-update-ok-"));
    const exe = path.join(dir, "app.exe");
    writeFileSync(exe, "");
    const src = path.join(dir, "src-tauri", "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "lib.rs"), "// newer");
    const fs = await import("node:fs");
    fs.utimesSync(exe, new Date("2020-01-01"), new Date("2020-01-01"));
    fs.utimesSync(path.join(src, "lib.rs"), new Date("2030-01-01"), new Date("2030-01-01"));

    const stamp = stampPathOf(exe);
    writeShellStamp(stamp, OLDER);
    const infoBytes = Buffer.from(JSON.stringify(NEWER));
    const fakeFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.resolve(new Response(Uint8Array.from(infoBytes))),
    );
    const fetchShell = vi.fn().mockResolvedValue(0);
    const res = await runDevShellAutoUpdate({
      root: dir,
      out: exe,
      env: { ...process.env, CNB_RELEASE_TOKEN: "fake", PATH: process.env.PATH ?? "" },
      fetchImpl: fakeFetch,
      log: vi.fn(),
      fetchShell,
    });
    expect(res.updated).toBe(true);
    expect(fetchShell).toHaveBeenCalledTimes(1);
    expect(readShellStamp(stamp)).toEqual(NEWER);
  });

  it("本地无标记 ⇒ 取一次壳建立基线（否则功能对老用户永不触发）", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dev-shell-nostamp-"));
    const exe = path.join(dir, "app.exe");
    writeFileSync(exe, "");
    const src = path.join(dir, "src-tauri", "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "lib.rs"), "// newer");
    const fs = await import("node:fs");
    fs.utimesSync(exe, new Date("2020-01-01"), new Date("2020-01-01"));
    fs.utimesSync(path.join(src, "lib.rs"), new Date("2030-01-01"), new Date("2030-01-01"));

    const infoBytes = Buffer.from(JSON.stringify(NEWER));
    const fakeFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.resolve(new Response(Uint8Array.from(infoBytes))),
    );
    const fetchShell = vi.fn().mockResolvedValue(0);
    const res = await runDevShellAutoUpdate({
      root: dir,
      out: exe,
      env: { ...process.env, CNB_RELEASE_TOKEN: "fake", PATH: process.env.PATH ?? "" },
      fetchImpl: fakeFetch,
      log: vi.fn(),
      fetchShell,
    });
    expect(res.updated).toBe(true);
    expect(fetchShell).toHaveBeenCalledTimes(1);
    expect(readShellStamp(stampPathOf(exe))).toEqual(NEWER);
  });

  it("取壳失败 ⇒ 不写标记、照常启动", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dev-shell-fetchfail-"));
    const exe = path.join(dir, "app.exe");
    writeFileSync(exe, "");
    const src = path.join(dir, "src-tauri", "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(path.join(src, "lib.rs"), "// newer");
    const fs = await import("node:fs");
    fs.utimesSync(exe, new Date("2020-01-01"), new Date("2020-01-01"));
    fs.utimesSync(path.join(src, "lib.rs"), new Date("2030-01-01"), new Date("2030-01-01"));

    const stamp = stampPathOf(exe);
    writeShellStamp(stamp, OLDER);
    const infoBytes = Buffer.from(JSON.stringify(NEWER));
    const fakeFetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
      Promise.resolve(new Response(Uint8Array.from(infoBytes))),
    );
    const res = await runDevShellAutoUpdate({
      root: dir,
      out: exe,
      env: { ...process.env, CNB_RELEASE_TOKEN: "fake", PATH: process.env.PATH ?? "" },
      fetchImpl: fakeFetch,
      log: vi.fn(),
      fetchShell: vi.fn().mockResolvedValue(1),
    });
    expect(res.updated).toBe(false);
    expect(readShellStamp(stamp)).toEqual(OLDER);
  });
});
