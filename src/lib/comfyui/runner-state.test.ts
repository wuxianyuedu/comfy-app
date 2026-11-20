// runner-state 的宿主依赖注入接缝（P3 迁移第 1 期·第二步）的锁测：
//   · `configureRunner({ taskRepo })` 覆盖后，`persistLogs` 走注入侧、不再打
//     直连的 `taskRepository` 单例；
//   · `configureRunner({ log })` 覆盖后，DB 失败分支走注入侧、不再打 `logger`。
// 两条用例合起来把「接缝真的接上了」这件事钉死，兼作 `check-dead-exports`
// 眼里的消费方（同目录 `.test.ts` 算数，见 scripts/gates/check-dead-exports.cjs
// `TEST_CONSUMER_EXT`）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOGS_MAX_LINES, type LogEntry } from "./runner-state";

// 把 logger / taskRepository 都先 mock 掉，避免测试路径触到真库/真日志文件；
// 具体断言靠 configureRunner 注入的**第二层**替身完成，这两份 mock 只是「默认侧
// 的兜底哨兵」，用来证明「configureRunner 一覆盖，就走不到它们」。
const defaultTaskRepoMock = {
  appendLogs: vi.fn(() => Promise.resolve(undefined)),
  resetLogs: vi.fn(() => Promise.resolve(undefined)),
  replaceLogs: vi.fn(() => Promise.resolve(undefined)),
  replaceRawCli: vi.fn(() => Promise.resolve(undefined)),
};
const defaultLoggerMock = {
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../core/repository", () => ({
  taskRepository: defaultTaskRepoMock,
}));
vi.mock("~/lib/core/logger", () => ({ logger: defaultLoggerMock }));

// 上面两条 mock 必须先声明，import 才生效（vitest 会把 vi.mock hoist 到文件顶，
// 但被 mock 的模块里的**变量**要能被下面用例引用，所以 import 放最后）。
const loadRunnerState = async () => import("./runner-state");

describe("runner-state 的宿主依赖注入接缝（P3 第 1 期·第二步）", () => {
  beforeEach(async () => {
    defaultTaskRepoMock.replaceLogs.mockClear();
    defaultLoggerMock.warn.mockClear();
    // 把 deps 复位回默认，避免用例间串味（configureRunner 是**累积**覆盖，
    // 上一例注入的 fake 会留在这轮的 `deps` 里）。用同一份 mock 作为「注入的默认」，
    // 相当于把 deps 重新指回 taskRepository / logger 的替身。
    const mod = await loadRunnerState();
    mod.configureRunner({
      taskRepo: defaultTaskRepoMock,
      log: defaultLoggerMock,
    });
  });

  it("configureRunner({ taskRepo }) 之后 persistLogs 走注入侧、不再打默认 taskRepository", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(() => Promise.resolve(undefined));
    mod.configureRunner({
      taskRepo: {
        appendLogs: vi.fn(() => Promise.resolve(undefined)),
        resetLogs: vi.fn(() => Promise.resolve(undefined)),
        replaceLogs: injectedReplace,
        replaceRawCli: vi.fn(() => Promise.resolve(undefined)),
      },
    });

    await mod.persistLogs("t-di-ok");

    expect(injectedReplace).toHaveBeenCalledTimes(1);
    expect(injectedReplace).toHaveBeenCalledWith("t-di-ok", []);
    expect(defaultTaskRepoMock.replaceLogs).not.toHaveBeenCalled();
  });

  it("注入的 taskRepo 抛错时，configureRunner({ log }) 的 warn 收到「落库失败」消息", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(() => {
      throw new Error("db-on-fire");
    });
    const injectedWarn = vi.fn();
    mod.configureRunner({
      taskRepo: {
        appendLogs: vi.fn(() => Promise.resolve(undefined)),
        resetLogs: vi.fn(() => Promise.resolve(undefined)),
        replaceLogs: injectedReplace,
        replaceRawCli: vi.fn(() => Promise.resolve(undefined)),
      },
      log: { warn: injectedWarn },
    });

    await mod.persistLogs("t-di-fail");

    expect(injectedReplace).toHaveBeenCalledTimes(1);
    expect(injectedWarn).toHaveBeenCalledTimes(1);
    // 用 stringContaining 避开 `mock.calls[0]` 的 any 解构；两次断言各锁一个 substring，
    // 同一份调用参数会同时满足它们。
    expect(injectedWarn).toHaveBeenCalledWith(
      expect.stringContaining("persistLogs(t-di-fail) 落库失败"),
    );
    expect(injectedWarn).toHaveBeenCalledWith(expect.stringContaining("db-on-fire"));
    // 默认 logger 不该被绕过：注入 log 后失败分支只走注入侧。
    expect(defaultLoggerMock.warn).not.toHaveBeenCalled();
  });

  it("configureRunner 传 Partial 时未覆盖的一侧仍沿用默认（防止误清空）", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(() => Promise.resolve(undefined));
    // 只注入 taskRepo；log 一侧留空。
    mod.configureRunner({
      taskRepo: {
        appendLogs: vi.fn(() => Promise.resolve(undefined)),
        resetLogs: vi.fn(() => Promise.resolve(undefined)),
        replaceLogs: injectedReplace,
        replaceRawCli: vi.fn(() => Promise.resolve(undefined)),
      },
    });

    // 让 taskRepo 抛错，触发 log 分支。
    injectedReplace.mockRejectedValueOnce(new Error("boom"));
    await mod.persistLogs("t-partial");
    expect(injectedReplace).toHaveBeenCalledTimes(1);
    // 未覆盖侧应回到默认 logger 的替身（vitest mock），而不是抛「log undefined」。
    expect(defaultLoggerMock.warn).toHaveBeenCalledTimes(1);
    expect(defaultLoggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("落库失败"));
  });
});

/** 日志的轮次边界：入队 → 收口（ISSUE #1206）。边界曾画在领取处，那会把本轮排队期
 *  写下的「⏳ 等待…」一起抹掉；改到收口之后，上一轮的尾巴在上一轮结束时就让位。 */
/** 排队期写的行为什么要单独登记：领取会重开日志缓冲，不登记就连带抹掉等待原因
 *  （ISSUE #1206）。这两条钉住登记的取还语义，以及「落库是整包替换、所以收口之后
 *  还会再打的行不能靠提前删缓冲来处理」。 */
describe("logWhileQueued / takeQueuedEntries", () => {
  it("登记的行被 takeQueuedEntries 取回并接进缓冲，登记同时结束", async () => {
    const mod = await loadRunnerState();
    const s = mod.state();

    mod.logWhileQueued("t-q", "warn", "⏳ 等待 ComfyUI WebSocket 连接就绪…");
    expect(s.logs.get("t-q")).toHaveLength(1);

    const kept = mod.takeQueuedEntries("t-q");
    expect(kept.map((e) => e.msg)).toEqual(["⏳ 等待 ComfyUI WebSocket 连接就绪…"]);
    /* 只兑现一次：同一 taskId 的下一轮不该把上一轮的等待原因再搬一遍。 */
    expect(s.queuedEntries.has("t-q")).toBe(false);
    expect(mod.takeQueuedEntries("t-q")).toEqual([]);

    /* 领取处的形态：缓冲重开时以这份登记为起点，本轮现场接在后面。 */
    s.logs.set("t-q", kept);
    mod.log("t-q", "info", "任务已从队列领取");
    expect((s.logs.get("t-q") ?? []).map((e) => e.msg)).toEqual([
      "⏳ 等待 ComfyUI WebSocket 连接就绪…",
      "任务已从队列领取",
    ]);
  });

  it("普通 log() 不登记：执行现场的行不会被搬到下一轮", async () => {
    const mod = await loadRunnerState();
    mod.log("t-plain", "info", "执行中的一行");
    expect(mod.state().queuedEntries.has("t-plain")).toBe(false);
    expect(mod.takeQueuedEntries("t-plain")).toEqual([]);
    /* 本例留的防抖定时器与缓冲是模块级单例的跨用例残留：到点会在后续用例的
     * await 间隙触发落库、污染后续用例的替身调用面，用完即清。 */
    mod.cancelPersistLogs("t-plain");
    mod.state().logs.delete("t-plain");
  });

  it("落库是整包替换：收口之后再打的行必须仍带着之前的现场（不许提前删缓冲）", async () => {
    const mod = await loadRunnerState();
    const written: Array<Array<unknown>> = [];
    mod.configureRunner({
      taskRepo: {
        /* 增量档（#4605）的两条边也要在：persistLogs 先追加增量、再整包写列。 */
        appendLogs: vi.fn(() => Promise.resolve(undefined)),
        resetLogs: vi.fn(() => Promise.resolve(undefined)),
        replaceLogs: vi.fn((_taskId: string, entries: Array<LogEntry>) => {
          written.push(entries.map((e) => e.msg));
          return Promise.resolve(undefined);
        }),
        replaceRawCli: vi.fn(() => Promise.resolve(undefined)),
      },
    });
    /* 复刻真实时序：`complete()` 先 await persistLogs 落整包，**之后**才打
     *  「✓ 全部完成（总耗时 Xs）」。若在这里删掉缓冲，随后那一行带着自己的
     *  防抖落库就会把整列覆盖成一行——现场全丢（4-B5 第一版就是这么坏的）。 */
    mod.log("t-tail", "info", "输入参数（workflowInputs，4 项）");
    await mod.persistLogs("t-tail");
    mod.log("t-tail", "info", "✓ 全部完成（总耗时 6.8s）");
    await mod.persistLogs("t-tail");

    expect(written).toHaveLength(2);
    expect(written[0]).toEqual(["输入参数（workflowInputs，4 项）"]);
    expect(written[1]).toEqual(["输入参数（workflowInputs，4 项）", "✓ 全部完成（总耗时 6.8s）"]);
  });

  it("排队期登记有界：超过 LOGS_MAX_TASKS 个任务时淘汰最早登记的键", async () => {
    const mod = await loadRunnerState();
    const total = mod.LOGS_MAX_TASKS + 5;
    for (let i = 0; i < total; i += 1) {
      mod.logWhileQueued(`t-bound-${i}`, "warn", "⏳ 等待…");
    }

    const s = mod.state();
    expect(s.queuedEntries.size).toBeLessThanOrEqual(mod.LOGS_MAX_TASKS);
    /* Map 的迭代顺序=插入顺序，所以最早那批先出局，而最贴近当前排队的行留着。 */
    expect(s.queuedEntries.has("t-bound-0")).toBe(false);
    expect(s.queuedEntries.has(`t-bound-${total - 1}`)).toBe(true);

    /* 本例留下 69 份缓冲与未触发的落库定时器（模块级单例，跨用例存活）：到点后
     * 会在后续用例的 await 间隙批量触发落库，污染后续用例的替身调用面，甚至把
     * 后续用例刚写的日志从 LRU 里挤掉（实测咬掉首批的首行）。用完即清。 */
    for (let i = 0; i < total; i += 1) {
      mod.cancelPersistLogs(`t-bound-${i}`);
      mod.state().logs.delete(`t-bound-${i}`);
    }
  });
});

/* ── 防抖回调的最后兜底（#4221）────────────────────────────
 * persistLogs 的双重失败（落库失败 + logger 也炸）会 re-throw。定时器回调里
 * 原先写的是 `void persistLogs(...)`——没人接，rejection 冒成
 * unhandledRejection，Node ≥15 默认即退出进程。钉死「回调走 fireAndForget +
 * stderr 兜底」这条显式出口。 */
/** 一条流换成「只记录、不外发」的桩（形态对齐 capture-streams.server.test.ts）。 */
function recordWrite(bucket: Array<string>): typeof process.stderr.write {
  return (chunk: string | Uint8Array) => {
    bucket.push(String(chunk));
    return true;
  };
}

describe("定时器回调的双重失败兜底（#4221）", () => {
  it("落库与 logger 都炸时走 stderr 兜底，不产生 unhandledRejection", async () => {
    vi.useFakeTimers();
    const mod = await loadRunnerState();
    const stderrLines: Array<string> = [];
    const originalWrite: typeof process.stderr.write = process.stderr.write.bind(process.stderr);
    process.stderr.write = recordWrite(stderrLines);

    try {
      mod.configureRunner({
        taskRepo: {
          appendLogs: vi.fn(() => Promise.resolve(undefined)),
          resetLogs: vi.fn(() => Promise.resolve(undefined)),
          replaceLogs: () => Promise.reject(new Error("db gone")),
          replaceRawCli: () => Promise.resolve(undefined),
        },
        /* 注入一个自己也会炸的 warn：复刻「连 logger 都起不来」的双重失败现场。 */
        log: {
          warn: () => {
            throw new Error("logger gone");
          },
        },
      });
      mod.schedulePersistLogs("t-df");

      await vi.runAllTimersAsync();

      const joined = stderrLines.join("");
      expect(joined).toContain("persistLogs 双重失败");
      expect(joined).toContain("db gone");
    } finally {
      process.stderr.write = originalWrite;
      vi.useRealTimers();
    }
  });
});

describe("任务日志增量落库（#4605）：按 seq 追加，不再整包重写", () => {
  /** 每例自建一份注入替身（appendLogs / resetLogs 是本档新增的两条边）。 */
  async function injectRepo() {
    const mod = await loadRunnerState();
    const appendLogs = vi.fn((_taskId: string, _entries: Array<LogEntry>) =>
      Promise.resolve(undefined),
    );
    const resetLogs = vi.fn((_taskId: string) => Promise.resolve(undefined));
    const replaceLogs = vi.fn((_taskId: string, _entries: Array<LogEntry>) =>
      Promise.resolve(undefined),
    );
    mod.configureRunner({
      taskRepo: {
        appendLogs,
        resetLogs,
        replaceLogs,
        replaceRawCli: vi.fn(() => Promise.resolve(undefined)),
      },
      log: defaultLoggerMock,
    });
    return { mod, appendLogs, resetLogs, replaceLogs };
  }

  /** 本文件的若干用例会留下未清的防抖定时器，到点后会对**它们自己**的 taskId
   * 调 appendLogs、落进本例的替身。断言只看本例 taskId 的调用，天然隔离。 */
  function callsFor(
    fn: { mock: { calls: Array<[string, Array<{ msg: string; seq?: number }>]> } },
    taskId: string,
  ): Array<Array<{ msg: string; seq?: number }>> {
    return fn.mock.calls.filter((call) => call[0] === taskId).map((call) => call[1]);
  }

  it("flushLogsDelta 只追加「游标之后」的行；再 flush 只追新行，无增量不调用", async () => {
    const { mod, appendLogs, replaceLogs } = await injectRepo();
    const taskId = `t-inc-${Math.random().toString(36).slice(2, 8)}`;

    mod.log(taskId, "info", "one");
    mod.log(taskId, "info", "two");

    await mod.flushLogsDelta(taskId);

    const batches = callsFor(appendLogs, taskId);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((e) => e.msg)).toEqual(["one", "two"]);
    expect(batches[0]?.map((e) => e.seq)).toEqual([1, 2]);

    // 防抖窗口内又来的行 → 只追这一行；无新行 → 不再调用。
    mod.log(taskId, "info", "three");
    await mod.flushLogsDelta(taskId);
    expect(callsFor(appendLogs, taskId)).toHaveLength(2);
    expect(callsFor(appendLogs, taskId)[1]?.map((e) => e.msg)).toEqual(["three"]);

    await mod.flushLogsDelta(taskId);
    expect(callsFor(appendLogs, taskId)).toHaveLength(2);

    // 增量路径不碰整包列写——那是收口档（persistLogs）的事。
    expect(callsFor(replaceLogs, taskId)).toHaveLength(0);
    mod.cancelPersistLogs(taskId);
  });

  it("persistLogs（收口档）补齐增量后，把内存视图整包写一次 task.logs 列", async () => {
    const { mod, appendLogs, replaceLogs } = await injectRepo();
    const taskId = `t-fin-${Math.random().toString(36).slice(2, 8)}`;

    mod.log(taskId, "info", "one");
    await mod.flushLogsDelta(taskId);
    mod.log(taskId, "info", "two");
    mod.log(taskId, "info", "three");

    await mod.persistLogs(taskId);

    const batches = callsFor(appendLogs, taskId);
    expect(batches).toHaveLength(2);
    expect(batches[1]?.map((e) => e.msg)).toEqual(["two", "three"]);
    const written = callsFor(replaceLogs, taskId);
    expect(written).toHaveLength(1);
    expect(written[0]?.map((e) => e.msg)).toEqual(["one", "two", "three"]);
  });

  it("seq 跨轮次单调：resetLogsForRerun 清游标与表行，但行号不回退", async () => {
    const { mod, appendLogs, resetLogs } = await injectRepo();
    const taskId = `t-rr-${Math.random().toString(36).slice(2, 8)}`;

    mod.log(taskId, "info", "run1-a");
    mod.log(taskId, "info", "run1-b");
    await mod.flushLogsDelta(taskId);

    /* 重跑清场的真实顺序（executor-dispatch 领取段）：先重开内存缓冲，再清
     * 增量表与游标。这里照抄——缓冲里只剩新轮次要保留的行。 */
    mod.state().logs.set(taskId, []);
    await mod.resetLogsForRerun(taskId);

    expect(resetLogs).toHaveBeenCalledTimes(1);
    expect(resetLogs).toHaveBeenCalledWith(taskId);

    // 重跑后的第一行：seq 接着旧值往上走（不回到 1），SSE 游标因此跨轮次稳定。
    mod.log(taskId, "info", "run2-a");
    await mod.flushLogsDelta(taskId);
    const batches = callsFor(appendLogs, taskId);
    expect(batches).toHaveLength(2);
    expect(batches[1]?.map((e) => e.seq)).toEqual([3]);
    mod.cancelPersistLogs(taskId);
  });

  it("内存 5000 行封顶后，增量仍按 seq 对齐——已落库的行不会被再追一遍", async () => {
    const { mod, appendLogs } = await injectRepo();
    const taskId = `t-cap-${Math.random().toString(36).slice(2, 8)}`;

    for (let i = 1; i <= LOGS_MAX_LINES + 2; i += 1) {
      mod.log(taskId, "info", `l${i}`);
    }
    await mod.flushLogsDelta(taskId);
    const batches = callsFor(appendLogs, taskId);
    /* 内存视图 5000 行封顶（丢最旧）：首拍只能追到缓冲里还在线的那些行，
     * 被封顶挤掉的头两行与旧行为同命（整包重写也只写这 5000 行）。 */
    expect(batches).toHaveLength(1);
    expect(batches[0]?.length).toBe(LOGS_MAX_LINES);

    mod.log(taskId, "info", "tail");
    await mod.flushLogsDelta(taskId);
    const after = callsFor(appendLogs, taskId);
    expect(after).toHaveLength(2);
    expect(after[1]?.map((e) => e.msg)).toEqual(["tail"]);
    expect(after[1]?.[0]?.seq).toBe(LOGS_MAX_LINES + 3);
    mod.cancelPersistLogs(taskId);
  });
});
