// P3 enqueue: public-facing queue / subscription / logs / cancel API for the
// ComfyUI runner.
//
// Extracted from `runner.ts` (1971 → split).  This module owns the *public
// entry points* used by API routes / orchestrators; the actual WS execution
// machinery lives in executor.ts, and orphan reaping lives in reaper.ts.
// `runner.ts` re-exports everything for backward compatibility.

import { interrupt } from "./client";
import { state, log, persistLogs, MAX_CONCURRENCY } from "./runner-state";
import type { Job, TaskEvent, LogEntry } from "./runner-state";
import { connect, processQueue, cliProcs } from "./executor";
import { taskRepository } from "../core/repository";

export function enqueue(job: Job) {
  const s = state();
  s.settled.delete(job.taskId);
  s.queue.push(job);
  if (job.prompt) s.promptByTask.set(job.taskId, job.prompt);
  state().logs.set(job.taskId, []);
  // R-ardot111 (2026-08-17): stamp the start time so we can emit a
  // "总耗时 Xs" line at completion, and so the client log can show
  // task age for "stuck RUNNING" debugging.
  s.startedAt.set(job.taskId, Date.now());
  log(job.taskId, "info", "任务已加入执行队列");
  // R-ardot111 (2026-08-17): surface queue position + active slot
  // so the user can see whether the task is waiting on a peer or
  // about to run immediately.  This is the very first line they'll
  // see if they had the log panel open before clicking 生成.
  log(
    job.taskId,
    "info",
    `队列位置：${s.queue.length} / 活跃槽位：${s.active}/${MAX_CONCURRENCY}`
  );
  connect();
  void processQueue();
}

export function subscribe(taskId: string, cb: (e: TaskEvent) => void): () => void {
  const s = state();
  s.emitter.on(taskId, cb);
  return () => s.emitter.off(taskId, cb);
}

export function getLogs(taskId: string): LogEntry[] {
  return state().logs.get(taskId) ?? [];
}

export async function cancelTask(taskId: string) {
  const s = state();
  // Kill any comfy-cli subprocess driving this task before flipping status.
  const cliProc = cliProcs.get(taskId);
  if (cliProc) {
    try { cliProc.kill("SIGKILL"); } catch { /* ignore */ }
    cliProcs.delete(taskId);
  }
  const task = await taskRepository.findStatusAndPromptById(taskId);
  if (!task) return;

  /* R-ardot121 (2026-08-18): previously this required
   *  `status === RUNNING || QUEUED`.  We now accept ANY non-terminal
   *  status — SUCCEEDED / FAILED / CANCELLED are skipped below — so
   *  users can cancel a stuck QUEUED row even when the in-memory
   *  state has been wiped (e.g. by a dev-server restart that the
   *  R-ardot121 reaper hasn't yet swept).  If the task has a
   *  promptId we still try `interrupt()` to tell ComfyUI to drop
   *  its prompt as well; if not, we just close out the DB row. */
  const isTerminal = (st: string | null) =>
    st === "SUCCEEDED" || st === "FAILED" || st === "CANCELLED";

  log(taskId, "warn", "用户取消任务");
  if (!isTerminal(task.status) && task.promptId) {
    try {
      await interrupt();
    } catch {
      /* ignore */
    }
  }

  await taskRepository.cancel(taskId);
  if (task.promptId) s.promptToTask.delete(task.promptId);
  s.promptByTask.delete(taskId);
  // R-ardot111 (2026-08-17): clean up the per-task bookkeeping we
  // added so a re-enqueue of the same taskId starts clean.
  s.startedAt.delete(taskId);
  s.lastNodeByTask.delete(taskId);
  /* R-ardot121 (2026-08-18): only release the runner's slot when we
   *  actually held one.  DB-only tasks (no in-memory job) must NOT
   *  decrement `s.active`, or a future `processQueue` call would
   *  briefly think a slot is free and try to enqueue a phantom job.
   *  `hadSlot` means we either owned the comfy-cli subprocess or
   *  had the task sitting in the in-memory queue. */
  const inQueue = s.queue.some((j) => j.taskId === taskId);
  const hadSlot = inQueue || cliProcs.has(taskId);
  if (hadSlot) s.active = Math.max(0, s.active - 1);
  /* R-ardot114 (2026-08-17): cancel previously only updated the DB
   *  and the in-memory slot, never pushed anything to the SSE
   *  emitter — so the frontend's d.status stayed at "running"
   *  forever and the "生成中…" button never came back.  Emit a
   *  synthetic state event so the canvas patch() flips the node
   *  to error, then a terminal error event so the EventSource
   *  onmessage handler closes the connection (matching the
   *  finalizeFailure pattern at line 886).  Order matters: state
   *  first (heal UI), error second (close socket). */
  s.emitter.emit(taskId, {
    type: "state",
    status: "CANCELLED",
    progress: 0,
    error: "用户取消",
    validationErrors: [],
  });
  s.emitter.emit(taskId, { type: "error", error: "用户取消" });
  // R-ardot115 (2026-08-18): flush any pending debounced log writes
  // for this task so the cancel-line + any in-flight warnings reach
  // the DB before we declare the row terminal.  Without this, a fast
  // cancel-then-reload could miss the "用户取消任务" entry.
  await persistLogs(taskId);
  if (hadSlot) processQueue();
}
