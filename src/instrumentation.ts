// Next.js 15 instrumentation hook — runs once when the Node.js server
// boots (both in dev and production).  We use it for one job:
//
//   ── R-ardot111 (2026-08-17): reconcile stale RUNNING tasks ──
//
// The runner keeps in-memory state (WebSocket connection, active task
// queue, in-flight log buffers).  When the dev / production server
// restarts, that state evaporates, but the DB still has `Task.status
// = "RUNNING"` rows for tasks that were in flight at the moment of
// shutdown.  Without intervention, the canvas-side picture node
// shows "生成中..." with 0% forever, the log panel replays nothing,
// and the user has no idea the task is dead.
//
// On startup we sweep every RUNNING task with `finishedAt = null`,
// mark it FAILED with a clear "服务重启" error, and append a
// matching log entry to `Task.logs` so the SSE replay surfaces
// something useful when the user opens the log panel.
//
// The hook is idempotent: a `globalThis` flag prevents re-running
// on Next dev's HMR reloads.

import { prisma } from "./lib/db";

const RECONCILE_FLAG = "__comfyapp_task_reconciled__";
type GlobalWithFlag = typeof globalThis & { [RECONCILE_FLAG]?: boolean };

export async function register(): Promise<void> {
  // Edge runtime doesn't have prisma; skip silently there.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  await reconcileStaleRunningTasks();
}

/**
 * Sweep stale RUNNING tasks: tasks whose server-side runner evaporated
 * on restart and would otherwise stay stuck in "生成中..." forever.
 *
 * - Idempotent via a `globalThis` flag (HMR-safe).
 * - Never throws — reconciliation is best-effort; failure to update
 *   a row must not bring the whole server down.
 */
async function reconcileStaleRunningTasks(): Promise<void> {
  const g = globalThis as GlobalWithFlag;
  if (g[RECONCILE_FLAG]) return;
  g[RECONCILE_FLAG] = true;

  let stale: { id: string; createdAt: Date; logs: unknown }[];
  try {
    stale = await prisma.task.findMany({
      where: {
        status: "RUNNING",
        finishedAt: null,
      },
      select: {
        id: true,
        createdAt: true,
        logs: true,
      },
      take: 200,
    });
  } catch (e) {
    // DB unavailable (e.g. lock contention during boot) — try again
    // on next boot.  Do not throw.
    console.warn("[instrumentation] failed to query stale RUNNING tasks:", e);
    return;
  }

  if (!stale.length) return;

  const now = new Date();
  for (const t of stale) {
    try {
      const elapsedSec = Math.max(
        0,
        Math.round((now.getTime() - new Date(t.createdAt).getTime()) / 1000)
      );
      const errorMsg = `服务重启，任务已中止（运行了 ${elapsedSec}s 未完成）`;
      const existingLogs: any[] = Array.isArray(t.logs) ? (t.logs as any[]) : [];
      const newLog = {
        t: now.getTime(),
        level: "error",
        msg: `✗ ${errorMsg}`,
      };
      await prisma.task.update({
        where: { id: t.id },
        data: {
          status: "FAILED",
          error: errorMsg,
          finishedAt: now,
          logs: [...existingLogs, newLog] as any,
          // No `validationErrors` — the original failure is unknown;
          // the user is expected to re-run, which will populate a
          // fresh structured `validationErrors` if the underlying
          // workflow is still broken.
        },
      });
    } catch (e) {
      // Per-row failure is non-fatal — log and continue.
      console.warn(`[instrumentation] failed to reconcile task ${t.id}:`, e);
    }
  }

  console.log(
    `[instrumentation] reconciled ${stale.length} stale RUNNING task(s) to FAILED`
  );
}
