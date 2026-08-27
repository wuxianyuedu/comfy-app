/* eslint-disable @typescript-eslint/no-explicit-any */
// Internal shared state + log persistence for the comfyui runner layer.

//

// P3 refactor (2026-08-20): `runner.ts` was split into enqueue / executor /

// reaper.  This module holds the *singleton runtime state* and the *log

// infrastructure* that all three sub-modules (and the public runner entry)

// share.  It is NOT a public API surface — external code imports the runner

// only.



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

  /** R-ardot118 (2026-08-18): caller source ("file:line") captured at

   *  emit time so the debug panel can show *which code path* produced

   *  each log line.  Empty when capture was skipped.  Persisted as

   *  part of the entry so SSE replays carry it too. */

  src?: string;

};



export type TaskEvent =

  | { type: "progress"; progress: number }

  | { type: "done"; images: unknown[] }

  | { type: "error"; error: string }

  | { type: "log"; entry: LogEntry }

  /* R-ardot114 (2026-08-17): synthetic "state" event re-emitted

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

  promptByTask: Map<string, Record<string, any>>;

  logs: Map<string, LogEntry[]>;

  lastLogPct: Map<string, number>;

  /** R-ardot111 (2026-08-17): per-node completion tracking.  When

   *  ComfyUI emits `executing` with `data.node !== null` we record the

   *  (node, classType) here; on the next `executing` with `data.node

   *  === null` we log "✔ 节点 X (classType) 完成" using the recorded

   *  values.  This gives the user a clear per-node timeline in the

   *  log panel, not just "started" markers. */

  lastNodeByTask: Map<string, { node: string; classType: string; t: number }>;

  /** R-ardot111 (2026-08-17): task start time (epoch ms), used to

   *  emit "总耗时 Xs" at completion.  Set in enqueue(), cleared in

   *  complete() / fail() / cancelTask(). */

  startedAt: Map<string, number>;

  settled: Set<string>;

  timers: Map<string, NodeJS.Timeout>;

  reconnectAttempts: number;

  /** 当前使用的 WS 路径下标（连接失败时推进到下一条路径重试）。 */

  wsPathIndex: number;

  /** 本次执行实际提交给 ComfyUI 的工作流 JSON。raw 路径存 patched（liblib

   *  subgraph 格式，未展开）；api 路径存 prepareGraphForExecution 后的展开 graph。

   *  任务完成后落盘到 public/generated/.../workflow.json，便于工作流模板后续改动

   *  时仍能完整复现本次生成结果（种子已存 manifest.seed + TaskImage.seed）。 */

  executedWorkflow: Map<string, any>;

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

      timers: new Map(),

      reconnectAttempts: 0,

      wsPathIndex: 0,

      executedWorkflow: new Map(),

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

// R-ardot115 (2026-08-18): the original `log()` only pushed to in-memory

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




// R-ardot115 (2026-08-18): per-taskId debounced DB writer.  Each task

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



export async function persistLogs(taskId: string) {

  // R-ardot115 (2026-08-18): a debounced write is now racing the terminal

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

