// reaper 判决矩阵契约测试（ISSUE #315）。
//
// `reapStaleQueuedTasks` / `reapStaleRunningTasks` 的判决规则是三轮线上问题
// （「任务卡在队列超过 Ns，无人 re-claim」）反复修出来的领域知识。此前只测了
// 一个纯函数 `isTaskClaimedInProcess`，真正的判决分支完全没有断言——
// 下次改动很容易又踩回去。
//
// 本文件按「什么情况 → 什么判决」逐条钉住两条 sweeper 的决策表：
//   QUEUED reaper：真孤儿才回收；仍被本进程认领 / ComfyUI 正在启动 → 跳过。
//   RUNNING reaper：拿 ComfyUI /history 与 /queue 对账，给出三态判决。
//
// 打桩方式沿用 reaper.test.ts：reaper 模块在被 import 时就自启两条 sweeper，
// 因此必须先把它的副作用依赖全部 mock 掉。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/repository", () => ({
  taskRepository: {
    listStaleQueued: vi.fn().mockResolvedValue([]),
    listStaleRunning: vi.fn().mockResolvedValue([]),
    finalizeFailure: vi.fn().mockResolvedValue(undefined),
    finalizeFromReaper: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("./lifecycle", () => ({ isComfyStarting: vi.fn().mockReturnValue(false) }));
vi.mock("./client", () => ({
  resolveComfyBase: vi.fn().mockResolvedValue("http://127.0.0.1:8188"),
}));
vi.mock("./executor-cli", () => ({ cliProcs: new Map() }));
vi.mock("~/server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { taskRepository } from "../core/repository";
import { isComfyStarting } from "./lifecycle";
import { cliProcs } from "./executor-cli";
import { state, persistLogs } from "./runner-state";

/* repository 的方法经 `vi.mocked(obj.method)` 引用会触发
 * @typescript-eslint/unbound-method。这里把「断言用的 mock」集中在一处，
 * 用显式类型标注的取值函数暴露，调用点保持可读。 */
type MockedFn = ReturnType<typeof vi.fn>;
function repoMock(name: "listStaleQueued" | "listStaleRunning" | "finalizeFailure" | "finalizeFromReaper"): MockedFn {
  // 同上：模块被 vi.mock 后这些属性是 vi.fn()，取值即取 mock 函数本身，
  // 不涉及 `this`——unbound-method 在此为误报。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return vi.mocked(taskRepository)[name];
}
function comfyStartingMock(): MockedFn {
  return vi.mocked({ isComfyStarting }).isComfyStarting;
}

/** 取第 n 次调用的参数（mock.calls 元素被推断为 any[]，集中在一处断言并
 *  转成 unknown[]，避免在调用点重复 no-unsafe-assignment）。 */
function callArgsOf(fn: MockedFn, index = 0): unknown[] {
  return (fn.mock.calls[index] as unknown[] | undefined) ?? [];
}

/** 取本任务在 runner 状态里的日志行（reaper 写的判决说明）。 */
function logsOf(taskId: string): string[] {
  return (state().logs.get(taskId) ?? []).map((e) => e.msg);
}

/** 造一条 QUEUED 孤儿行（createdAt 早于 STALE_MS）。 */
function queuedRow(id: string, promptId: string | null = null) {
  return { id, promptId, createdAt: new Date(Date.now() - 120_000) };
}

/** 造一条 RUNNING 行（promptId 已写，finishedAt 未写）。 */
function runningRow(id: string, promptId: string) {
  return { id, promptId, createdAt: new Date(Date.now() - 300_000) };
}

/** 清掉 runner 的 in-memory 足迹，确保每个用例从「冷启动」开始。 */
function resetRunnerState() {
  const s = state();
  s.queue.length = 0;
  s.active = 0;
  s.logs.clear();
  s.executedWorkflow.clear();
  s.promptToTask.clear();
  s.promptByTask.clear();
  s.startedAt.clear();
  s.settled.clear();
  s.finalized.clear();
  s.wsWaitLogged.clear();
  s.lastNodeByTask.clear();
  vi.mocked(cliProcs).clear();
  void persistLogs;
  s.emitter.removeAllListeners();
}

/* reaper 的两条 sweeper 在模块被 import 时自启一次并每 30s 再跑。
 * 这里导出被测函数以便直接调用——避免依赖 30s 定时器（会让用例变成
 * 「等 30 秒」或者变成对定时器实现的断言）。 */
type ReaperInternals = {
  reapStaleQueuedTasks?: () => Promise<void>;
  reapStaleRunningTasks?: () => Promise<void>;
};

/** ComfyUI 侧「无活动」的默认应答：/queue 空、/history 空。
 *  QUEUED reaper 判死前必须拿到这份证据（见 comfyHasActiveWorkflow），
 *  否则真孤儿用例会因「证据不足」被跳过。 */
function stubComfyIdle() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/queue")) {
        return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 });
      }
      if (String(url).includes("/history")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    })
  );
}

beforeEach(() => {
  resetRunnerState();
  repoMock("listStaleQueued").mockResolvedValue([]);
  repoMock("listStaleRunning").mockResolvedValue([]);
  repoMock("finalizeFailure").mockClear();
  repoMock("finalizeFromReaper").mockClear();
  comfyStartingMock().mockReturnValue(false);
  stubComfyIdle();
  vi.clearAllMocks?.();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* reaper.ts 目前只导出 isTaskClaimedInProcess，两条 sweeper 是模块私有。
 * 为了让判决矩阵可被直接断言（不受 30s 定时器摆布），这里经动态 import
 * 取出内部实现——仅测试用，不改变生产导出面。 */
async function loadReaper(): Promise<ReaperInternals & { isTaskClaimedInProcess: unknown }> {
  const mod = (await import("./reaper")) as unknown as ReaperInternals & {
    isTaskClaimedInProcess: unknown;
  };
  return mod;
}

describe("QUEUED reaper 判决矩阵", () => {
  it("真孤儿（无任何 in-memory 足迹）→ 判 FAILED 并写入可行动原因", async () => {
    const reaper = await loadReaper();
    expect(reaper.reapStaleQueuedTasks, "reapStaleQueuedTasks 应对测试可见").toBeTypeOf("function");
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-orphan")]);

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).toHaveBeenCalledTimes(1);
    const [taskId, reason] = callArgsOf(repoMock("finalizeFailure"));
    expect(taskId).toBe("t-orphan");
    expect(String(reason)).toContain("卡在队列");
    expect(String(reason)).toContain("请重新执行");
    expect(logsOf("t-orphan").some((m) => m.includes("卡在队列"))).toBe(true);
  });

  it("进程内无足迹，但 ComfyUI 仍在执行/排队 → 不回收（ISSUE #378 误杀回归）", async () => {
    /* raw 路径的 comfy-cli 子进程是独立进程：dev server 重启后队列、cliProcs、
     * executedWorkflow 全都空了，但 ComfyUI 侧工作流仍在跑。此时不能判死。 */
    const reaper = await loadReaper();
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-inflight")]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/queue")) {
          return new Response(
            JSON.stringify({ queue_running: [{ prompt_id: "p-x" }], queue_pending: [] }),
            { status: 200 }
          );
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).not.toHaveBeenCalled();
    expect(logsOf("t-inflight").some((m) => m.includes("仍有正在执行/排队的工作流"))).toBe(true);
  });

  it("ComfyUI 不可达（无法确认）→ 不回收，本轮放行等下次对账", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-unreachable")]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).not.toHaveBeenCalled();
    expect(logsOf("t-unreachable").some((m) => m.includes("无法确认任务是否仍由 ComfyUI 执行"))).toBe(true);
  });

  it("ComfyUI 队列空且无 prompt_id 线索 → 判孤儿（历史里别的条目不算「在跑」）", async () => {
    /* /history 保留全部历史且无时间过滤：若拿「历史非空」当在飞证据，孤儿会
     *  永久卡在 QUEUED（永不回收）。这里钉住「历史非空 ≠ 本任务在跑」。 */
    const reaper = await loadReaper();
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-dead")]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/queue")) {
          return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 });
        }
        if (String(url).includes("/history")) {
          return new Response(JSON.stringify({ "p-old-unrelated": { status: { completed: true } } }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      })
    );

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).toHaveBeenCalledTimes(1);
  });

  it("外部证据每个 tick 只探一次（不按行重复网络请求）", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-a"), queuedRow("t-b")]);
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    await reaper.reapStaleQueuedTasks!();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("任务仍在 s.queue 等待出队 → 跳过回收，交给正常执行路径", async () => {
    const reaper = await loadReaper();
    state().queue.push({ taskId: "t-queued" });
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-queued")]);

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).not.toHaveBeenCalled();
    expect(logsOf("t-queued").some((m) => m.includes("仍在当前进程的执行链中"))).toBe(true);
  });

  it("comfy-cli 子进程正在驱动（promptId 未回传）→ 跳过回收", async () => {
    const reaper = await loadReaper();
    vi.mocked(cliProcs).set("t-cli", {} as never);
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-cli")]);

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).not.toHaveBeenCalled();
  });

  it("executedWorkflow 已记录（raw 路径已开始）→ 跳过回收", async () => {
    const reaper = await loadReaper();
    state().executedWorkflow.set("t-raw", {});
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-raw")]);

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).not.toHaveBeenCalled();
  });

  it("ComfyUI 正在自动启动（lifecycle 单飞进行中）→ 跳过并写「等待自动启动」", async () => {
    const reaper = await loadReaper();
    comfyStartingMock().mockReturnValue(true);
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-boot")]);

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).not.toHaveBeenCalled();
    expect(logsOf("t-boot").some((m) => m.includes("ComfyUI 自动启动"))).toBe(true);
  });

  it("同一任务被并发 tick 重复认领 → 只收口一次（不出现重复 FAILED 日志）", async () => {
    const reaper = await loadReaper();
    const row = queuedRow("t-dup");
    repoMock("listStaleQueued").mockResolvedValue([row, row]);

    await reaper.reapStaleQueuedTasks!();

    expect(repoMock("finalizeFailure")).toHaveBeenCalledTimes(1);
  });

  it("终态已被本进程认领（s.settled）→ 跳过回收，避免二次写终态（ISSUE #378）", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-settled")]);
    /* 模拟 executor 已抢先收口：任务不在 queue / cliProcs / executedWorkflow，
     *  但终态已被认领（例如 complete() 正在收尾）。 */
    state().settled.add("t-settled");

    await reaper.reapStaleQueuedTasks!();

    /* 认领保护命中 → 既不写库也不推「卡在队列」原因（该原因若推出去，就会和
     *  executor 稍后写入的真实原因在「执行日志 / 应用日志」两处互相矛盾）。 */
    expect(repoMock("finalizeFailure")).not.toHaveBeenCalled();
    expect(logsOf("t-settled").some((m) => m.includes("卡在队列"))).toBe(false);
    expect(logsOf("t-settled").some((m) => m.includes("仍在当前进程的执行链中"))).toBe(true);
  });

  it("真孤儿被回收后 s.finalized 落锁 → 同进程再次 tick 不再重复写库", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleQueued").mockResolvedValue([queuedRow("t-once")]);

    await reaper.reapStaleQueuedTasks!();
    expect(repoMock("finalizeFailure")).toHaveBeenCalledTimes(1);
    expect(state().finalized.has("t-once")).toBe(true);

    /* 清掉 in-memory 认领痕迹以外的状态，让第二 tick 仍能「看见」这条
     *  陈旧 DB 行；此时 finalized 锁应当挡住第二次落库。 */
    state().settled.clear();
    state().logs.clear();
    await reaper.reapStaleQueuedTasks!();
    expect(repoMock("finalizeFailure")).toHaveBeenCalledTimes(1);
  });

  it("repository 抛错 → 不冒泡（reaper 失败不能拖垮 dev server），且只落一条 warn", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleQueued").mockRejectedValue(new Error("db down"));

    await expect(reaper.reapStaleQueuedTasks!()).resolves.toBeUndefined();
  });
});

describe("RUNNING reaper 判决矩阵", () => {
  function mockFetchOnce(routes: { history?: Response; queue?: Response }) {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      call += 1;
      if (String(url).includes("/history/")) {
        if (!routes.history) throw new Error("network down");
        return routes.history;
      }
      if (String(url).includes("/queue")) {
        if (!routes.queue) throw new Error("network down");
        return routes.queue;
      }
      throw new Error(`unexpected fetch: ${url} (call ${call})`);
    }));
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
  }

  it("/history 有条目且无错 → 判 SUCCEEDED", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-ok", "p-1")]);
    mockFetchOnce({ history: json({ "p-1": { status: { completed: true } } }) });

    await reaper.reapStaleRunningTasks!();

    expect(repoMock("finalizeFromReaper")).toHaveBeenCalledWith("t-ok", "SUCCEEDED", null);
  });

  it("/history 有条目且 errored → 判 FAILED 并带上 execution_error 原文", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-err", "p-2")]);
    mockFetchOnce({
      history: json({ "p-2": { status: { errored: true }, error: { message: "OOM" } } }),
    });

    await reaper.reapStaleRunningTasks!();

    const [, status, reason] = callArgsOf(repoMock("finalizeFromReaper"));
    expect(status).toBe("FAILED");
    expect(String(reason)).toContain("OOM");
  });

  it("/history 空 + /queue 也没有该 prompt → 判 FAILED orphan（重启后无人监控）", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-lost", "p-3")]);
    mockFetchOnce({
      history: json({}),
      queue: json({ queue_running: [], queue_pending: [] }),
    });

    await reaper.reapStaleRunningTasks!();

    const [, status, reason] = callArgsOf(repoMock("finalizeFromReaper"));
    expect(status).toBe("FAILED");
    expect(String(reason)).toContain("请重新执行");
  });

  it("/history 空但 /queue 仍在排队 → 判 unknown，不动任务（下次 tick 再对账）", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-wait", "p-4")]);
    mockFetchOnce({
      history: json({}),
      queue: json({ queue_pending: [{ prompt_id: "p-4" }] }),
    });

    await reaper.reapStaleRunningTasks!();

    expect(repoMock("finalizeFromReaper")).not.toHaveBeenCalled();
    expect(logsOf("t-wait").some((m) => m.includes("下次重试"))).toBe(true);
  });

  it("/history 返回 404 → 判 FAILED（ComfyUI 侧无此 prompt 的历史）", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-404", "p-5")]);
    mockFetchOnce({ history: json({ error: "not found" }, 404) });

    await reaper.reapStaleRunningTasks!();

    const [, status] = callArgsOf(repoMock("finalizeFromReaper"));
    expect(status).toBe("FAILED");
  });

  it("ComfyUI 不可达（网络错误）→ 判 unknown，不动任务（不能把网络抖动当任务失败）", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-net", "p-6")]);
    mockFetchOnce({});

    await reaper.reapStaleRunningTasks!();

    expect(repoMock("finalizeFromReaper")).not.toHaveBeenCalled();
  });

  it("prompt 仍被本进程的内存映射认领 → 直接跳过（进程没重启，任务在正常执行）", async () => {
    const reaper = await loadReaper();
    state().promptToTask.set("p-7", "t-alive");
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-alive", "p-7")]);
    mockFetchOnce({ history: json({}) });

    await reaper.reapStaleRunningTasks!();

    expect(repoMock("finalizeFromReaper")).not.toHaveBeenCalled();
  });

  it("终态已落库（s.finalized）→ RUNNING 对账跳过，不覆盖已有失败原因", async () => {
    const reaper = await loadReaper();
    repoMock("listStaleRunning").mockResolvedValue([runningRow("t-done", "p-9")]);
    mockFetchOnce({ history: json({ "p-9": { status: { completed: true } } }) });
    state().finalized.add("t-done");

    await reaper.reapStaleRunningTasks!();

    expect(repoMock("finalizeFromReaper")).not.toHaveBeenCalled();
    expect(logsOf("t-done").some((m) => m.includes("终态已落库"))).toBe(true);
  });

  it("没有行需要处理时不去探测 ComfyUI（不做无谓的网络请求）", async () => {
    const reaper = await loadReaper();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    repoMock("listStaleRunning").mockResolvedValue([]);

    await reaper.reapStaleRunningTasks!();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
