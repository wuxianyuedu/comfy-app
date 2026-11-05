/**
 * Windows 端口探测的 netstat 快照：**冷 / 热两支必须同形**。
 *
 * 立案现场：`netstatTcpSnapshot()` 命中缓存返回 string、未命中返回 Promise，
 * 而同步的 `listeningPidsWindows()` 拿返回值直接 `.split()` —— 每个新进程里
 * 第一次调用 100% 抛 `TypeError: out.split is not a function`，`pnpm deps:guard`
 * 当场崩，硬规则 9 那一问恒等于没问。
 *
 * 这里用假 `execFile` 顶掉 netstat，并把 `win32` 作为平台参数注入，好让
 * Windows 分支在任何平台上都真跑一遍；`vi.resetModules()` 保证每个用例
 * 都从冷缓存开始（那份快照缓存是模块级状态）。
 *
 * 刻意不覆盖的那一格：`runCapture()` 把「命令起不来」吞成空串，那是
 * 「没量到」被当成「量到空」，属另一条诉求，另立单处置。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** 假 netstat：两条目标 LISTENING、一条邻位 LISTENING、一条非 LISTENING 状态。 */
const NETSTAT_TEXT = [
  "",
  "  协议  本地地址          外部地址        状态           PID",
  "  TCP    127.0.0.1:3311   0.0.0.0:0   LISTENING       4242",
  "  TCP    127.0.0.1:3311   0.0.0.0:0   LISTENING       5555",
  "  TCP    127.0.0.1:3312   0.0.0.0:0   LISTENING       9999",
  "  TCP    127.0.0.1:3311   0.0.0.0:0   ESTABLISHED     7777",
  "",
].join("\r\n");

beforeEach(() => {
  vi.resetModules();
  mocks.execFile.mockReset();
  mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
    callback(null, NETSTAT_TEXT, "");
  });
});

describe("netstat 快照的同步/异步契约", () => {
  it("冷缓存首次调用 ⇒ 返回 Promise 且解析出监听 PID，不抛 TypeError", async () => {
    const { listeningPidsOnPort } = await import("../scripts/launcher-core/procs.mjs");
    const result = listeningPidsOnPort(3311, "win32");
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toEqual([4242, 5555]);
  });

  it("缓存命中那一支同形 ⇒ 仍是 Promise、仍解析出 PID，netstat 只跑一次", async () => {
    const { listeningPidsOnPort } = await import("../scripts/launcher-core/procs.mjs");
    const cold = await listeningPidsOnPort(3311, "win32");
    const warm = listeningPidsOnPort(3311, "win32");
    expect(warm).toBeInstanceOf(Promise);
    await expect(warm).resolves.toEqual(cold);
    expect(cold).toEqual([4242, 5555]);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it("相邻三个端口并发 ⇒ 合并成一次在途 netstat，各自解析自己的 PID", async () => {
    const { listeningPidsOnPort } = await import("../scripts/launcher-core/procs.mjs");
    const [first, second, third] = await Promise.all([
      listeningPidsOnPort(3311, "win32"),
      listeningPidsOnPort(3312, "win32"),
      listeningPidsOnPort(3313, "win32"),
    ]);
    expect(first).toEqual([4242, 5555]);
    expect(second).toEqual([9999]);
    expect(third).toEqual([]);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
  });

  it("POSIX 分支不受影响 ⇒ 仍给出数组，且不碰 netstat", async () => {
    const { listeningPidsOnPort } = await import("../scripts/launcher-core/procs.mjs");
    const result = listeningPidsOnPort(1, "linux");
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeInstanceOf(Array);
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});
