import { describe, it, expect, vi } from "vitest";
import type { Job } from "./runner-state";

/* Mock the reaper's side-effectful dependencies so importing ./reaper
 * (which bootstraps `startReaper()` as a module side effect) never touches
 * the real DB / ComfyUI.  `isTaskClaimedInProcess` is a pure function, but
 * the module also owns the two sweeper intervals — reaping them to no-ops
 * keeps the import safe while letting us exercise the pure helper. */
vi.mock("../core/repository", () => ({
  taskRepository: {
    listStaleQueued: vi.fn().mockResolvedValue([]),
    listStaleRunning: vi.fn().mockResolvedValue([]),
    finalizeFailure: vi.fn(),
    finalizeFromReaper: vi.fn(),
  },
}));
vi.mock("./lifecycle", () => ({ isComfyStarting: vi.fn().mockReturnValue(false) }));
vi.mock("./client", () => ({ resolveComfyBase: vi.fn().mockResolvedValue("http://127.0.0.1:8188") }));
vi.mock("./executor-cli", () => ({ cliProcs: new Map() }));
vi.mock("~/lib/core/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { isTaskClaimedInProcess } from "./reaper";

function fakeState(
  overrides: Partial<{
    queue: Job[];
    executedWorkflow: Map<string, unknown>;
    settled: Set<string>;
  }>
) {
  return {
    queue: overrides.queue ?? [],
    executedWorkflow: overrides.executedWorkflow ?? new Map<string, unknown>(),
    settled: overrides.settled ?? new Set<string>(),
  };
}

function cli(ids: string[]) {
  return (taskId: string) => ids.includes(taskId);
}

describe("isTaskClaimedInProcess — QUEUED reaper 的 in-memory 认领保护", () => {
  it("任务仍在 s.queue 中等待出队时，判为被认领（跳过回收）", () => {
    const s = fakeState({
      queue: [{ taskId: "task-1" }],
    });
    expect(isTaskClaimedInProcess(s, cli([]), "task-1")).toBe(true);
  });

  it("comfy-cli 子进程正在驱动（promptId 未回传）时，判为被认领", () => {
    // raw UI-format 路径典型场景：任务已从 s.queue 出队，正在跑 comfy-cli，
    // 但 DB 行仍是 QUEUED / promptId=null。cliProcs 必须兜住它。
    const s = fakeState({});
    expect(isTaskClaimedInProcess(s, cli(["task-1"]), "task-1")).toBe(true);
  });

  it("executedWorkflow 已记录（raw 路径已开始）时，判为被认领", () => {
    const s = fakeState({ executedWorkflow: new Map<string, unknown>([["task-1", {}]]) });
    expect(isTaskClaimedInProcess(s, cli([]), "task-1")).toBe(true);
  });

  it("没有任何 in-memory 足迹（dev 冷重启弃孤）时，判为未认领——应被回收", () => {
    const s = fakeState({});
    expect(isTaskClaimedInProcess(s, cli([]), "task-1")).toBe(false);
  });

  it("队里有其他任务时，不误判当前任务", () => {
    const s = fakeState({ queue: [{ taskId: "task-other" }] });
    expect(isTaskClaimedInProcess(s, cli(["task-other"]), "task-1")).toBe(false);
  });

  it("多个信号并存时任一命中即判认领", () => {
    const s = fakeState({ queue: [{ taskId: "task-1" }] });
    expect(isTaskClaimedInProcess(s, cli(["task-1"]), "task-1")).toBe(true);
  });
});
