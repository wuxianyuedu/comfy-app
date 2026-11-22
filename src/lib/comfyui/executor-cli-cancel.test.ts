// 回归测试（ISSUE #4800）：用户取消正在执行的任务时，cancelTask 先杀本进程握着的
// comfy-cli，被杀进程以非零码退出且不再回 envelope——进程退出收口（close 处理器）
// 不能把这次退出当「异常崩溃」抢先写成 FAILED，终态必须让给取消路径落 CANCELLED。
// 否则历史页显示「失败：comfy-cli 异常退出 (code=1)」而非「已取消」。
//
// 现场用**真子进程**复现：假解释器就是 node 本身，而 comfy-cli 的参数以 `-m` 开头
// —— node 不认这个旗标，立即以非零码 + stderr 退出，形态与被杀的 comfy-cli 一致
// （非零退出码、无 envelope），不需要真 Python / 真 ComfyUI。

import { describe, expect, it, vi, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

vi.mock("~/lib/db", () => ({ db: {} }));
vi.mock("../core/repository", () => ({
  taskRepository: {
    findStatusAndPromptById: vi.fn(() => null),
    cancel: vi.fn(() => undefined),
  },
}));
vi.mock("./client", () => ({
  interrupt: vi.fn(() => undefined),
  resolveComfyBase: vi.fn(() => "http://127.0.0.1:8188"),
}));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("./lifecycle", () => ({
  isComfyStarting: vi.fn().mockReturnValue(false),
}));
/* 取消路径的整树回收在测试里**真杀**：按 pid 找到 cliProcs 里的句柄 kill 掉，
 * 让 close 事件带着真实的非零退出码到达。句柄表由用例在子进程起来后填充。 */
const killTargets = new Map<number, ChildProcess>();
vi.mock("~/lib/process/kill-process-tree", () => ({
  killProcessTree: vi.fn((opts: { pid?: number }) => {
    const child = killTargets.get(opts.pid ?? -1);
    child?.kill();
    return Promise.resolve({ ok: true, via: "mock", pid: opts.pid ?? 0 });
  }),
}));
/* 解释器指向 node 本身：`node -m comfy_cli …` 对非法旗标立即报错退出——
 * 非零码、无 envelope，即「被杀/崩溃退出」的现场形状。 */
vi.mock("./comfy-cli-python", () => ({
  comfyCliInterpreter: vi.fn(() => process.execPath),
  comfyCliMissingHint: vi.fn(() => ""),
}));
vi.mock("../app-settings/app-settings.server", () => ({
  getSettingsSync: vi.fn(() => ({})),
}));
/* 收口记录器：fail 被调用 = 任务被写成 FAILED。 */
const failCalls: Array<{ error: unknown; taskId: string }> = [];
vi.mock("./executor-finalize", () => ({
  complete: vi.fn(() => Promise.resolve()),
  fail: vi.fn((taskId: string, _promptId: string, error: unknown) => {
    failCalls.push({ taskId, error });
    return Promise.resolve();
  }),
}));
vi.mock("./raw", () => ({ fetchObjectInfo: vi.fn(() => Promise.resolve(null)) }));

const cli = await import("./executor-cli");
const runnerState = await import("./runner-state");
const enqueue = await import("./enqueue");
const client = await import("./client");
const kpt = await import("~/lib/process/kill-process-tree");

/* executor-cli 的接缝（markRunning / updateProgress 走这份）；本用例的子进程
 * 不产生 stdout，两条都不会被触发，注入只为 lazy resolve 不撞 server-only。 */
cli.configureExecutorCli({
  taskRepo: {
    markRunning: vi.fn(() => Promise.resolve(true)),
    updateProgress: vi.fn(() => Promise.resolve(true)),
  },
  resolveComfyBase: () => Promise.resolve("http://127.0.0.1:8188"),
});
/* runner-state 的接缝：防抖落库与诊断通道。 */
runnerState.configureRunner({
  taskRepo: {
    appendLogs: vi.fn(() => Promise.resolve(undefined)),
    resetLogs: vi.fn(() => Promise.resolve(undefined)),
    replaceLogs: vi.fn(() => Promise.resolve(undefined)),
    replaceRawCli: vi.fn(() => Promise.resolve(undefined)),
  },
  log: { warn: vi.fn() },
});

let seq = 0;

/** 起一个任务：真 spawn，子进程立即非零退出（无 envelope），close 事件随后到达。 */
async function startTask(): Promise<string> {
  const taskId = `cancel-race-${(seq += 1)}`;
  const run = cli.executeViaComfyCli({ taskId, rawJson: { nodes: {} }, workflowName: "回归" });
  await vi.waitFor(() => {
    if (!cli.cliProcs.has(taskId)) {
      throw new Error("comfy-cli 子进程尚未登记");
    }
  });
  const child = cli.cliProcs.get(taskId);
  if (!child?.pid) {
    throw new Error("子进程句柄缺 pid");
  }
  killTargets.set(child.pid, child);
  await run;
  return taskId;
}

const logged = (taskId: string, needle: string): boolean =>
  (runnerState.state().logs.get(taskId) ?? []).some((e) => String(e.msg).includes(needle));

afterEach(async () => {
  for (const child of cli.cliProcs.values()) {
    child.kill();
  }
  cli.cliProcs.clear();
  for (const id of runnerState.state().cancelling) {
    runnerState.clearCancelling(id);
  }
  await fs.rm(path.join(process.cwd(), "temp", "comfy-cli"), { recursive: true, force: true });
  failCalls.length = 0;
  vi.clearAllMocks();
});

describe("取消杀掉的 comfy-cli 退出不写成失败（ISSUE #4800）", () => {
  it("修复面：cancelTask 杀进程 → close 收口不再 fail()，终态由取消路径落 CANCELLED", async () => {
    const cancelRepo = {
      findStatusAndPromptById: vi.fn(() => Promise.resolve({ status: "RUNNING", promptId: null })),
      cancel: vi.fn(() => Promise.resolve("written" as const)),
    };
    enqueue.configureEnqueue({ taskRepo: cancelRepo });
    vi.mocked(client.interrupt).mockReset().mockResolvedValue(undefined);
    /* 真实 taskkill 在进程**真正死掉**之后才返回，被杀进程的 close 事件因此
     * 落在 kill 等待窗口内、标记仍在场（用户现场的日志顺序即如此：失败横幅
     * 先于「用户取消任务」落盘）。mock 同形：等 close 到达再返回。 */
    vi.mocked(kpt.killProcessTree).mockImplementationOnce(async (opts) => {
      const child = killTargets.get(opts.pid ?? -1);
      if (child?.exitCode === null && !child.killed) {
        await new Promise<void>((resolve) =>
          child.once("close", () => {
            resolve();
          }),
        );
      }
      return { ok: true, via: "mock", pid: opts.pid ?? 0 };
    });

    const taskId = await startTask();
    await enqueue.cancelTask(taskId);

    /* 终态归属：取消写 CANCELLED，失败收口一次都不该发生。 */
    expect(cancelRepo.cancel).toHaveBeenCalledWith(taskId);
    expect(failCalls).toHaveLength(0);
    /* 日志可读：退出原因按「随取消退出」说明，而不是「异常退出」的 ERROR。 */
    expect(logged(taskId, "已随取消退出")).toBe(true);
    expect(logged(taskId, "异常退出")).toBe(false);
    /* 收口后标记摘除：同 taskId 重跑时不会被上一轮的标记吞掉真实失败。 */
    expect(runnerState.isCancellingHere(taskId)).toBe(false);
  });

  it("缺陷现场（修复前行为）：无标记的非零退出仍按异常崩溃 fail()——取消路径必须先挂标记的原因", async () => {
    const taskId = await startTask();

    await vi.waitFor(() => {
      if (failCalls.length === 0) {
        throw new Error("close 收口尚未到达");
      }
    });

    expect(failCalls[0]?.taskId).toBe(taskId);
    expect(String(failCalls[0]?.error)).toContain("comfy-cli 异常退出");
    expect(String(failCalls[0]?.error)).toContain("code=");
  });
});
