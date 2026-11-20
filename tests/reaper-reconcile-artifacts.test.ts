/**
 * #4607：reaper 对 RUNNING 孤儿任务对账判 **SUCCEEDED** 时，必须委托 executor
 * 的完成入口（complete → 拉 /history → 下载产物 → finalizeSuccessWithImages）
 * 把产物从 ComfyUI 拿回来，而不是只写状态 —— 只写状态会让工坊恢复侧读到
 * 「SUCCEEDED 但无产物」，用户只能整镜重来（产物明明就在 ComfyUI 输出目录里）。
 * FAILED 判决维持原 finalizeFromReaper 路径（回归守护）。
 *
 * complete 的下载管线本体不在本文件量程里（它是既有行为）；这里钉的是
 * **reaper 的判决分流**：成功 → 委托 complete；失败 → finalizeFromReaper。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const completeMock = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));

vi.mock("~/lib/comfyui/executor-finalize", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  complete: completeMock,
}));

const resolveComfyBase = vi.hoisted(() => vi.fn(() => Promise.resolve("http://127.0.0.1:8188")));
vi.mock("~/lib/comfyui/client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveComfyBase,
}));

const isComfyStarting = vi.hoisted(() => vi.fn(() => false));
vi.mock("~/lib/comfyui/lifecycle", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isComfyStarting,
}));

const cliProcs = vi.hoisted(() => new Map<string, unknown>());
const pruneTempWorkflowFiles = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
vi.mock("~/lib/comfyui/executor-cli", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cliProcs,
  pruneTempWorkflowFiles,
}));

import {
  configureReaper,
  reapStaleRunningTasks,
  type TaskRepoForReaper,
} from "~/lib/comfyui/reaper";
import { configureRunner } from "~/lib/comfyui/runner-state";

/** 对账行的形状（listStaleRunning 的返回列，见 repository-task-impl）。 */
type StaleRow = {
  createdAt: Date;
  id: string;
  promptId: string | null;
  workflowName: string;
};

function staleRow(id: string, promptId: string): StaleRow {
  return {
    id,
    promptId,
    workflowName: "wf-test",
    createdAt: new Date(Date.now() - 120_000),
  };
}

const listStaleUnownedQueued = vi.fn(() => Promise.resolve([]));
const listStaleRunning = vi.fn(() => Promise.resolve([] as Array<StaleRow>));
const finalizeFailure = vi.fn(() => Promise.resolve("written" as const));
const finalizeFromReaper = vi.fn(() => Promise.resolve("written" as const));

/* 直接按接口形状给实现，避免「测试只提供 reaper 用到的四个方法」的双段断言。 */
const reaperRepo: TaskRepoForReaper = {
  listStaleUnownedQueued,
  listStaleRunning,
  finalizeFailure,
  finalizeFromReaper,
};

/* reaper 的判决矩阵只认注入的 taskRepo；日志侧走 runner-state 的注入
 * （persistLogs 的 appendLogs / replaceLogs），不碰真库。 */
configureReaper({ owner: "inline", taskRepo: reaperRepo });
configureRunner({
  log: { warn: () => undefined },
  taskRepo: {
    appendLogs: () => Promise.resolve(undefined),
    replaceLogs: () => Promise.resolve(undefined),
    replaceRawCli: () => Promise.resolve(undefined),
    resetLogs: () => Promise.resolve(undefined),
  },
});

/** 把全局 fetch 钉成只回答 /history/<promptId>（对账取证的唯一外部依赖）。 */
function stubHistory(entries: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL | Request) => {
      const text = typeof url === "string" ? url : url instanceof Request ? url.url : url.href;
      const promptId = text.split("/history/")[1];
      if (promptId !== undefined && Object.hasOwn(entries, promptId)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ [promptId]: entries[promptId] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    }),
  );
}

beforeEach(() => {
  completeMock.mockClear();
  listStaleUnownedQueued.mockClear();
  listStaleRunning.mockClear();
  finalizeFailure.mockClear();
  finalizeFromReaper.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reaper 对账恢复（#4607）", () => {
  it("对账判 SUCCEEDED → 委托 complete 走产物恢复，不再只写状态", async () => {
    listStaleRunning.mockResolvedValueOnce([staleRow("rec-succ", "p-succ")]);
    stubHistory({
      "p-succ": { status: { status_str: "success", messages: [] }, outputs: {} },
    });

    await reapStaleRunningTasks();

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock).toHaveBeenCalledWith("rec-succ", "p-succ");
    /* 只写状态的那条旧路径不得再被成功判决走到。 */
    expect(finalizeFromReaper).not.toHaveBeenCalled();
  });

  it("对账判 FAILED（execution_error）→ 仍走 finalizeFromReaper，不触发产物恢复", async () => {
    listStaleRunning.mockResolvedValueOnce([staleRow("rec-fail", "p-fail")]);
    stubHistory({
      "p-fail": {
        status: { status_str: "error", errored: true, messages: [] },
        error: { message: "boom" },
      },
    });

    await reapStaleRunningTasks();

    expect(completeMock).not.toHaveBeenCalled();
    expect(finalizeFromReaper).toHaveBeenCalledTimes(1);
    expect(finalizeFromReaper).toHaveBeenCalledWith(
      "rec-fail",
      "FAILED",
      expect.stringContaining("boom"),
    );
  });
});
