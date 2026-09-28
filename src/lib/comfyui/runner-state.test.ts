// runner-state 的宿主依赖注入接缝（P3 迁移第 1 期·第二步）的锁测：
//   · `configureRunner({ taskRepo })` 覆盖后，`persistLogs` 走注入侧、不再打
//     直连的 `taskRepository` 单例；
//   · `configureRunner({ log })` 覆盖后，DB 失败分支走注入侧、不再打 `logger`。
// 两条用例合起来把「接缝真的接上了」这件事钉死，兼作 `check-dead-exports`
// 眼里的消费方（同目录 `.test.ts` 算数，见 scripts/check-dead-exports.cjs
// `TEST_CONSUMER_EXT`）。

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "./runner-state";

// 把 logger / taskRepository 都先 mock 掉，避免测试路径触到真库/真日志文件；
// 具体断言靠 configureRunner 注入的**第二层**替身完成，这两份 mock 只是「默认侧
// 的兜底哨兵」，用来证明「configureRunner 一覆盖，就走不到它们」。
const defaultTaskRepoMock = {
  replaceLogs: vi.fn(async () => undefined),
  replaceRawCli: vi.fn(async () => undefined),
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
    const injectedReplace = vi.fn(async () => undefined);
    mod.configureRunner({
      taskRepo: {
        replaceLogs: injectedReplace,
        replaceRawCli: vi.fn(async () => undefined),
      },
    });

    await mod.persistLogs("t-di-ok");

    expect(injectedReplace).toHaveBeenCalledTimes(1);
    expect(injectedReplace).toHaveBeenCalledWith("t-di-ok", []);
    expect(defaultTaskRepoMock.replaceLogs).not.toHaveBeenCalled();
  });

  it("注入的 taskRepo 抛错时，configureRunner({ log }) 的 warn 收到「落库失败」消息", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(async () => {
      throw new Error("db-on-fire");
    });
    const injectedWarn = vi.fn();
    mod.configureRunner({
      taskRepo: {
        replaceLogs: injectedReplace,
        replaceRawCli: vi.fn(async () => undefined),
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
    expect(injectedWarn).toHaveBeenCalledWith(
      expect.stringContaining("db-on-fire"),
    );
    // 默认 logger 不该被绕过：注入 log 后失败分支只走注入侧。
    expect(defaultLoggerMock.warn).not.toHaveBeenCalled();
  });

  it("configureRunner 传 Partial 时未覆盖的一侧仍沿用默认（防止误清空）", async () => {
    const mod = await loadRunnerState();
    const injectedReplace = vi.fn(async () => undefined);
    // 只注入 taskRepo；log 一侧留空。
    mod.configureRunner({
      taskRepo: {
        replaceLogs: injectedReplace,
        replaceRawCli: vi.fn(async () => undefined),
      },
    });

    // 让 taskRepo 抛错，触发 log 分支。
    injectedReplace.mockRejectedValueOnce(new Error("boom"));
    await mod.persistLogs("t-partial");
    expect(injectedReplace).toHaveBeenCalledTimes(1);
    // 未覆盖侧应回到默认 logger 的替身（vitest mock），而不是抛「log undefined」。
    expect(defaultLoggerMock.warn).toHaveBeenCalledTimes(1);
    expect(defaultLoggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining("落库失败"),
    );
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
    expect(kept.map((e) => e.msg)).toEqual([
      "⏳ 等待 ComfyUI WebSocket 连接就绪…",
    ]);
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
  });

  it("落库是整包替换：收口之后再打的行必须仍带着之前的现场（不许提前删缓冲）", async () => {
    const mod = await loadRunnerState();
    const written: unknown[][] = [];
    mod.configureRunner({
      taskRepo: {
        replaceLogs: vi.fn(async (_taskId: string, entries: LogEntry[]) => {
          written.push(entries.map((e) => e.msg));
        }),
        replaceRawCli: vi.fn(async () => undefined),
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
    expect(written[1]).toEqual([
      "输入参数（workflowInputs，4 项）",
      "✓ 全部完成（总耗时 6.8s）",
    ]);
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
  });
});
