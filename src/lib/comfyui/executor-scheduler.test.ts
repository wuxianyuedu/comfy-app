// executor-scheduler 的调度契约测试（ISSUE #315）。
//
// processQueue 是任务从「排队」走到「提交给 comfy-cli」的唯一通道，它的几条
// 行为此前 0 覆盖（executor-scheduler.ts 行覆盖 0%），而每条都对应一次实际
// 卡住用户的故障：
//   1. WS 未就绪时任务不出队、但必须让用户看见「在等什么」（此前只有
//      「等待日志…」，用户不知道是没启动、自动启动中、还是连不上）；
//   2. 并发槽位满时直接返回，不把队列头部的任务取出去（否则任务会被
//      「取出来又没人执行」而永久悬挂）；
//   3. 提交路径抛异常时必须释放槽位，否则 active 永远卡在 1、后续所有
//      任务都排不进去；
//   4. **两种载荷（RAW 原件 / API 图）都只能交 comfy-cli** —— 这是 ISSUE #632
//      之后的唯一提交口径（此前 API 走 postPrompt，两条路径各自维护一套
//      提交与报错文案）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
/* runner-state 会经 `core/repository` 拖进 `server/db` → `env.js` 的必填校验；
 * 这一层 mock 让本用例无需 `.env` / 数据库即可跑（与同目录其它用例同口径）。 */
vi.mock("../core/repository", () => ({
  taskRepository: {
    markRunning: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("./executor-cli", () => ({
  executeViaComfyCli: vi.fn(),
  cliProcs: new Map(),
}));
vi.mock("./executor-finalize", () => ({
  finalizeFailure: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./executor-ws", () => ({
  connect: vi.fn(),
}));

import { executeViaComfyCli } from "./executor-cli";
import { finalizeFailure } from "./executor-finalize";
import { connect } from "./executor-ws";
import { state, MAX_CONCURRENCY } from "./runner-state";
import { processQueue } from "./executor-scheduler";

function fnMock(source: unknown): ReturnType<typeof vi.fn> {
  return source as ReturnType<typeof vi.fn>;
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
  fnMock(executeViaComfyCli).mockResolvedValue(undefined);
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
    expect(executeViaComfyCli).not.toHaveBeenCalled();
  });

  it("队列为空时是幂等 no-op（心跳每 3s 调它不会产生副作用）", async () => {
    openWs();
    await processQueue();
    await processQueue();
    expect(state().queue).toHaveLength(0);
    expect(state().active).toBe(0);
  });
});

describe("processQueue — 提交路径只有 comfy-cli（两种载荷都不例外）", () => {
  it("RAW 载荷：原样交给 comfy-cli（含画布覆盖项）", async () => {
    openWs();
    const rawJson = { nodes: [{ id: "1", type: "KSampler" }] };
    state().queue.push({
      taskId: "t-raw",
      rawJson,
      overrides: [{ nodeId: "1", name: "seed", value: 42 }],
    });

    await processQueue();

    expect(executeViaComfyCli).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "t-raw",
        rawJson,
        overrides: [{ nodeId: "1", name: "seed", value: 42 }],
      }),
    );
  });

  it("API 载荷：同样交给 comfy-cli，不再走 /prompt", async () => {
    openWs();
    const prompt = { "3": { class_type: "KSampler", inputs: {} } };
    state().queue.push({ taskId: "t-api", prompt });

    await processQueue();

    expect(executeViaComfyCli).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "t-api", prompt }),
    );
  });

  it("把 workflowInputs 全量打进任务日志（dev 重启后日志是唯一现场）", async () => {
    openWs();
    state().queue.push({
      taskId: "t-log",
      rawJson: { nodes: [] },
      overrides: [{ nodeId: "1", name: "text", value: "a cat" }],
    });

    await processQueue();

    const msgs = logsOf("t-log");
    expect(msgs.some((m) => m.includes("workflowInputs"))).toBe(true);
    expect(msgs.some((m) => m.includes("a cat"))).toBe(true);
  });
});

describe("processQueue — 提交异常必须释放槽位", () => {
  it("executeViaComfyCli 抛异常 → 交给 finalizeFailure 收口（槽位由收口路径释放），队列能继续推进", async () => {
    openWs();
    fnMock(executeViaComfyCli).mockRejectedValue(
      new Error("spawn python ENOENT"),
    );
    state().queue.push({ taskId: "t-err", rawJson: { "1": {} } });

    await processQueue();
    // 提交是 fire-and-forget + .catch，等微任务跑完
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // 关键契约：异常被 .catch 接住并**走统一收口路径**（而不是变成
    // unhandled rejection 让槽位永远卡在 1）。
    expect(finalizeFailure).toHaveBeenCalledWith(
      "t-err",
      "",
      "spawn python ENOENT",
    );
    expect(logsOf("t-err").some((m) => m.includes("工作流启动异常"))).toBe(
      true,
    );
  });

  it("收口路径本身再失败（DB down）→ 仍手动释放槽位，队列不被一条坏任务堵死", async () => {
    openWs();
    fnMock(executeViaComfyCli).mockRejectedValue(new Error("spawn failed"));
    fnMock(finalizeFailure).mockRejectedValue(new Error("db down"));
    state().queue.push({ taskId: "t-err-db", prompt: { "1": {} } });

    await processQueue();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // 二次失败必须走「手动 -1」兜底：这是保证队列继续推进的最后一道闸
    expect(state().active).toBe(0);
    expect(
      logsOf("t-err-db").some((m) => m.includes("finalizeFailure 二次失败")),
    ).toBe(true);
  });

  it("提交正常启动时不写「启动异常」，槽位由后续收口释放", async () => {
    openWs();
    state().queue.push({ taskId: "t-ok", rawJson: { "1": {} } });

    await processQueue();
    await new Promise((r) => setTimeout(r, 0));

    expect(logsOf("t-ok").some((m) => m.includes("工作流启动异常"))).toBe(
      false,
    );
    expect(executeViaComfyCli).toHaveBeenCalled();
  });
});
