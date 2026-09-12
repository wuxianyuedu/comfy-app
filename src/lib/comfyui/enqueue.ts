// P3 enqueue: public-facing queue / subscription / logs / cancel API for the
// ComfyUI runner.
//
// Split out of the legacy single-file `runner.ts`.  This module owns the
// *public entry points* used by API routes / orchestrators; the actual WS
// execution machinery lives in executor.ts, and orphan reaping lives in
// reaper.ts.
//
// Reaper cold-start: importing this module pulls in `./reaper` as a side
// effect so a server that enqueues/subscribes always launches the orphan
// sweepers (QUEUED/RUNNING reconciliation).  Every API/orchestrator that
// needs enqueue/subscribe/cancelTask imports from here, so deleting the old
// `runner.ts` shim keeps the reaper on the boot path.

import "./reaper"; // module side-effect: launch the reaper sweeps
import { interrupt } from "./client";
import { state, log, persistLogs, claimFinalize, clearFinalize, MAX_CONCURRENCY } from "./runner-state";
import type { Job, TaskEvent, LogEntry } from "./runner-state";
import { connect, processQueue, cliProcs } from "./executor";
import { taskRepository } from "../core/repository";

export function enqueue(job: Job) {

  const store = state();

  store.settled.delete(job.taskId);

  /* 同一 taskId 重跑（重试 / 复用）：清掉上一次的「终态已落库」标记，
   *  否则新的终态会被一次性锁挡住，任务永远停在旧状态。 */
  clearFinalize(job.taskId);

  store.queue.push(job);

  if (job.prompt) store.promptByTask.set(job.taskId, job.prompt);

  state().logs.set(job.taskId, []);

  // stamp the start time so we can emit a

  // "总耗时 Xs" line at completion, and so the client log can show

  // task age for "stuck RUNNING" debugging.

  store.startedAt.set(job.taskId, Date.now());

  log(job.taskId, "info", "任务已加入执行队列");

  // surface queue position + active slot

  // so the user can see whether the task is waiting on a peer or

  // about to run immediately.  This is the very first line they'll

  // see if they had the log panel open before clicking 生成.

  log(

    job.taskId,

    "info",

    `队列位置：${store.queue.length} / 活跃槽位：${store.active}/${MAX_CONCURRENCY}`

  );

  void connect();

  void processQueue();

}


export function subscribe(taskId: string, cb: (e: TaskEvent) => void): () => void {

  const store = state();

  store.emitter.on(taskId, cb);

  return () => store.emitter.off(taskId, cb);

}


export function getLogs(taskId: string): LogEntry[] {
  return state().logs.get(taskId) ?? [];
}

export async function cancelTask(taskId: string) {

  const store = state();

  // Kill any comfy-cli subprocess driving this task before flipping status.

  const cliProc = cliProcs.get(taskId);

  if (cliProc) {

    try { cliProc.kill("SIGKILL"); } catch { /* ignore */ }

    cliProcs.delete(taskId);

  }

  const task = await taskRepository.findStatusAndPromptById(taskId);

  if (!task) return;



  /* previously this required

   *  `status === RUNNING || QUEUED`.  We now accept ANY non-terminal

   *  status — SUCCEEDED / FAILED / CANCELLED are skipped below — so

   *  users can cancel a stuck QUEUED row even when the in-memory

   *  state has been wiped (e.g. by a dev-server restart that the

   *  reaper hasn't yet swept). If the task has a

   *  promptId we still try `interrupt()` to tell ComfyUI to drop

   *  its prompt as well; if not, we just close out the DB row. */

  const isTerminal = (st: string | null) =>

    st === "SUCCEEDED" || st === "FAILED" || st === "CANCELLED";



  log(taskId, "warn", "用户取消任务");

  // 取消也是「写终态」的一种。对**尚未终态**的任务先抢落库锁：抢不到说明

  // 它已在本进程被别的原因收口（成功 / 失败 / 被 reaper 判孤），此时不能再

  // 把原因改写成「用户取消」，否则用户在执行日志看到的失败原因会被取消动作

  // 悄悄覆盖掉。DB 行本就是终态时保持旧行为（仍允许改写为 CANCELLED）。

  if (!isTerminal(task.status) && !claimFinalize(taskId)) {

    log(taskId, "warn", "任务终态已落库，取消请求不再改写终态");

    if (task.promptId) store.promptToTask.delete(task.promptId);

    store.promptByTask.delete(taskId);

    const hadQueueSlot = store.queue.some((queue) => queue.taskId === taskId);

    if (hadQueueSlot || cliProcs.has(taskId)) store.active = Math.max(0, store.active - 1);

    await persistLogs(taskId);

    if (hadQueueSlot || cliProcs.has(taskId)) void processQueue();

    return;

  }

  if (!isTerminal(task.status) && task.promptId) {

    try {

      await interrupt();

    } catch {

      /* ignore */

    }

  }



  await taskRepository.cancel(taskId);

  if (task.promptId) store.promptToTask.delete(task.promptId);

  store.promptByTask.delete(taskId);

  // clean up the per-task bookkeeping we

  // added so a re-enqueue of the same taskId starts clean.

  store.startedAt.delete(taskId);

  store.lastNodeByTask.delete(taskId);

  /* only release the runner's slot when we

   *  actually held one.  DB-only tasks (no in-memory job) must NOT

   *  decrement `s.active`, or a future `processQueue` call would

   *  briefly think a slot is free and try to enqueue a phantom job.

   *  `hadSlot` means we either owned the comfy-cli subprocess or

   *  had the task sitting in the in-memory queue. */

  const inQueue = store.queue.some((queue) => queue.taskId === taskId);

  const hadSlot = inQueue || cliProcs.has(taskId);

  if (hadSlot) store.active = Math.max(0, store.active - 1);

  /* cancel previously only updated the DB

   *  and the in-memory slot, never pushed anything to the SSE

   *  emitter — so the frontend's d.status stayed at "running"

   *  forever and the "生成中…" button never came back.  Emit a

   *  synthetic state event so the canvas patch() flips the node

   *  to error, then a terminal error event so the EventSource

   *  onmessage handler closes the connection (matching the

   *  finalizeFailure pattern at line 886).  Order matters: state

   *  first (heal UI), error second (close socket). */

  store.emitter.emit(taskId, {

    type: "state",

    status: "CANCELLED",

    progress: 0,

    error: "用户取消",

    validationErrors: [],

  });

  store.emitter.emit(taskId, { type: "error", error: "用户取消" });

  // flush any pending debounced log writes

  // for this task so the cancel-line + any in-flight warnings reach

  // the DB before we declare the row terminal.  Without this, a fast

  // cancel-then-reload could miss the "用户取消任务" entry.

  await persistLogs(taskId);

  if (hadSlot) void processQueue();

}

