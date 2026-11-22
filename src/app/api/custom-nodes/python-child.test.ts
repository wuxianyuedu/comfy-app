/**
 * spawnCapture 的超时回收契约（#4727）：看门狗到点必须走 `killProcessTree`
 * 统一出口杀整棵树（硬规则 3），不许单杀 leader —— 解析器若再起孙进程，
 * 单杀会留孤儿。用例真起一个长跑子进程、真的回收，再探活确认它确实不在了
 * （与 `tests/cross-platform-launcher.test.ts` 的「真起进程树再回收」同一口径）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as killTree from "~/lib/process/kill-process-tree";

/* 包一层 spy 而不是整体替换：断言「确实走了统一出口」的同时，真回收照常发生 ——
 * 只断言「被调用」而目标还活着，是把「派发了 taskkill」误读成「树已死」（#4332 的教训）。 */
vi.mock("~/lib/process/kill-process-tree", async (importOriginal) => {
  const actual = await importOriginal<typeof killTree>();
  return {
    ...actual,
    killProcessTree: vi.fn(actual.killProcessTree),
  };
});

import { killProcessTree, waitForPidGone } from "~/lib/process/kill-process-tree";

const killSpy = vi.mocked(killProcessTree);

afterEach(() => {
  killSpy.mockClear();
});

describe("spawnCapture 超时回收（#4727）", () => {
  it("超时回收走 killProcessTree 杀整棵树，且目标进程真的退出", async () => {
    const { spawnCapture } = await import("./python-child");
    const result = await spawnCapture(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      timeoutMs: 200,
    });
    // 超时按「没有结果」处理（调用方据此换下一个解释器）。
    expect(result).toBeNull();
    expect(killSpy).toHaveBeenCalledTimes(1);
    const opts = killSpy.mock.calls[0]![0];
    expect(opts.force).toBe(true);
    expect(opts.pid).toBeGreaterThan(0);
    // 真回收：目标 pid 在有界预算内消失（Windows taskkill / POSIX SIGKILL 各按平台走）。
    await expect(waitForPidGone(opts.pid, 10_000)).resolves.toBe(true);
  }, 20_000);

  it("正常完成的探测不触发回收", async () => {
    const { spawnCapture } = await import("./python-child");
    const result = await spawnCapture(process.execPath, ["-e", "process.stdout.write('ok')"], {
      timeoutMs: 5000,
    });
    expect(result).toBe("ok");
    expect(killSpy).not.toHaveBeenCalled();
  });
});
