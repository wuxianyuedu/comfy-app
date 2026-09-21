// // comfyui 执行层内部共享状态 + 日志落盘。

//

// // 由历史单文件 `runner.ts` 拆分而来（拆成 enqueue / executor / reaper）。

// // 本模块持有那几个子模块共享的**单例运行时状态**与**日志基建**。

// // 它**不是**对外 API —— 外部代码请从 enqueue.ts 取公开入口。

// // 模块边界见 docs/standards/18-lib层规范.md。

//

import "server-only";
import { EventEmitter } from "events";

import type WebSocket from "ws";

import { logger } from "~/lib/core/logger";
import { errorText } from "~/lib/error-message";
import { taskRepository } from "../core/repository";
import { HISTORY_READ } from "../retry-policy";
import { lastSegments } from "~/lib/path-display";

export const CLIENT_ID = process.env.COMFY_CLIENT_ID ?? "comfy-app-web";

export const MAX_CONCURRENCY = 1; // single GPU — serial execution

export const JOB_TIMEOUT_MS = 5 * 60 * 1000;

/** ComfyUI 先发 `executing:null` / `execution_success`，随后才把结果写进 history。

 *  直接读会拿到空，必须轮询几轮。

 *  取值走 `~/lib/retry-policy` 的 {@link HISTORY_READ}（**固定间隔 + 有界次数**：
 *  对端一定就绪、只是慢一拍，指数退避只会让它更晚拿到结果 —— 见 §16.2.4.49）。 */

export const HISTORY_RETRIES = HISTORY_READ.maxAttempts;

export const HISTORY_RETRY_DELAY_MS = HISTORY_READ.baseMs;

/* WS 断线重连的退避参数（基数 / 封顶 / `2 ** attempt` 的夹取）**已整体搬到
 * `~/lib/retry-policy` 的 WS_RECONNECT** —— `executor-ws` 的 `scheduleReconnect`
 * 直接 `backoffDelayMs({ ...WS_RECONNECT, attempt })`，因此这里不再各留一个
 * 「转发常量」：那只会让「重试策略有几处定义」这件事又多一处看不出消费方的
 * 中转（`check-dead-exports` 正是这么抓出来的，见 §16.2.4.49）。 */

/**

 * ComfyUI 的 WS 端点路径随版本变化：

 *   - 现代版本（v0.20+）：`/api/ws?clientId=...`

 *   - 旧版本：`/ws?clientId=...`（访问 `/api/ws` 会 404）

 * 连接阶段失败时按此顺序逐条回退，避免「能提交但收不到事件」。

 */

export const WS_PATHS = ["/api/ws", "/ws"];

export type RawWorkflowOverride = {
  nodeId: string;
  name: string;
  value?: unknown;
};

export type Job = {
  taskId: string;

  prompt?: Record<string, unknown>;

  /** /** 原始 UI 格式的 JSON（含子图 wrapper）—— 走 comfy-cli 执行。 */

  rawJson?: unknown;

  /** /** 执行前注入到原始 JSON 里的画布 `workflowInputs`。 */

  overrides?: RawWorkflowOverride[];
};

export type LogEntry = {
  t: number; // epoch ms

  level: "info" | "progress" | "warn" | "error" | "success";

  msg: string;

  /** /** 发日志时捕获的调用方位置（"文件:行"）：让调试面板能显示每行日志

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

  /* /* 合成的 "state" 事件：由 cancelTask() / finalizeFailure() 两条路径补发，

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

  lastLogPct: Map<string, number>;

  /** /** 按节点记录完成情况。ComfyUI 发 `executing` 且 `data.node !== null` 时，

   *  把（节点 id, classType）记在这里；下一条 `executing` 的 node 为 null

   *  到达时，用记录下来的值打出「✔ 节点 X (classType) 完成」。

   *  这样日志面板给用户的是按节点的时间线，而不只是「开始了」的标记。

   *  仅 API 格式路径需要这一对日志；comfy-cli 路径自己会打（见 executor-ws）。

   *  */

  lastNodeByTask: Map<string, { node: string; classType: string; t: number }>;

  /** /** 任务开始时间（epoch 毫秒），用于完成时打「总耗时 Xs」。

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

declare global {
  var comfyRunner: RunnerState | undefined;
}

export function state(): RunnerState {
  if (!globalThis.comfyRunner) {
    const emitter = new EventEmitter();

    emitter.setMaxListeners(0);

    globalThis.comfyRunner = {
      ws: null,

      queue: [],

      active: 0,

      connecting: false,

      emitter,

      promptToTask: new Map(),

      promptByTask: new Map(),

      logs: new Map(),

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

  return globalThis.comfyRunner;
}

function callerLoc(): string {
  try {
    const stack = new Error().stack;

    if (!stack) return "";

    const lines = stack.split("\n");

    // 栈的形状：lines[0] 是 "Error"，lines[1] 是 " at log (…)"，lines[2] 才是真正的调用方。

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const frame = lines[2] || lines[1] || "";

    const match = /\(([^():]+):(\d+):(\d+)\)/.exec(frame);

    if (match) {
      const file = lastSegments(match[1], 1) || match[1];

      return `${file}:${match[2]}`;
    }

    const m2 = /at\s+(\S+):(\d+):(\d+)/.exec(frame);

    if (m2) {
      const file = lastSegments(m2[1], 1) || m2[1];

      return `${file}:${m2[2]}`;
    }

    return "";
  } catch {
    return "";
  }
}

// 追加一条结构化日志：留内存 + 推给实时订阅方 + 防抖落库，

// 让 SSE 重放能覆盖全部内容。

//

// 原先的 `log()` 只推到内存的 `s.logs` 与 EventEmitter，

// 而 `persistLogs()` 只在终结点（complete / finalizeFailure）被调用。

// 于是「前端打开 EventSource 之前发出的日志」全都不可见

// （EventSource 只在 /api/generate 返回 taskId、

// 前端把 d.taskId 补上之后才会打开）：

// 那些 emit 落在没有订阅者的时刻，

// SSE 首次回放 `Task.logs` 又只拿到空数组。

// 面板上的表现是：「📡 已订阅」之后长时间静默，

// 用户看不出执行器在干什么。

//

// 修法：每条日志都落库，但用 200ms 防抖合并写入 ——

// 高频突发（执行期间的按节点 ▶/✔ 成对日志）因此收敛成约 1 次写，

// 而不是每条一次。另有 1500ms 保底刷盘，

// 保证持续输出时不会把数据库写饿。

export function log(taskId: string, level: LogEntry["level"], msg: string) {
  const store = state();

  const entry: LogEntry = { t: Date.now(), level, msg, src: callerLoc() };

  const arr = store.logs.get(taskId) ?? [];

  arr.push(entry);

  store.logs.set(taskId, arr);

  store.emitter.emit(taskId, { type: "log", entry });

  schedulePersistLogs(taskId);
}

// 每个 taskId 一个防抖落库器。一个任务最多只有一次待写；

// 防抖窗口内后续的 `log()` 调用会重置计时器。

// 「最长延迟」看门狗保证持续输出（例如按节点 ▶/✔ 的突发）

// 仍能在约 1.5s 内落库，SSE 重放因此能及时拿到。

// （每条都写会把数据库写爆，所以必须合并。）

const PERSIST_DEBOUNCE_MS = 200;

const PERSIST_MAX_DELAY_MS = 1500;

const persistTimers = new Map<
  string,
  {
    debounce: ReturnType<typeof setTimeout>;
    maxDelay: ReturnType<typeof setTimeout>;
  }
>();

/** 取消某个任务的「日志落库」防抖定时器（若存在）。
 *
 *  为什么公共 API 需要它：`schedulePersistLogs` 排的是**游离定时器** —— 它不属于
 *  任何组件生命周期，也不随任务结束自动消失。测试里清空内存 state 之后，
 *  上一次排的定时器仍会在 200ms / 1500ms 后触发 `persistLogs`，打到
 *  **已经被 `vi.mock` 换掉或已随用例撤销的 repository** 上
 *  （实测形态：`TypeError: taskRepository.replaceLogs is not a function`，
 *  以 Unhandled Rejection 浮出、让 `pnpm test` 随机非零退出，而用例层面全绿，
 *  报错点名的文件是当时恰好在跑的那个）。ISSUE #489。
 *
 *  生产语义同理：任务被丢弃 / 重跑时先把上一次的落库排期掐掉，避免**旧日志
 *  覆盖新日志**（`persistLogs` 是整包 `replaceLogs`，不是在末尾追加）。 */
export function cancelPersistLogs(taskId: string): void {
  const pending = persistTimers.get(taskId);

  if (!pending) return;

  clearTimeout(pending.debounce);

  clearTimeout(pending.maxDelay);

  persistTimers.delete(taskId);
}

export function schedulePersistLogs(taskId: string) {
  if (!taskId) return;

  const existing = persistTimers.get(taskId);

  if (existing) {
    // 只重置防抖计时器；最长延迟看门狗继续保持武装。

    clearTimeout(existing.debounce);

    existing.debounce = setTimeout(() => {
      const cur = persistTimers.get(taskId);

      if (cur) {
        clearTimeout(cur.maxDelay);

        persistTimers.delete(taskId);
      }

      void persistLogs(taskId);
    }, PERSIST_DEBOUNCE_MS);

    return;
  }

  const debounce = setTimeout(() => {
    const cur = persistTimers.get(taskId);

    if (cur) {
      clearTimeout(cur.maxDelay);

      persistTimers.delete(taskId);
    }

    void persistLogs(taskId);
  }, PERSIST_DEBOUNCE_MS);

  const maxDelay = setTimeout(() => {
    const cur = persistTimers.get(taskId);

    if (cur) {
      clearTimeout(cur.debounce);

      persistTimers.delete(taskId);
    }

    void persistLogs(taskId);
  }, PERSIST_MAX_DELAY_MS);

  persistTimers.set(taskId, { debounce, maxDelay });
}

/**
 * 抢占任务的终态。
 *
 * 返回 true 表示本次调用赢得了收口权（并已停掉超时定时器）；返回 false 表示
 * 别处已经把任务结算过了，调用方应直接退出。
 *
 * ⚠️ 历史坑：complete() 曾在入口就 `settled.add`，随后它内部的失败分支再调
 * fail()，而 fail() 第一行就是 `if (settled.has) return` —— 直接空转。结果
 * 是任务永远停在 RUNNING、`active` 不回落、MAX_CONCURRENCY=1 的队列被彻底
 * 堵死，只能重启进程。所以失败收口一律走 finalizeFailure()，不再经过 fail()。
 */
export function claimSettle(taskId: string): boolean {
  const s = state();
  if (s.settled.has(taskId)) return false;
  s.settled.add(taskId);
  const t = s.timers.get(taskId);
  if (t) clearTimeout(t);
  s.timers.delete(taskId);
  return true;
}

/** 尝试认领「DB 终态写入」这一次性权利。首个调用者返回 true（应落库），
 *  其余（含 reaper 与 executor 并发收口同一任务）返回 false（必须跳过）。
 *  语义与 `claimSettle` 平行，但锁的是「DB 终态」而不是「收口流程」。 */
export function claimFinalize(taskId: string): boolean {
  const s = state();
  if (s.finalized.has(taskId)) return false;
  s.finalized.add(taskId);
  return true;
}

/** 任务被重新入队（同一个 taskId 重跑）时清掉上一次的收口标记，
 *  否则第二次执行会被这把一次性锁误判为「已落库」而静默丢失终态。 */
export function clearFinalize(taskId: string): void {
  state().finalized.delete(taskId);
}

export async function persistLogs(taskId: string) {
  // 此时防抖写与终结点的 `await persistLogs(taskId)` 调用在竞争。

  // 取消防抖计时器，让最终这次同步刷盘

  // 成为该任务**唯一**的写入。

  const pending = persistTimers.get(taskId);

  if (pending) {
    clearTimeout(pending.debounce);

    clearTimeout(pending.maxDelay);

    persistTimers.delete(taskId);
  }

  const arr = state().logs.get(taskId) ?? [];

  // 内部把 DB 落库的失败咽下——理由与旧行为不匹配：
  //   · caller 有 3 处写 `void persistLogs(...)`（防抖回调里），
  //     不 catch 就直接变成 unhandledRejection，进程级噪声；
  //   · 另外 7 处 `await persistLogs(...)`（enqueue / executor-finalize /
  //     reaper），若这里抛错会让 finalize 链路整段回滚，表现比「一份日志
  //     没落库」严重得多。
  // 日志面板的**内存视图**仍完整（state().logs），只是这一次没持久化；
  // 真故障通过 logger.warn 落 app-runtime.log 镜像通道，运维看得到。
  try {
    await taskRepository.replaceLogs(taskId, arr);
  } catch (e) {
    logger.warn(
      `[comfyui] persistLogs(${taskId}) 落库失败：${errorText(e, "unknown")}`,
    );
  }
}
