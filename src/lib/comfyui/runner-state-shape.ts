// comfyui 执行层的**纯状态容器**：RunnerState 类型族 + 不含 IO 的初始化工厂。
//
// 从 `runner-state.ts` 拆出，为 P3「把执行编排迁出 Next 进程」铺路：宿主注入侧
// （DB 句柄 / 日志通道 / ComfyUI base / 时钟）之前，先把「状态长什么样、初值是
// 什么」这份契约与「谁去落库、谁去打日志」解耦。本模块刻意保持两条约束：
//   · **不带 `import "server-only"`** —— 它只描述形状；未来的纯 Node executor host
//     也要能 import 它，一旦加上就把 §18.4 三选一里第三类（纯 Node 宿主）的口子
//     关死了；
//   · **不 import 任何 Node 内建值** —— `events` / `ws` 一律 `import type` 引入。
//     扫描器 `scripts/lib-node-only-scan.mjs`（规范 §18.4）的 `parseImports`
//     对 `type` 前缀的 clause 是**跳过**的，因此本模块既不会落进 `unguarded`
//     （没声明却引 Node 内建），也不会被 `clientReachable` 抓到（浏览器图引
//     Node-only 会整页 500）。这是「拆层不影响 import-graph 判定」的关键。
//
// 单例（`globalThis.comfyRunner`）与 IO（`persistLogs` / `logger` / `taskRepository`）
// 都留在 `runner-state.ts`。EventEmitter 由调用方构造并注入到 `createEmptyState`
// —— 本模块因此连 `events` 的值 import 都不需要。

import type { EventEmitter } from "events";

import type WebSocket from "ws";

export type RawWorkflowOverride = {
  nodeId: string;
  name: string;
  value?: unknown;
};

export type Job = {
  taskId: string;

  /** 工作流名（入队方从模板行带上）：执行日志要能独立说出「这次跑的是哪个
   *  工作流」—— 面板标题是客户端拼的，日志行才是可导出/回放的自包含现场。 */
  workflowName?: string;

  prompt?: Record<string, unknown>;

  /** 原始 UI 格式的 JSON（含子图 wrapper）—— 走 comfy-cli 执行。 */
  rawJson?: unknown;

  /** 执行前注入到原始 JSON 里的画布 `workflowInputs`。 */
  overrides?: RawWorkflowOverride[];
};

export type LogEntry = {
  t: number; // epoch ms

  level: "info" | "progress" | "warn" | "error" | "success";

  msg: string;

  /** 发日志时捕获的调用方位置（"文件:行"）：让调试面板能显示每行日志
   *  来自哪条代码路径。跳过捕获时为空。它作为条目的一部分一并落盘，
   *  因此 SSE 重放也带着它（实现见 log() 与 callerLoc()）。
   *  不捕获时这里为空字符串。 */
  src?: string;
};

export type TaskEvent =
  | {
      type: "progress";
      progress: number;
      /** 当前正在执行的 ComfyUI 节点与步数（progress 消息自带；UI 用于节点级进度展示） */
      node?: { id: string; label?: string; value: number; max: number };
    }
  | { type: "done"; images: unknown[] }
  | { type: "error"; error: string }
  | { type: "log"; entry: LogEntry }

  /** 合成的 "state" 事件：由 cancelTask() / finalizeFailure() 两条路径补发，
   *  它们否则只会更新数据库，不通知 SSE 订阅方。
   *  前端读取的字段与初始 /api/tasks/[id]/stream GET 响应体完全一致，
   *  因此 "state" 事件会触发同一条 patch() 路径，
   *  把「卡在生成中」的 UI 治好。
   *  顺序与 finalizeFailure 保持一致：先 state，后 error。
   *  （取消路径的完整说明见 enqueue.ts 的 cancelTask。） */
  | {
      type: "state";

      status: string;

      progress?: number;

      error?: string | null;

      validationErrors?: unknown[] | null;
    };

export type RunnerState = {
  ws: WebSocket | null;

  queue: Job[];

  active: number;

  connecting: boolean;

  emitter: EventEmitter;

  promptToTask: Map<string, string>;

  promptByTask: Map<string, Record<string, unknown>>;

  logs: Map<string, LogEntry[]>;

  /** comfy-cli 完整原始输出（按行、不截断）：供前端「查看完整输出」入口按需
   *  拉取。面板的 `[comfy-cli 原始]`/`stdout`/`stderr` 行出于防刷屏做了单行与
   *  行数截断（executor-cli-stream 的 MAX_*），但排障常要看被截掉的完整 JSON
   *  与完整 traceback，故这里单独以「不截断」方式留存，行数上限见
   *  RAW_CLI_MAX_LINES，任务数上限见 LOGS_MAX_TASKS。 */
  rawCli: Map<string, string[]>;

  lastLogPct: Map<string, number>;

  /** 按节点记录完成情况。ComfyUI 发 `executing` 且 `data.node !== null` 时，
   *  把（节点 id, classType）记在这里；下一条 `executing` 的 node 为 null
   *  到达时，用记录下来的值打出「✔ 节点 X (classType) 完成」。
   *  这样日志面板给用户的是按节点的时间线，而不只是「开始了」的标记。
   *  仅 API 格式路径需要这一对日志；comfy-cli 路径自己会打（见 executor-ws）。 */
  lastNodeByTask: Map<string, { node: string; classType: string; t: number }>;

  /** 任务开始时间（epoch 毫秒），用于完成时打「总耗时 Xs」。
   *  在 enqueue() 里写入，在 complete() / fail() / cancelTask() 里清除。
   *  （缺失时说明任务来自上一次服务端生命周期。） */
  startedAt: Map<string, number>;

  settled: Set<string>;

  /** 「终态已落库」标记（与 `settled` 的「终态已认领」区分）。
   *  同一个 taskId 可能被多条收口路径尝试写终态：正常 executor 路径、
   *  看门狗超时、reaper 孤儿回收。`settled` 只保证「谁先认领」，但认领失败
   *  的一方若直接调用 `finalizeFailure`（不走 claim）仍会二次写库，把先写入
   *  的失败原因覆盖掉——用户就会在「执行日志」（经 SSE 拿到的第一份原因）与
   *  「应用日志 / DB」（被后写入覆盖的第二份原因）看到互相矛盾的结果。
   *  这里给「DB 终态写入」单独加一把一次性锁：首个写入者落库，其余直接跳过，
   *  保证两处永远显示同一个失败原因。 */
  finalized: Set<string>;

  timers: Map<string, NodeJS.Timeout>;

  reconnectAttempts: number;

  /** 当前使用的 WS 路径下标（连接失败时推进到下一条路径重试）。 */
  wsPathIndex: number;

  /** 本次执行实际提交给 ComfyUI 的工作流 JSON。RAW 载荷存 patched（liblib
   *  subgraph 格式，未展开，含画布覆盖）；API 载荷存 execution-graph 收拾后的图。
   *  任务完成后落盘到 public/generated/.../workflow.json，便于工作流模板后续改动
   *  时仍能完整复现本次生成结果（种子已存 manifest.seed + TaskImage.seed）。 */
  executedWorkflow: Map<string, unknown>;

  /** 已向排队任务写入过「等待 ComfyUI 连接/启动」提示的 taskId 集合。
   *  防止心跳每 3s 触发 processQueue（WS 未 OPEN 时提前返回）对同一任务反复刷同一行。
   *  任务真正出队 / WS 打开后清除，以便下次重连窗口能重新提示。 */
  wsWaitLogged: Set<string>;
};

/** 建一份 RunnerState 的初始值。
 *
 *  `emitter` 由调用方构造并传入 —— 本模块不 import Node 内建的 `events`，把
 *  「谁持有 EventEmitter」留给宿主：Next 进程走 `runner-state.ts` 里的
 *  `state()` 全局单例（并在那里 `setMaxListeners(50)`，注释与理由也留在原处）；
 *  未来的 executor host 可各自持有自己的 emitter。除 emitter 外，本工厂**只**
 *  做纯数据初始化（`new Map` / `new Set` / 空数组 / 0 / false），零副作用、
 *  零 IO，因此搬动它不改变任何执行行为。 */
export function createEmptyState(emitter: EventEmitter): RunnerState {
  return {
    ws: null,
    queue: [],
    active: 0,
    connecting: false,
    emitter,
    promptToTask: new Map(),
    promptByTask: new Map(),
    logs: new Map(),
    rawCli: new Map(),
    lastLogPct: new Map(),
    lastNodeByTask: new Map(),
    startedAt: new Map(),
    settled: new Set(),
    finalized: new Set(),
    timers: new Map(),
    reconnectAttempts: 0,
    wsPathIndex: 0,
    executedWorkflow: new Map(),
    wsWaitLogged: new Set(),
  };
}
