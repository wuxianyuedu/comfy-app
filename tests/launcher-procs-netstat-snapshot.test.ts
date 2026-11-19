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
 * `runCaptureStrict()` 把「命令起不来」与「量到空」分开之后，这一份也钉住
 * 失败那一支：netstat 起不来要抛可识别的异常，不许退化成空数组（那会被
 * `inspectPort` 念成「端口空闲」、被 `runningAppInstances` 念成「没有实例」）。
 */
import { readFileSync } from "node:fs";
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

/**
 * 本机有没有可读的 `/proc/net/tcp{,6}` —— **POSIX 分支的输入面**。
 *
 * 为什么用例要自己判一次（ISSUE #3522）：那一支的输入是**文件系统**、不是平台名 ——
 * Linux 有 `/proc`，**Windows 与 macOS 都没有**。所以「POSIX 分支给出数组」这件事
 * 只在有 `/proc` 的机器上成立；在没有的机器上它按本仓三态口径抛
 * `ProbeUnavailableError`（「没量到 ≠ 量到空」，见
 * `scripts/launcher-core/procs.mjs` 的 `listeningPidsPosix`）——
 * 那是**契约的一部分**，不是缺陷。
 *
 * 原先那条断言把「有 /proc」当前提写死了，于是它在 Windows 与 macOS 上恒红
 * （`base-check` 判 baseline-red）。改成按本机的真实输入面分两支断言：
 * 有 `/proc` ⇒ 给出数组；没有 ⇒ 抛第三态。**两支都是契约**，
 * 而「不碰 netstat」这一条在两支上都成立。
 */
function hostHasProcNetTcp(): boolean {
  return ["/proc/net/tcp", "/proc/net/tcp6"].some((file) => {
    try {
      readFileSync(file, "utf8");
      return true;
    } catch {
      return false;
    }
  });
}

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

  it("POSIX 分支不受影响 ⇒ 不碰 netstat，且按本机有没有 /proc 给读数或第三态", async () => {
    const { listeningPidsOnPort, ProbeUnavailableError } =
      await import("../scripts/launcher-core/procs.mjs");
    const result = listeningPidsOnPort(1, "linux");
    expect(result).toBeInstanceOf(Promise);
    /* 断言**不写成条件分支**（`vitest/no-conditional-expect` 不许条件里出现 expect ——
       条件本身不是被测行为，被测的是「这一支在本机给出哪种契约结论」）。
       所以把「本机属于哪一支」折进**期望值**里，一次 expect 断言两件事。 */
    const outcome = await result.then(
      (value) => (Array.isArray(value) ? "array" : "not-array"),
      (error) =>
        error instanceof ProbeUnavailableError
          ? "probe-unavailable"
          : `other-error:${String(error)}`,
    );
    expect(outcome).toBe(hostHasProcNetTcp() ? "array" : "probe-unavailable");
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

describe("netstat 探测失效（没量到 ≠ 量到空）", () => {
  it("netstat 起不来 ⇒ 抛 ProbeUnavailableError，不返回空数组", async () => {
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(new Error("spawn netstat ENOENT"), "", "");
    });
    const { listeningPidsOnPort } = await import("../scripts/launcher-core/procs.mjs");
    const { ProbeUnavailableError } = await import("../scripts/launcher-core/procs.mjs");
    await expect(listeningPidsOnPort(3311, "win32")).rejects.toBeInstanceOf(ProbeUnavailableError);
  });

  it("第一次失败不进缓存 ⇒ 下一次调用真的重试（而不是把失败缓存 1s）", async () => {
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(new Error("spawn netstat ENOENT"), "", "");
    });
    const { listeningPidsOnPort } = await import("../scripts/launcher-core/procs.mjs");
    await expect(listeningPidsOnPort(3311, "win32")).rejects.toBeInstanceOf(Error);
    // 恢复成正常输出：若失败被缓存，这一轮仍会拿到空串从而解析出 []。
    mocks.execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, NETSTAT_TEXT, "");
    });
    await expect(listeningPidsOnPort(3311, "win32")).resolves.toEqual([4242, 5555]);
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });
});
