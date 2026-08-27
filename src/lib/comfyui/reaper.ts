// P3 reaper: orphan task reclamation for the ComfyUI runner.
//
// Extracted from `runner.ts` (1971 → split).  This module owns the two
// DB-side sweepers:
//   • reapStaleQueuedTasks()  — QUEUED > 30s with no promptId → FAILED
//   • reapStaleRunningTasks() — RUNNING orphans reconciled against
//     ComfyUI /history + /queue → SUCCEEDED / FAILED
// It starts itself as a module side-effect (guarded by a globalThis key so
// Next.js HMR can never create a second interval).  `runner.ts` imports this
// module so a cold start launches the reaper alongside the executor.

import { taskRepository } from "../core/repository";
import { resolveComfyBase } from "./client";
import { state, log, persistLogs } from "./runner-state";
import { logger } from "~/server/lib/logger";

/* ── R-ardot121 (2026-08-18): DB-side QUEUED reaper ─────────────────────────
 * Symptom: after a dev-server cold restart (R-117), tasks in
 *   `status=QUEUED, promptId=null, finishedAt=null` linger forever —
 *   the in-memory `s.queue` is gone, the heartbeat only acts on
 *   the in-memory queue (R-ardot113 above), and no code path
 *   re-claims DB-side QUEUED rows.  The user sees "加入队列后就不
 *   继续执行了".
 *
 * Two layers of fix:
 *   (a) reapStaleQueuedTasks() — runs on module load + every 30s
 *       afterwards.  Any task that has been QUEUED for > STALE_MS
 *       without a `promptId` is marked FAILED with a clear reason
 *       so the user can see the explanation in the log panel and
 *       re-run.  Tasks WITH a promptId are ComfyUI's responsibility
 *       (it's in ComfyUI's queue, not ours), so we leave them alone.
 *   (b) cancelTask() now also handles the DB-only state (no in-memory
 *       entry) so the user has an escape hatch even before the
 *       30s reaper tick fires.
 */
const REAPER_MS = 30_000;
const STALE_MS = 30_000; // a QUEUED task older than this with no promptId is "dead"
/* R-ardot121 RUNNING reaper: a task that DID reach ComfyUI (promptId set)
 *  but whose in-memory runner got lost (dev cold restart, crash) is stuck
 *  as RUNNING forever — the heartbeat only re-drives the in-memory queue.
 *  ComfyUI's /queue has no reference to our in-memory state either, so
 *  we ask ComfyUI for the verdict:
 *    • /history/{promptId} has the entry → mark SUCCEEDED (or FAILED if
 *      execution_error). The output is in ComfyUI history; we don't
 *      re-fetch binaries here (separate concern), the reason string
 *      points the user to promptId.
 *    • 404 → ComfyUI never saw it (ComfyUI also restarted, or the prompt
 *      was rejected upstream) → mark FAILED orphan.
 *    • still in /queue → legitimately running, leave it; re-check next tick.
 *    • network error → leave it, re-check next tick.
 *  60s first check gives ComfyUI time to ack a fast image gen; reaper
 *  tick is 30s so a long video will reconcile shortly after ComfyUI
 *  finishes. */
const RUNNING_STALE_MS = 60_000;
const RUNNING_TICK_CAP = 5;

/* R-ardot121 HMR fix: under Next.js HMR the runner module is
 *  re-evaluated, so a plain module-scope `let reaperHandle` is reset to
 *  null on every reload and a SECOND setInterval is created.  Multiple
 *  intervals then concurrently run reapStaleQueuedTasks() — and because
 *  findMany→update is not atomic, the same QUEUED task gets logged 2-3×
 *  ("卡在队列 2203s/2210s/2217s").  Key both the handle and the
 *  in-flight guard on globalThis so there is exactly ONE reaper per
 *  process no matter how many HMR reloads happen. */
const REAPER_GLOBAL = "__comfyReaper_v1";
interface ReaperGlobal {
  handle: ReturnType<typeof setInterval> | null;
  reaping: Set<string>;
}
const rg = globalThis as unknown as Record<string, ReaperGlobal | undefined>;
const reaperState: ReaperGlobal = rg[REAPER_GLOBAL] ?? { handle: null, reaping: new Set() };
rg[REAPER_GLOBAL] = reaperState;

async function reapStaleQueuedTasks(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await taskRepository.listStaleQueued(cutoff, 20);
    for (const t of stale) {
      /* In-process guard: if another (concurrent) reaper tick already
       *  claimed this task, skip to avoid duplicate FAILED logs.  The
       *  DB `status: QUEUED` query is not atomic, so two ticks fired
       *  within the same ms could both pick up the same row. */
      if (reaperState.reaping.has(t.id)) continue;
      reaperState.reaping.add(t.id);
      try {
        const ageSec = Math.round((Date.now() - t.createdAt.getTime()) / 1000);
        const reason = `任务卡在队列超过 ${ageSec}s（dev server 重启后 in-memory 队列清空，无人 re-claim）— 请重新执行`;
        log(t.id, "error", reason);
        /* R-ardot121: emit a synthetic state → error pair so any SSE
         *  subscriber immediately sees the terminal failure, then mark
         *  the DB row FAILED.  No processQueue() call — there is no
         *  in-memory job for this task, and we explicitly do NOT want
         *  to re-enqueue an unknown workflow. */
        const s = state();
        s.emitter.emit(t.id, {
          type: "state",
          status: "FAILED",
          progress: 0,
          error: reason,
          validationErrors: [],
        });
        s.emitter.emit(t.id, { type: "error", error: reason });
        await taskRepository.finalizeFailure(t.id, reason);
        await persistLogs(t.id);
      } finally {
        reaperState.reaping.delete(t.id);
      }
    }
    if (stale.length > 0) {
      logger.warn(
        `[comfyui] reaper: marked ${stale.length} stale QUEUED task(s) as FAILED (older than ${STALE_MS / 1000}s, no promptId)`
      );
    }
  } catch (err) {
    logger.warn(`[comfyui] reapStaleQueuedTasks 失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** R-ardot121 (2026-08-18): reconcile RUNNING tasks against ComfyUI.
 *  See header comment on RUNNING_STALE_MS for the verdict matrix. */
async function reapStaleRunningTasks(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RUNNING_STALE_MS);
    const stale = await taskRepository.listStaleRunning(cutoff, RUNNING_TICK_CAP);
    if (stale.length === 0) return;
    const base = await resolveComfyBase();
    for (const t of stale) {
      if (!t.promptId) continue;
      if (reaperState.reaping.has(t.id)) continue;
      reaperState.reaping.add(t.id);
      try {
        const url = `${base}/history/${encodeURIComponent(t.promptId)}`;
        let verdict: "succeeded" | "failed" | "unknown" = "unknown";
        let reason = "";
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
          if (r.status === 200) {
            const data = (await r.json()) as Record<string, unknown> | null;
            const entry = data && (data[t.promptId] as Record<string, unknown> | undefined);
            if (entry) {
              const status = entry.status as { executed?: unknown; errored?: unknown; messages?: unknown } | undefined;
              const errMsg = (entry.error as { message?: string } | undefined)?.message;
              if (status?.errored || errMsg) {
                verdict = "failed";
                reason = `ComfyUI execution_error: ${errMsg ?? "未知原因"} (promptId=${t.promptId})`;
              } else {
                verdict = "succeeded";
                reason = `已完成 · 输出见 ComfyUI /history/${t.promptId}（dev server 重启后由 reaper 对账恢复）`;
              }
            } else {
              /* 200 + no entry: ComfyUI does NOT 404 for unknown prompts — it
               *  returns `{}`.  Could be (a) prompt still processing (will
               *  appear later) or (b) ComfyUI never saw it (orphan).  Cross-
               *  check /queue: if the prompt is NOT in queue_running nor
               *  queue_pending, it's effectively lost → FAILED orphan. */
              let inQueue = false;
              try {
                const q = await fetch(`${base}/queue`, { signal: AbortSignal.timeout(3_000) });
                if (q.ok) {
                  const qd = (await q.json()) as { queue_running?: { prompt_id?: string }[]; queue_pending?: { prompt_id?: string }[] } | null;
                  const all = [...(qd?.queue_running ?? []), ...(qd?.queue_pending ?? [])];
                  inQueue = all.some((all) => all?.prompt_id === t.promptId);
                }
              } catch { /* queue probe failed — fall through to unknown */ }
              if (!inQueue) {
                verdict = "failed";
                reason = `dev server 重启后无人在监控，ComfyUI /history 与 /queue 均无此 prompt (${t.promptId}) — 请重新执行`;
              } else {
                verdict = "unknown";
                reason = `ComfyUI /history 无条目但 /queue 仍在排队 — 下次重试`;
              }
            }
          } else if (r.status === 404) {
            verdict = "failed";
            reason = `dev server 重启后无人在监控，ComfyUI 已无此 prompt (${t.promptId}) 的历史 — 请重新执行`;
          } else {
            verdict = "unknown";
            reason = `ComfyUI /history 返回 ${r.status} — 下次重试`;
          }
        } catch (netErr) {
          verdict = "unknown";
          reason = `ComfyUI 不可达：${netErr instanceof Error ? netErr.message : "network"} — 下次重试`;
        }
        if (verdict === "unknown") {
          log(t.id, "warn", `reaper(running): ${reason}`);
          continue;
        }
        const finalStatus = verdict === "succeeded" ? "SUCCEEDED" : "FAILED";
        log(t.id, verdict === "succeeded" ? "success" : "error", reason);
        const s = state();
        s.emitter.emit(t.id, {
          type: "state",
          status: finalStatus,
          progress: verdict === "succeeded" ? 1 : 0,
          error: verdict === "failed" ? reason : null,
          validationErrors: [],
        });
        s.emitter.emit(t.id, {
          type: verdict === "succeeded" ? "done" : "error",
          ...(verdict === "failed" ? { error: reason } : {}),
        });
        await taskRepository.finalizeFromReaper(
          t.id,
          finalStatus,
          verdict === "failed" ? reason : null
        );
        await persistLogs(t.id);
      } finally {
        reaperState.reaping.delete(t.id);
      }
    }
    logger.warn(
      `[comfyui] reaper(running): checked ${stale.length} stale RUNNING task(s) (older than ${RUNNING_STALE_MS / 1000}s)`
    );
  } catch (err) {
    logger.warn(`[comfyui] reapStaleRunningTasks 失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

function startReaper() {
  if (reaperState.handle) return; // singleton across HMR reloads
  // Fire once on module load so a freshly-restarted dev server heals
  // any tasks abandoned by the previous lifetime *immediately*, not
  // 30s later.
  void reapStaleQueuedTasks();
  void reapStaleRunningTasks();
  reaperState.handle = setInterval(() => {
    void reapStaleQueuedTasks();
    void reapStaleRunningTasks();
  }, REAPER_MS);
}
startReaper();
