// executor-scheduler 的调度契约测试（ISSUE #315）。
//
// processQueue 是任务从「排队」走到「提交给 ComfyUI」的唯一通道，它的三条
// 行为此前 0 覆盖（executor-scheduler.ts 行覆盖 0%），而每条都对应一次实际
// 卡住用户的故障：
//   1. WS 未就绪时任务不出队、但必须让用户看见「在等什么」（此前只有
//      「等待日志…」，用户不知道是没启动、自动启动中、还是连不上）；
//   2. 并发槽位满时直接返回，不把队列头部的任务取出去（否则任务会被
//      「取出来又没人执行」而永久悬挂）；
//   3. raw 路径抛异常时必须释放槽位，否则 active 永远卡在 1、后续所有
//      任务都排不进去。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/repository", () => ({
  taskRepository: {
    markRunning: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("~/server/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./client", () => ({ postPrompt: vi.fn(), resolveComfyBase: vi.fn() }));
vi.mock("./raw", () => ({ prepareGraphForExecution: vi.fn() }));
vi.mock("./validation", () => ({ extractValidationErrors: vi.fn().mockReturnValue([]) }));
vi.mock("./executor-cli", () => ({ executeViaComfyCli: vi.fn(), cliProcs: new Map() }));
vi.mock("./executor-finalize", () => ({
  fail: vi.fn().mockResolvedValue(undefined),
  finalizeFailure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./executor-ws", () => ({
  connect: vi.fn(),
  armWatchdog: vi.fn(),
}));
vi.mock("./executor-errors", () => ({ buildPromptError: vi.fn().mockReturnValue("boom") }));

import { taskRepository } from "../core/repository";
import { postPrompt } from "./client";
import { prepareGraphForExecution } from "./raw";
import { executeViaComfyCli } from "./executor-cli";
import { fail, finalizeFailure } from "./executor-finalize";
import { connect } from "./executor-ws";
import { state, MAX_CONCURRENCY } from "./runner-state";
import { processQueue } from "./executor-scheduler";

/* 被 mock 的函数统一经类型标注的取值函数暴露：直接写
 * `vi.mocked(taskRepository.markRunning)` 会触发
 * @typescript-eslint/unbound-method（把方法从对象上摘下来引用）。 */
type MockedFn = ReturnType<typeof vi.fn>;
function markRunningMock(): MockedFn {
  // taskRepository 的方法被 vi.mock 替换成 vi.fn()，此处读取的是那个 mock 函数
  // 本身、不参与 `this` 绑定——unbound-method 在此为误报（vi.mocked 的取值
  // 语义就是「把方法当作函数引用」）。
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return vi.mocked(taskRepository).markRunning;
}
function fnMock(source: unknown): MockedFn {
  return source as MockedFn;
}

/** 让 WS 处于 OPEN：processQueue 只认 `ws.readyState === OPEN`（1）。 */
function openWs() {
  state().ws = { readyState: 1 } as never;
}

function resetRunnerState() {
  const s = state();
  s.queue.length = 0;
  s.active = 0;
  s.ws = null;
  s.logs.clear();
  s.wsWaitLogged.clear();
  s.executedWorkflow.clear();
  s.promptToTask.clear();
  s.startedAt.clear();
  s.lastNodeByTask.clear();
  s.emitter.removeAllListeners();
}

function logsOf(taskId: string): string[] {
  return (state().logs.get(taskId) ?? []).map((e) => e.msg);
}

beforeEach(() => {
  resetRunnerState();
  vi.clearAllMocks();
  markRunningMock().mockResolvedValue(undefined);
  fnMock(fail).mockResolvedValue(undefined);
  fnMock(finalizeFailure).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processQueue — WS 未就绪时的可见等待", () => {
  it("WS 未 OPEN 时不出队，但给排队任务写一条「在等什么」的提示", async () => {
    state().queue.push({ taskId: "t-wait" });

    await processQueue();

    // 任务仍在队列里（没有被取出去丢掉）
    expect(state().queue).toHaveLength(1);
    // 但用户看得见它在等（不是只有「等待日志…」）
    expect(logsOf("t-wait").some((m) => m.includes("等待 ComfyUI"))).toBe(true);
    // 并且触发了一次重连
    expect(connect).toHaveBeenCalled();
  });

  it("同一条等待提示只写一次：3s 心跳反复触发也不能刷屏", async () => {
    state().queue.push({ taskId: "t-once" });

    await processQueue();
    await processQueue();
    await processQueue();

    const waits = logsOf("t-once").filter((m) => m.includes("等待 ComfyUI"));
    expect(waits).toHaveLength(1);
    expect(state().wsWaitLogged.has("t-once")).toBe(true);
  });

  it("多个排队任务各自都有提示（不是只提示队头）", async () => {
    state().queue.push({ taskId: "t-a" }, { taskId: "t-b" });

    await processQueue();

    expect(logsOf("t-a").some((m) => m.includes("等待 ComfyUI"))).toBe(true);
    expect(logsOf("t-b").some((m) => m.includes("等待 ComfyUI"))).toBe(true);
  });
});

describe("processQueue — 并发槽位", () => {
  it("槽位已满时直接返回且不取队头（取出来没人执行 = 任务永久悬挂）", async () => {
    openWs();
    state().active = MAX_CONCURRENCY;
    state().queue.push({ taskId: "t-slot" });

    await processQueue();

    expect(state().queue).toHaveLength(1);
    expect(postPrompt).not.toHaveBeenCalled();
  });

  it("队列为空时是幂等 no-op（心跳每 3s 调它不会产生副作用）", async () => {
    openWs();
    await processQueue();
    await processQueue();
    expect(state().queue).toHaveLength(0);
    expect(state().active).toBe(0);
  });
});

describe("processQueue — raw 路径异常必须释放槽位", () => {
  it("executeViaComfyCli 抛异常 → 交给 finalizeFailure 收口（槽位由收口路径释放），队列能继续推进", async () => {
    openWs();
    fnMock(executeViaComfyCli).mockRejectedValue(new Error("spawn python ENOENT"));
    state().queue.push({ taskId: "t-raw", rawJson: { "1": {} } });

    await processQueue();
    // raw 分支是 fire-and-forget + .catch，等微任务跑完
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // 关键契约：异常被 .catch 接住并**走统一收口路径**（而不是变成
    // unhandled rejection 让槽位永远卡在 1）。
    expect(finalizeFailure).toHaveBeenCalledWith("t-raw", "", "spawn python ENOENT");
    expect(logsOf("t-raw").some((m) => m.includes("raw 工作流启动异常"))).toBe(true);
  });

  it("收口路径本身再失败（DB down）→ 仍手动释放槽位，队列不被一条坏任务堵死", async () => {
    openWs();
    fnMock(executeViaComfyCli).mockRejectedValue(new Error("spawn failed"));
    fnMock(finalizeFailure).mockRejectedValue(new Error("db down"));
    state().queue.push({ taskId: "t-raw-db", rawJson: { "1": {} } });

    await processQueue();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // 二次失败必须走「手动 -1」兜底：这是保证队列继续推进的最后一道闸
    expect(state().active).toBe(0);
    expect(logsOf("t-raw-db").some((m) => m.includes("finalizeFailure 二次失败"))).toBe(true);
  });

  it("raw 路径正常启动时不写「启动异常」，槽位由后续收口释放", async () => {
    openWs();
    fnMock(executeViaComfyCli).mockResolvedValue(undefined);
    state().queue.push({ taskId: "t-raw-ok", rawJson: { "1": {} } });

    await processQueue();
    await new Promise((r) => setTimeout(r, 0));

    expect(logsOf("t-raw-ok").some((m) => m.includes("raw 工作流启动异常"))).toBe(false);
    expect(executeViaComfyCli).toHaveBeenCalled();
  });
});

describe("processQueue — API 格式路径的提交", () => {
  it("提交前先落一条「→ 准备提交」日志：/prompt 挂住时能判断请求到底发没发出去", async () => {
    openWs();
    fnMock(prepareGraphForExecution).mockReturnValue({
      graph: { "1": { class_type: "KSampler" } },
      removed: [],
      droppedInputs: 0,
    });
    fnMock(postPrompt).mockResolvedValue({ prompt_id: "p-1" });
    state().queue.push({ taskId: "t-api", prompt: { "1": {} } });

    await processQueue();

    const msgs = logsOf("t-api");
    expect(msgs.some((m) => m.includes("准备提交到 ComfyUI /prompt"))).toBe(true);
    expect(msgs.some((m) => m.includes("ComfyUI 已接收"))).toBe(true);
  });

  it("工作流被全部禁用（可执行节点为空）→ 明确失败，不提交空图", async () => {
    openWs();
    fnMock(prepareGraphForExecution).mockReturnValue({
      graph: {},
      removed: [],
      droppedInputs: 0,
    });
    state().queue.push({ taskId: "t-empty", prompt: { "1": {} } });

    await processQueue();

    expect(postPrompt).not.toHaveBeenCalled();
    const [, , reason] = fnMock(fail).mock.calls[0] as unknown as [string, string, string];
    expect(String(reason)).toContain("没有可执行的节点");
  });

  it("ComfyUI 报校验错误 → 逐条写进日志（用户能看到是哪个节点的哪个字段）", async () => {
    openWs();
    fnMock(prepareGraphForExecution).mockReturnValue({
      graph: { "5": { class_type: "KSampler" } },
      removed: [],
      droppedInputs: 0,
    });
    fnMock(postPrompt).mockResolvedValue({
      error: { type: "invalid_prompt" },
      node_errors: { "5": {} },
    });
    const { extractValidationErrors } = await import("./validation");
    vi.mocked(extractValidationErrors).mockReturnValue([
      { nodeId: "5", classType: "KSampler", field: "cfg", message: "must be a float" },
    ] as never);
    state().queue.push({ taskId: "t-bad", prompt: { "5": {} } });

    await processQueue();

    const msgs = logsOf("t-bad");
    expect(msgs.some((m) => m.includes("节点 5") && m.includes("cfg"))).toBe(true);
    expect(fail).toHaveBeenCalled();
  });
});
