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

// trace 通道在本文件里整体被 mock（用例不许往仓库 log/ 写字），但 #1315 那条判据要断言
// 「跳过归属那一跳确实留了证」，所以按名字把它取回来。
import { trace as traceMock } from "./trace";

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

/* ISSUE #1315 取证的前提。#1278 那两轮复演数出 trace 里 kind=`ws` 全 0，而当时四个
 * `trace("ws", …)` 出口**全在** `if (!promptId) return;` 之后 —— 于是「WS 一条帧都没来」与
 * 「帧来了但不带 `prompt_id`」两种情形在日志里长得一模一样，谁也分不开。
 * 补上这一跳之后本机数到的是：一轮 35 条 = `status`×4 / `kaytool.resources`×16 /
 * `dasiwa.system_monitor`×15，**没有一条执行帧**（读数记在 ADR §28）。
 * 所以下面这三条各自钉住一个约束：留证要存在、同类型只留第一帧（逐帧落盘会把诊断文件
 * 刷成噪声）、类型数有上限（免得被异常服务刷成一个无界集合）。 */
describe("不带 prompt_id 的帧也要留证（ISSUE #1315）", () => {
  const traceCalls = () =>
    vi
      .mocked(traceMock)
      .mock.calls.filter((c) => c[2] === "WS 帧不带 prompt_id（跳过归属）");

  it("每类只落第一帧，且不碰执行侧", async () => {
    const updateProgress = vi.fn(async () => true);
    mod.configureExecutorWs({ taskRepo: { updateProgress } });
    vi.mocked(traceMock).mockClear();

    const frame = (type: string) =>
      mod.handleMessage(
        JSON.stringify({ type, data: { probe: { exec_info: [] } } }),
      );

    await frame("p1315-first");
    expect(traceCalls()).toHaveLength(1);
    expect(traceCalls()[0]?.[1]).toBeNull();
    expect(traceCalls()[0]?.[3]).toEqual({
      type: "p1315-first",
      dataKeys: ["probe"],
    });

    // 同类型再来一帧：必须不再落盘（这就是「逐帧落盘会刷成噪声」那条预算）。
    await frame("p1315-first");
    expect(traceCalls()).toHaveLength(1);

    // 新类型必须能落 —— 预算不能退化成「只记第一条」。
    await frame("p1315-second");
    expect(traceCalls()).toHaveLength(2);

    expect(updateProgress).not.toHaveBeenCalled();
  });

  it("类型数到上限后停止留证（这个集合不许无界增长）", async () => {
    vi.mocked(traceMock).mockClear();
    for (let i = 0; i < 40; i++) {
      await mod.handleMessage(
        JSON.stringify({ type: `p1315-cap-${i}`, data: { x: 1 } }),
      );
    }
    // 前面那条用例已经占掉两个类型，这里再灌 40 种 ⇒ 只补到上限 32。
    expect(traceCalls()).toHaveLength(30);
  });
});
