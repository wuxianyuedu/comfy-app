import { describe, it, expect, vi } from "vitest";
import type { Job } from "./runner-state";

/* 把 reaper 那些带副作用的依赖 mock 掉，这样 import ./reaper 就不会碰到真实的
 * 数据库 / ComfyUI（ADR §14 D3 之后本模块加载零副作用，起表要显式调
 * `startReaper()`；这里的桩是为两条 sweeper 被直接调用时准备的）。
 * `isTaskClaimedInProcess` 本身是纯函数，但该模块还持有两个清扫定时器 ——
 * 把它们替换成空操作，既让 import 安全，又能测到那个纯助手。 */
vi.mock("../core/repository", () => ({
  taskRepository: {
    listStaleQueued: vi.fn().mockResolvedValue([]),
    listStaleRunning: vi.fn().mockResolvedValue([]),
    finalizeFailure: vi.fn(),
    finalizeFromReaper: vi.fn(),
  },
}));
vi.mock("./lifecycle", () => ({
  isComfyStarting: vi.fn().mockReturnValue(false),
}));
vi.mock("./client", () => ({
  resolveComfyBase: vi.fn().mockResolvedValue("http://127.0.0.1:8188"),
}));
vi.mock("./executor-cli", () => ({ cliProcs: new Map() }));
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

import { isTaskClaimedInProcess } from "./reaper";

function fakeState(
  overrides: Partial<{
    queue: Job[];
    executedWorkflow: Map<string, unknown>;
    settled: Set<string>;
  }>,
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
    const s = fakeState({
      executedWorkflow: new Map<string, unknown>([["task-1", {}]]),
    });
    expect(isTaskClaimedInProcess(s, cli([]), "task-1")).toBe(true);
  });

  it("没有任何 in-memory 足迹（dev 冷重启弃孤）时，判为未认领——应被回收", () => {
    const s = fakeState({});
    expect(isTaskClaimedInProcess(s, cli([]), "task-1")).toBe(false);
  });

  it("队里有其他任务时，不误判当前任务", () => {
    const s = fakeState({ queue: [{ taskId: "task-other" }] });
    expect(isTaskClaimedInProcess(s, cli(["task-other"]), "task-1")).toBe(
      false,
    );
  });

  it("多个信号并存时任一命中即判认领", () => {
    const s = fakeState({ queue: [{ taskId: "task-1" }] });
    expect(isTaskClaimedInProcess(s, cli(["task-1"]), "task-1")).toBe(true);
  });
});

/** `configureReaper` 接缝 smoke（P3 §5 第 1 期·最后一步：reaper lazy 化）。
 *  兼作 `configureReaper` 在 `check-dead-exports` 眼里的消费方。dynamic import
 *  拿 reaper 本体，避开给上面那批纯判决函数测试添加额外加载。 */
describe("configureReaper 接缝", () => {
  it("接受 Partial<ReaperDeps>、两次调用是合并语义", async () => {
    const mod = await import("./reaper");
    const fakeRepo = {
      listStaleQueued: async () => [],
      listStaleRunning: async () => [],
      finalizeFailure: async () => "written" as const,
      finalizeFromReaper: async () => "written" as const,
    };
    expect(() => mod.configureReaper({ taskRepo: fakeRepo })).not.toThrow();
    // 再来一次空 Partial：合法、只是没覆盖任何东西。
    expect(() => mod.configureReaper({})).not.toThrow();
  });
});
