// Internal shared state + log persistence for the comfyui runner layer.

//

// Split of the legacy single-file `runner.ts` into enqueue / executor /

// reaper.  This module holds the *singleton runtime state* and the *log

// infrastructure* that those sub-modules share.  It is NOT a public API

// surface — external code imports the public entry points from enqueue.ts.

//



import { EventEmitter } from "events";

import type WebSocket from "ws";

import { taskRepository } from "../core/repository";



export const CLIENT_ID = process.env.COMFY_CLIENT_ID ?? "comfy-app-web";

export const MAX_CONCURRENCY = 1; // single GPU — serial execution

export const JOB_TIMEOUT_MS = 5 * 60 * 1000;



/** ComfyUI 先发 `executing:null` / `execution_success`，随后才把结果写进 history。

 *  直接读会拿到空，必须轮询几轮。 */

export const HISTORY_RETRIES = 12;

export const HISTORY_RETRY_DELAY_MS = 250;



/** WS 断线重连退避（毫秒），指数增长到上限。 */

export const RECONNECT_BASE_MS = 1000;

export const RECONNECT_MAX_MS = 15000;



/**

 * ComfyUI 的 WS 端点路径随版本变化：

 *   - 现代版本（v0.20+）：`/api/ws?clientId=...`

 *   - 旧版本：`/ws?clientId=...`（访问 `/api/ws` 会 404）

 * 连接阶段失败时按此顺序逐条回退，避免「能提交但收不到事件」。

 */

export const WS_PATHS = ["/api/ws", "/ws"];



export type RawWorkflowOverride = { nodeId: string; name: string; value?: unknown };



export type Job = {

  taskId: string;

  prompt?: Record<string, unknown>;

  /** Raw UI-format json (with subgraph wrappers) — executed via comfy-cli. */

  rawJson?: unknown;

  /** Canvas `workflowInputs` injected into the raw json before execution. */

  overrides?: RawWorkflowOverride[];

};



export type LogEntry = {

  t: number; // epoch ms

  level: "info" | "progress" | "warn" | "error" | "success";

  msg: string;

  /** caller source ("file:line") captured at

   *  emit time so the debug panel can show *which code path* produced

   *  each log line.  Empty when capture was skipped.  Persisted as

   *  part of the entry so SSE replays carry it too. */

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

  /* synthetic "state" event re-emitted

   *  from cancelTask() / finalizeFailure() paths that would

   *  otherwise only update the DB without notifying the SSE

   *  subscriber.  The frontend reads the same fields it reads

   *  from the initial /api/tasks/[id]/stream GET body, so a

   *  "state" event triggers the same patch() path that heals

   *  the "stuck generating" UI. */

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

  /** per-node completion tracking. When

   *  ComfyUI emits `executing` with `data.node !== null` we record the

   *  (node, classType) here; on the next `executing` with `data.node

   *  === null` we log "✔ 节点 X (classType) 完成" using the recorded

   *  values.  This gives the user a clear per-node timeline in the

   *  log panel, not just "started" markers. */

  lastNodeByTask: Map<string, { node: string; classType: string; t: number }>;

  /** task start time (epoch ms), used to

   *  emit "总耗时 Xs" at completion.  Set in enqueue(), cleared in

   *  complete() / fail() / cancelTask(). */

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

  /** 本次执行实际提交给 ComfyUI 的工作流 JSON。raw 路径存 patched（liblib

   *  subgraph 格式，未展开）；api 路径存 prepareGraphForExecution 后的展开 graph。

   *  任务完成后落盘到 public/generated/.../workflow.json，便于工作流模板后续改动

   *  时仍能完整复现本次生成结果（种子已存 manifest.seed + TaskImage.seed）。 */

  executedWorkflow: Map<string, unknown>;

  /** 已向排队任务写入过「等待 ComfyUI 连接/启动」提示的 taskId 集合。
   *  防止心跳每 3s 触发 processQueue（WS 未 OPEN 时提前返回）对同一任务反复刷同一行。
   *  任务真正出队 / WS 打开后清除，以便下次重连窗口能重新提示。 */
  wsWaitLogged: Set<string>;

};



const globalObj = globalThis as unknown as { comfyRunner?: RunnerState };



export function state(): RunnerState {

  if (!globalObj.comfyRunner) {

    const emitter = new EventEmitter();

    emitter.setMaxListeners(0);

    globalObj.comfyRunner = {

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

  return globalObj.comfyRunner;

}



function callerLoc(): string {

  try {


    const stack = new Error().stack;


    if (!stack) return "";


    const lines = stack.split("\n");


    // lines[0] = "Error", lines[1] = "    at log (…)", lines[2] = real caller.


 
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const frame = lines[2] || lines[1] || "";


    const match = /\(([^():]+):(\d+):(\d+)\)/.exec(frame);


    if (match) {


      const file = match[1]!.split(/[\\/]/).pop() ?? match[1]!;


      return `${file}:${match[2]}`;


    }


    const m2 = /at\s+(\S+):(\d+):(\d+)/.exec(frame);


    if (m2) {


      const file = m2[1]!.split(/[\\/]/).pop() ?? m2[1]!;


      return `${file}:${m2[2]}`;


    }


    return "";


  } catch {


    return "";

  }

}



// Append a structured log entry: keep in-memory + emit to live subscribers +

// debounce-persist to DB so SSE replay covers everything.

//

// the original `log()` only pushed to in-memory

// `s.logs` and the EventEmitter.  `persistLogs()` was called only at

// terminal points (complete / finalizeFailure).  That meant any log

// emitted *before* the frontend opened EventSource (which only happens

// AFTER `/api/generate` returns taskId and `d.taskId` is patched) was

// invisible: the emit landed on no subscriber, and SSE's initial

// `Task.logs` replay found an empty array.  Symptom in the panel: a long

// silence between "📡 已订阅" and the first server-side line — the user

// couldn't tell what the runner was doing.

//

// Fix: persist to DB on every log, but coalesce via 200ms debounce so

// high-frequency bursts (per-node ▶/✔ pairs during execution) collapse

// to ~1 write instead of one per entry.  A 1500ms safety flush

// guarantees we don't starve the DB during sustained emission.

export function log(taskId: string, level: LogEntry["level"], msg: string) {


  const store = state();


  const entry: LogEntry = { t: Date.now(), level, msg, src: callerLoc() };


  const arr = store.logs.get(taskId) ?? [];


  arr.push(entry);


  store.logs.set(taskId, arr);


  store.emitter.emit(taskId, { type: "log", entry });


  schedulePersistLogs(taskId);


}




// per-taskId debounced DB writer. Each task

// gets at most one pending write; subsequent `log()` calls within the

// debounce window reset the timer.  The "max delay" watchdog guarantees

// sustained emission (e.g. the per-node ▶/✔ burst) still reaches the DB

// within ~1.5s so SSE replays pick it up promptly.

const PERSIST_DEBOUNCE_MS = 200;

const PERSIST_MAX_DELAY_MS = 1500;

const persistTimers = new Map<

  string,

  { debounce: ReturnType<typeof setTimeout>; maxDelay: ReturnType<typeof setTimeout> }

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

    // Reset only the debounce timer; the max-delay watchdog stays armed.

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

  // a debounced write is now racing the terminal

  // `await persistLogs(taskId)` call.  Cancel the pending timers so the

  // final synchronous flush is the one and only write for this task.

  const pending = persistTimers.get(taskId);

  if (pending) {

    clearTimeout(pending.debounce);

    clearTimeout(pending.maxDelay);

    persistTimers.delete(taskId);

  }

  const arr = state().logs.get(taskId) ?? [];

  await taskRepository.replaceLogs(taskId, arr);

}

