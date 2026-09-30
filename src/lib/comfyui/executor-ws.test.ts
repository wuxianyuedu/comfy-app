// executor-ws 的两格判据：
//  ① `configureExecutorWs` 接缝 smoke（P3 §5 第 1 期·最后一步：executor-ws lazy 化）；
//  ② `handleMessage` 对**一帧 progress / executing** 的判决（ISSUE #1202：进度帧要落库的
//     `progressNode` 必须带上类名与中文标签）。
// ②不需要真 WS —— `handleMessage` 吃的就是 `ws.on("message")` 那串原文，喂 JSON 即可；
// 真连接（connect / scheduleReconnect）与协议分类本身（protocol-adapter 有自己的用例）
// 仍不在这里测。判决逻辑（迟到进度、终态不再改写）由 executor-finalize / reaper 侧兜底。
// 同时本文件也是 `configureExecutorWs` 在 `check-dead-exports` 眼里的
// 消费方（同目录 `.test.ts` 算数）。
import { afterEach, describe, expect, it, vi } from "vitest";

// `./runner-state` 会带 EventEmitter + lazy persistLogs；`./client` 与
// `../core/repository` 是 server-only 链的下游——三个都 mock 掉，避免加载本
// 模块时经它们拽出真 pino / better-sqlite3 / ComfyUI HTTP。
vi.mock("~/lib/core/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../core/repository", () => ({
  taskRepository: {
    updateProgress: vi.fn(async () => true),
    markRunning: vi.fn(async () => true),
    findStatusAndPromptById: vi.fn(async () => null),
    cancel: vi.fn(async () => undefined),
    listStaleUnownedQueued: vi.fn(async () => []),
    listStaleRunning: vi.fn(async () => []),
    finalizeFailure: vi.fn(async () => undefined),
    finalizeFromReaper: vi.fn(async () => undefined),
    finalizeSuccess: vi.fn(async () => undefined),
    createImages: vi.fn(async () => []),
    replaceLogs: vi.fn(async () => undefined),
  },
}));
vi.mock("./client", () => ({
  resolveComfyBase: vi.fn(async () => "http://127.0.0.1:8188"),
  interrupt: vi.fn(async () => undefined),
}));
vi.mock("./lifecycle", () => ({
  isComfyStarting: vi.fn().mockReturnValue(false),
  ensureComfyUiReady: vi.fn(async () => ({ ok: true })),
  isComfyAutoStartSuppressed: vi.fn().mockReturnValue(false),
  COMFYUI_AUTOSTART_TIMEOUT_MS: 420_000,
}));
// ②那一组会逐帧 trace（WS 原文落 `log/comfyui/comfyui-trace.log`）。用例不许往仓库
// 的 log/ 里写字（规范硬规则 4 + §4 的日志布局），所以整条 trace 通道在本文件里咽掉。
vi.mock("./trace", () => ({
  trace: vi.fn(),
  configureTraceLogPath: vi.fn(),
  traceStringify: (v: unknown) => String(v),
  historyTraceSummary: vi.fn(() => ""),
  historyOutputKeys: vi.fn(() => []),
  queueTraceSummary: vi.fn(() => ({})),
  TRACE_MAX_LINE: 2000,
}));

const mod = await import("./executor-ws");
const { state } = await import("./runner-state");

describe("configureExecutorWs 接缝", () => {
  it("接受 Partial<ExecutorWsDeps>、两次调用是合并语义", () => {
    const fakeRepo = { updateProgress: async () => true };
    expect(() => mod.configureExecutorWs({ taskRepo: fakeRepo })).not.toThrow();
    expect(() => mod.configureExecutorWs({})).not.toThrow();
  });
});

/* ISSUE #1202：WS 帧只带节点 id，类名要靠 `executedWorkflow`（提交那一刻真正交出去
 * 的那张图）来认。此前两个读者读的都是 `promptByTask`，而那份的写方随 4-B3 删掉
 * `enqueue()` 一起消失 ⇒ 这一格恒空：raw 任务的日志永远打成「▶ 节点 [3] 未知节点（?）」，
 * `task.progressNode` 里也不带 `classType`（状态栏与画布两格的数据来源）。
 * 下面这几条就是把「以前没有任何地方会红」的那句断言钉上。 */
describe("进度帧认节点类名（ISSUE #1202）", () => {
  afterEach(() => {
    const s = state();
    // handleMessage 会续看门狗（5 分钟硬超时），用例不跑它，清掉免得吊住进程。
    for (const t of s.timers.values()) clearTimeout(t);
    s.timers.clear();
    s.promptToTask.clear();
    s.executedWorkflow.clear();
    s.lastNodeByTask.clear();
    s.pendingDispatch.clear();
    s.logs.clear();
    s.queuedEntries.clear();
    s.lastLogPct.clear();
  });

  /** 喂一帧标准 ComfyUI 的 `progress`，回传落库时收到的 `(taskId, pct, node)`。 */
  async function feedProgress(
    graph: unknown,
    nodeId: number | string = 3,
  ): Promise<Array<[string, number, unknown]>> {
    const calls: Array<[string, number, unknown]> = [];
    mod.configureExecutorWs({
      taskRepo: {
        updateProgress: async (id: string, pct: number, node?: unknown) => {
          calls.push([id, pct, node]);
          return true;
        },
      },
    });
    const s = state();
    s.promptToTask.set("p-1", "t-1");
    s.executedWorkflow.set("t-1", graph);
    await mod.handleMessage(
      JSON.stringify({
        type: "progress",
        data: { prompt_id: "p-1", node: nodeId, value: 5, max: 20 },
      }),
    );
    return calls;
  }

  it("RAW（UI 格式原件）任务：类名与中文标签一起落库——这条在改之前恒空", async () => {
    const calls = await feedProgress({ nodes: [{ id: 3, type: "KSampler" }] });

    expect(calls).toHaveLength(1);
    const [taskId, pct, node] = calls[0]!;
    expect(taskId).toBe("t-1");
    expect(pct).toBe(25);
    expect(node).toMatchObject({
      id: "3",
      value: 5,
      max: 20,
      classType: "KSampler",
      label: "采样去噪",
    });
  });

  it("API 图任务：同样认得出（键就是节点 id）", async () => {
    const calls = await feedProgress({ "3": { class_type: "VAEDecode" } });

    expect(calls[0]![2]).toMatchObject({
      classType: "VAEDecode",
      label: "VAE 解码",
    });
  });

  it("图里没有这个节点 ⇒ 两者都不带，但进度帧照落（不许因为认不出类名就丢帧）", async () => {
    const calls = await feedProgress({ nodes: [{ id: 9, type: "KSampler" }] });

    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toEqual({ id: "3", value: 5, max: 20 });
  });

  it("还没有图（提交前就来帧）也不丢进度", async () => {
    const calls = await feedProgress(undefined);

    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toEqual({ id: "3", value: 5, max: 20 });
  });

  it("`executing` 记下的那一格也来自同一份图（决定日志是「▶ LoraLoader → ✔ LoraLoader」还是两个未知节点）", async () => {
    const s = state();
    s.promptToTask.set("p-2", "t-2");
    s.executedWorkflow.set("t-2", { nodes: [{ id: 12, type: "LoraLoader" }] });

    await mod.handleMessage(
      JSON.stringify({
        type: "executing",
        data: { prompt_id: "p-2", node: 12, status: "running" },
      }),
    );

    // 完成行（`executing` 且 node 为 null 时补的那条 "✔ …"）读的就是这一格。
    expect(s.lastNodeByTask.get("t-2")).toMatchObject({
      node: "12",
      classType: "LoraLoader",
    });
  });
});
