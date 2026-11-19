/**
 * 通用探测层的「没量到 ≠ 量到空」端到端护栏。
 *
 * 立案现场（#3202）：`runCapture()` 把 execFile 的 error 吞成空串，netstat 起不来时
 * `runningAppInstances()` 返回一份形状完全合法的 `{running:false}`，于是
 * `pnpm deps:guard` exit 0「可以执行 pnpm install」—— 硬规则 9 那一问在
 * 「探测命令失效」这一支上恒等于没问。
 *
 * 这里不 mock `runningAppInstances`（那就只测到假件），而是 mock 最底层的
 * `node:child_process`，让 Windows 分支在任何平台上真跑一遍：netstat 起不来
 * ⇒ 归属判据抛 `ProbeUnavailableError` ⇒ 不退化成「没有实例在跑」。
 * 会话锚点那条捷径由临时空 root 保证不走（run/ 里没有心跳）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _command: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
    },
  ),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  execFile: mocks.execFile,
}));

const tmpDirs: Array<string> = [];
/** 一个绝不会有会话锚点的空检出根。 */
function emptyRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-fail-"));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.resetModules();
  mocks.execFile.mockReset();
});

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("探测失效：归属判据不 fail-open", () => {
  it("netstat 起不来 ⇒ runningAppInstances 抛 ProbeUnavailableError，不返回 running:false", async () => {
    // 平台注入成 win32：让 netstat 那条子进程分支在 Linux/CI 上真跑。
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(new Error("spawn netstat ENOENT"), "", "");
    });
    try {
      const { runningAppInstances } = await import("../scripts/launcher-core/port-reap.mjs");
      const { ProbeUnavailableError } = await import("../scripts/launcher-core/procs.mjs");
      await expect(runningAppInstances(emptyRoot())).rejects.toBeInstanceOf(ProbeUnavailableError);
    } finally {
      if (original) {
        Object.defineProperty(process, "platform", original);
      }
    }
  });

  it("探测成功但确实没有监听者 ⇒ 仍是合法的 running:false（没量到与量到空分开）", async () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, "", "");
    });
    try {
      const { runningAppInstances } = await import("../scripts/launcher-core/port-reap.mjs");
      await expect(runningAppInstances(emptyRoot())).resolves.toEqual({
        running: false,
        pids: [],
        via: null,
      });
    } finally {
      if (original) {
        Object.defineProperty(process, "platform", original);
      }
    }
  });

  it("命令行探测也失效 ⇒ 同样抛，不允许退化成空 Map 判成「都不是应用服务」", async () => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    // netstat 给出一条 LISTENING（有占位 PID），紧接着 ps/CIM 查询起不来。
    // 端口必须取这份 root 真正解析出来的那一个，否则 LISTENING 行匹配不上，
    // 根本走不到命令行探测那一支（用例会假绿）。
    const { resolveAppPort } = await import("../scripts/app-port.mjs");
    const root = emptyRoot();
    const NETSTAT_TEXT = [
      "",
      `  TCP    127.0.0.1:${resolveAppPort(root)}   0.0.0.0:0   LISTENING       4242`,
      "",
    ].join("\r\n");
    mocks.execFile.mockImplementation((command, _args, _options, callback) => {
      if (command === "netstat") {
        callback(null, NETSTAT_TEXT, "");
        return;
      }
      callback(new Error("spawn powershell ENOENT"), "", "");
    });
    try {
      const { runningAppInstances } = await import("../scripts/launcher-core/port-reap.mjs");
      const { ProbeUnavailableError } = await import("../scripts/launcher-core/procs.mjs");
      await expect(runningAppInstances(root)).rejects.toBeInstanceOf(ProbeUnavailableError);
    } finally {
      if (original) {
        Object.defineProperty(process, "platform", original);
      }
    }
  });
});
