/**
 * `executor-dispatch.ts` 的派发契约（P3 §5 ADR §14 D1 的第二刀，取代原
 * `executor-scheduler.test.ts`）。
 *
 * 这四组行为每一条都对应一次实际卡住用户的故障，判据从「内存队列」换成「库里的行」
 * 之后必须一条不落地还成立：
 *   1. 不就绪**不领行**——原来的写法是「先出队再等 WS」，队列没了以后如果还先领，
 *      行会被翻成 RUNNING 却什么都不跑（§14 D1 要消灭的形态）；
 *   2. 槽位满不领；
 *   3. 载荷两种格式都只能交 comfy-cli（ISSUE #632 之后的唯一提交口径）；
 *   4. 提交异常必须归还槽位，否则一条坏任务永久占住 `MAX_CONCURRENCY=1`。
 * 新增的两组是这一刀带来的：领取时清掉上一轮的收口一次性锁（重跑语义；日志缓冲的
 * 轮次边界在**收口**处，见 ISSUE #1206），以及「广播给还在排队的行」——它原来读内存队列，现在读库。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./executor-cli", () => ({
  executeViaComfyCli: vi.fn(),
  cliProcs: new Map(),
}));
vi.mock("./executor-ws", () => ({ connect: vi.fn() }));
vi.mock("./executor-finalize", () => ({ finalizeFailure: vi.fn() }));
/* Next 侧兜底会 dynamic import barrel；这里让它失败，用来验「未注入」那条路。 */
vi.mock("../core/repository", () => {
  throw new Error("server-only in tests");
});

const mod = await import("./executor-dispatch");
const cli = await import("./executor-cli");
const ws = await import("./executor-ws");
const fin = await import("./executor-finalize");
const continuation = await import("./executor-continuation");
const runner = await import("./runner-state");
const { state, MAX_CONCURRENCY } = runner;

/* `log()` 每写一行都排一个 200ms 防抖落库，而那次落库走 runner-state 的
 * `resolveDeps` → dynamic import barrel；本文件把 barrel mock 成「抛错」（用来验
 * 未注入那条路），所以不先把注入侧补上，每个用例都会留一串 unhandled rejection
 * （与 `enqueue.test.ts` 同一处置）。 */
const runnerPersist = {
  replaceLogs: vi.fn(async () => undefined),
  replaceRawCli: vi.fn(async () => undefined),
};
const runnerWarn = vi.fn();

/** `findExecJob` 的行形状（与 impl 一致，测试里不复制第二份判据）。 */
type ExecJobRow = {
  workflowName: string;
  execPayload: unknown;
  params: unknown;
} | null;

/** 注入用的假仓储：四条读写的调用都记下来，断言不依赖实现细节。 */
function fakeRepo(overrides: Record<string, unknown> = {}) {
  return {
    claimNextQueued: vi.fn(async () => [] as string[]),
    findExecJob: vi.fn(async () => null as ExecJobRow),
    finalizeFailure: vi.fn(async () => "written" as const),
    listQueuedIds: vi.fn(async () => [] as string[]),
    ...overrides,
  };
}

function openWs() {
  state().ws = { readyState: 1 } as never;
}

function resetRunnerState() {
  const s = state();
  s.pendingDispatch.clear();
  s.ws = null;
  s.logs.clear();
  s.queuedEntries.clear();
  s.wsWaitLogged.clear();
  s.executedWorkflow.clear();
  s.promptToTask.clear();
  s.promptByTask.clear();
  s.startedAt.clear();
  s.lastNodeByTask.clear();
  s.settled.clear();
  s.finalized.clear();
  s.lastLogPct.clear();
}

function logsOf(taskId: string): string[] {
  return (state().logs.get(taskId) ?? []).map((e) => e.msg);
}

/** 提交是 fire-and-forget + `.catch`，等微任务跑完才能断收口。 */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  resetRunnerState();
  vi.clearAllMocks();
  vi.mocked(cli.executeViaComfyCli).mockResolvedValue(undefined);
  vi.mocked(fin.finalizeFailure).mockResolvedValue(undefined);
  vi.mocked(ws.connect).mockResolvedValue(undefined);
  // 每个用例默认注入一份「什么都领不到」的假仓储 + inline 归属。
  mod.configureDispatch({ taskRepo: fakeRepo(), owner: "inline" });
  runner.configureRunner({
    taskRepo: runnerPersist,
    log: { warn: runnerWarn },
  });
});

afterEach(() => {
  mod.stopDispatchLoop();
  vi.restoreAllMocks();
});

describe("就绪门控：不就绪就不领行", () => {
  it("WS 未 OPEN 时不领取，但把「在等什么」写进还在排队的行", async () => {
    const repo = fakeRepo({ listQueuedIds: vi.fn(async () => ["t-wait"]) });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    expect(await mod.claimAndDispatchOnce()).toBeNull();

    expect(repo.claimNextQueued).not.toHaveBeenCalled();
    expect(ws.connect).toHaveBeenCalledTimes(1);
    expect(logsOf("t-wait").some((m) => m.includes("等待 ComfyUI"))).toBe(true);
  });

  it("同一条等待提示只写一次：2s 节拍反复撞不就绪也不能刷屏", async () => {
    const repo = fakeRepo({ listQueuedIds: vi.fn(async () => ["t-once"]) });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();
    await mod.claimAndDispatchOnce();
    await mod.claimAndDispatchOnce();

    expect(
      logsOf("t-once").filter((m) => m.includes("等待 ComfyUI")),
    ).toHaveLength(1);
  });

  it("多条排队行各自都有提示（不是只提示最旧那条）", async () => {
    const repo = fakeRepo({
      listQueuedIds: vi.fn(async () => ["t-a", "t-b"]),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();

    expect(logsOf("t-a").some((m) => m.includes("等待 ComfyUI"))).toBe(true);
    expect(logsOf("t-b").some((m) => m.includes("等待 ComfyUI"))).toBe(true);
  });
});

describe("槽位判据", () => {
  it("本进程在飞数已满时不领行（领了没人跑 = 悬挂）", async () => {
    openWs();
    const repo = fakeRepo();
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });
    state().pendingDispatch.add("running-1");
    expect(state().pendingDispatch.size).toBe(MAX_CONCURRENCY);

    expect(await mod.claimAndDispatchOnce()).toBeNull();
    expect(repo.claimNextQueued).not.toHaveBeenCalled();
    expect(cli.executeViaComfyCli).not.toHaveBeenCalled();
  });

  it("库里没行可领时是幂等 no-op（循环每 2s 撞一次不产生副作用）", async () => {
    openWs();
    const repo = fakeRepo();
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();
    await mod.claimAndDispatchOnce();

    expect(state().pendingDispatch.size).toBe(0);
    expect(cli.executeViaComfyCli).not.toHaveBeenCalled();
  });

  it("领取那一次写失败：日志必须把驱动错误码带出来（ISSUE #1262 的前置）", async () => {
    /* 为什么钉这一条：#1262 现场只有一句 `Failed query: update "task" set …`，
     * 分不清是「别的进程扣着写锁」「没这张表」还是「连接本身坏了」，于是那次
     * 「窗口散掉之后还写不进去」的读数至今无法归因。终态那条路 #1250 已经修好了，
     * 领取这条路一直是瞎的 —— 断言引的就是这句 warn 本身。 */
    openWs();
    const wrapped = new Error(
      'Failed query: update "task" set "status" = ? where "task"."id" in (select …) returning "id"',
    );
    wrapped.cause = { code: "SQLITE_BUSY", message: "database is locked" };
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => {
        throw wrapped;
      }),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    expect(await mod.claimAndDispatchOnce()).toBeNull();

    const { logger } = await import("~/lib/core/logger");
    const warned = vi
      .mocked(logger.warn)
      .mock.calls.map((c) => String(c[0]))
      .filter((m) => m.includes("领取队列任务失败"))
      .join("\n");
    expect(warned).toContain("SQLITE_BUSY");
    expect(warned).toContain("database is locked");
  });
});

describe("领取 → 提交（两种载荷都只交 comfy-cli）", () => {
  it("领到行：按 execPayload 重建 Job、记在飞、开新日志缓冲", async () => {
    openWs();
    const rawJson = { nodes: [{ id: "1", type: "KSampler" }] };
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => ["t-raw"]),
      findExecJob: vi.fn(async (): Promise<ExecJobRow> => ({
        workflowName: "w",
        execPayload: rawJson,
        params: { workflowInputs: [{ nodeId: "1", name: "seed", value: 42 }] },
      })),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    expect(await mod.claimAndDispatchOnce()).toBe("t-raw");
    // 谓词是本进程的归属，不是硬编码 host。
    expect(repo.claimNextQueued).toHaveBeenCalledWith("inline", 1);
    expect(cli.executeViaComfyCli).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "t-raw",
        workflowName: "w",
        rawJson,
        overrides: [{ nodeId: "1", name: "seed", value: 42 }],
      }),
    );
    expect(state().pendingDispatch.has("t-raw")).toBe(true);
    expect(typeof state().startedAt.get("t-raw")).toBe("number");
    expect(logsOf("t-raw").some((m) => m.includes("任务已从队列领取"))).toBe(
      true,
    );
  });

  it("把 workflowInputs 全量打进任务日志（dev 重启后日志是唯一现场）", async () => {
    openWs();
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => ["t-log"]),
      findExecJob: vi.fn(async (): Promise<ExecJobRow> => ({
        workflowName: "w",
        execPayload: { nodes: [] },
        params: {
          workflowInputs: [{ nodeId: "1", name: "text", value: "a cat" }],
        },
      })),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();

    const msgs = logsOf("t-log");
    expect(msgs.some((m) => m.includes("workflowInputs"))).toBe(true);
    expect(msgs.some((m) => m.includes("a cat"))).toBe(true);
  });

  it("等待提示在同一条被领走之后仍在：缓冲重开时接回本轮排队期的行", async () => {
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => ["t-rerun"]),
      listQueuedIds: vi.fn(async () => ["t-rerun"]),
      findExecJob: vi.fn(async (): Promise<ExecJobRow> => ({
        workflowName: "w",
        execPayload: { nodes: [] },
        params: {},
      })),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });
    state().settled.add("t-rerun");
    state().finalized.add("t-rerun");

    /* 第一拍：WS 未就绪 → 不领行，只把「在等什么」写进还在排队的行。 */
    expect(await mod.claimAndDispatchOnce()).toBeNull();
    expect(repo.claimNextQueued).not.toHaveBeenCalled();

    openWs();
    await mod.claimAndDispatchOnce();

    /* 两把一次性收口锁仍然在领取时清（重跑语义）。 */
    expect(state().settled.has("t-rerun")).toBe(false);
    expect(state().finalized.has("t-rerun")).toBe(false);
    /* 这一条是 ISSUE #1206 的本体：`logs.set(taskId, [])` 曾把等待提示一起抹掉，
     *  而回收器不再兜底判死排队行之后（ISSUE #1204），它是唯一说明「这条在等什么」
     *  的出口。顺序也要成立——等待在前、开跑在后，用户才看得出中间隔了多久。 */
    const msgs = logsOf("t-rerun");
    const iWait = msgs.findIndex((m) => m.includes("等待 ComfyUI"));
    const iClaim = msgs.findIndex((m) => m.includes("任务已从队列领取"));
    expect(iWait).toBeGreaterThanOrEqual(0);
    expect(iClaim).toBeGreaterThan(iWait);
  });

  it("排队期的登记只兑现一次：领取之后就结束，不会被下一轮复用", async () => {
    openWs();
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => ["t-once-seed"]),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });
    state().queuedEntries.set("t-once-seed", [
      { t: 1, level: "warn", msg: "⏳ 等待 ComfyUI WebSocket 连接就绪…" },
    ]);

    await mod.claimAndDispatchOnce();

    expect(state().queuedEntries.has("t-once-seed")).toBe(false);
    expect(logsOf("t-once-seed")[0]).toContain("等待 ComfyUI");
  });

  it("行没有执行载荷：判失败并归还槽位，不留 RUNNING 僵尸", async () => {
    openWs();
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => ["t-empty"]),
      findExecJob: vi.fn(async (): Promise<ExecJobRow> => ({
        workflowName: "w",
        execPayload: null,
        params: {},
      })),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();

    expect(repo.finalizeFailure).toHaveBeenCalledWith(
      "t-empty",
      expect.stringContaining("execPayload"),
    );
    expect(cli.executeViaComfyCli).not.toHaveBeenCalled();
    expect(state().pendingDispatch.has("t-empty")).toBe(false);
  });

  it("载荷读不到（行已被删/收口）：不提交、槽位归还", async () => {
    openWs();
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => ["t-gone"]),
      findExecJob: vi.fn(async () => null),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();

    expect(cli.executeViaComfyCli).not.toHaveBeenCalled();
    expect(state().pendingDispatch.has("t-gone")).toBe(false);
  });
});

describe("提交异常必须归还槽位", () => {
  it("executeViaComfyCli reject → 走统一收口路径，不是 unhandled rejection", async () => {
    openWs();
    vi.mocked(cli.executeViaComfyCli).mockRejectedValue(
      new Error("spawn python ENOENT"),
    );
    const repo = fakeRepo({
      // 领过的行在库里已是 RUNNING，不会再被领到——用 Once 表达这件事
      claimNextQueued: vi
        .fn()
        .mockResolvedValueOnce(["t-err"])
        .mockResolvedValue([]),
      findExecJob: vi.fn(async (): Promise<ExecJobRow> => ({
        workflowName: "w",
        execPayload: { "1": {} },
        params: {},
      })),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();
    await flush();

    expect(fin.finalizeFailure).toHaveBeenCalledWith(
      "t-err",
      "",
      "spawn python ENOENT",
    );
    expect(logsOf("t-err").some((m) => m.includes("工作流启动异常"))).toBe(
      true,
    );
  });

  it("收口路径本身再失败（DB down）→ 仍手动归还，队列不被一条坏任务堵死", async () => {
    openWs();
    vi.mocked(cli.executeViaComfyCli).mockRejectedValue(
      new Error("spawn failed"),
    );
    vi.mocked(fin.finalizeFailure).mockRejectedValue(new Error("db down"));
    const repo = fakeRepo({
      claimNextQueued: vi
        .fn()
        .mockResolvedValueOnce(["t-err-db"])
        .mockResolvedValue([]),
      findExecJob: vi.fn(async (): Promise<ExecJobRow> => ({
        workflowName: "w",
        execPayload: { "1": {} },
        params: {},
      })),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();
    await flush();

    expect(state().pendingDispatch.size).toBe(0);
    expect(
      logsOf("t-err-db").some((m) => m.includes("finalizeFailure 二次失败")),
    ).toBe(true);
    /* 关键契约：double-failure = 「库此刻写不进去」，此时立刻再领一次就是在那儿
     * 自旋。推进交给常驻节拍，所以这一拍之内 `claimNextQueued` 只被调一次。 */
    expect(repo.claimNextQueued).toHaveBeenCalledTimes(1);
  });

  it("正常启动时不写「启动异常」，槽位留给后续收口归还", async () => {
    openWs();
    const repo = fakeRepo({
      claimNextQueued: vi.fn(async () => ["t-ok"]),
      findExecJob: vi.fn(async (): Promise<ExecJobRow> => ({
        workflowName: "w",
        execPayload: { "1": {} },
        params: {},
      })),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "inline" });

    await mod.claimAndDispatchOnce();
    await flush();

    expect(logsOf("t-ok").some((m) => m.includes("工作流启动异常"))).toBe(
      false,
    );
    expect(state().pendingDispatch.has("t-ok")).toBe(true);
  });
});

describe("叶子总线接线（这一刀把它从一条回调扩成两条）", () => {
  it("dispatch 加载即注册续跑与广播；广播写给本归属片里排队的行", async () => {
    const repo = fakeRepo({
      listQueuedIds: vi.fn(async () => ["t-q1", "t-q2"]),
    });
    mod.configureDispatch({ taskRepo: repo, owner: "host" });

    continuation.announceToQueuedTasks(
      "ComfyUI 已就绪，继续执行工作流…",
      "success",
    );
    await flush();

    // 归属跟着注入的 owner 走：host 进程不往 inline 的行上写提示。
    expect(repo.listQueuedIds).toHaveBeenCalledWith("host", 20);
    expect(logsOf("t-q1").some((m) => m.includes("已就绪"))).toBe(true);
    expect(logsOf("t-q2").some((m) => m.includes("已就绪"))).toBe(true);
  });

  it("纯 Node 宿主未注入时本轮跳过、只 warn 一次，不抛", async () => {
    // `configureDispatch` 是覆盖语义、清不掉已注入的句柄，所以这里重取一份
    // 未注入的模块实例：barrel 那条兜底已被上面的 vi.mock 改成抛错，走的正是
    // 「注入缺失 + barrel 不可达」这条纯 Node 宿主开机时真实会经过的路。
    vi.resetModules();
    const fresh = await import("./executor-dispatch");
    const runnerState = await import("./runner-state");
    runnerState.state().ws = { readyState: 1 } as never;

    expect(await fresh.claimAndDispatchOnce()).toBeNull();

    const { logger } = await import("~/lib/core/logger");
    const warns = vi
      .mocked(logger.warn)
      .mock.calls.filter((c) => String(c[0]).includes("未注入"));
    expect(warns.length).toBeLessThanOrEqual(1);
    fresh.stopDispatchLoop();
  });
});

describe("循环启动点由宿主显式调用（模块加载零副作用）", () => {
  it("加载模块不起循环；startDispatchLoop 幂等、stopDispatchLoop 收干净", () => {
    expect(globalThis.__comfyDispatch_v1?.handle ?? null).toBeNull();

    mod.startDispatchLoop(50);
    const first = globalThis.__comfyDispatch_v1?.handle;
    mod.startDispatchLoop(50);
    expect(globalThis.__comfyDispatch_v1?.handle).toBe(first);

    mod.stopDispatchLoop();
    expect(globalThis.__comfyDispatch_v1?.handle).toBeNull();
  });
});
