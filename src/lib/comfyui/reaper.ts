// P3 reaper: orphan task reclamation for the ComfyUI runner.
//
// Split out of the legacy single-file `runner.ts`.  This module owns the two
// DB-side sweepers:
//   • reapStaleQueuedTasks()  — QUEUED > 30s with no promptId → FAILED
//   • reapStaleRunningTasks() — RUNNING orphans reconciled against
//     ComfyUI /history + /queue → SUCCEEDED / FAILED
// It starts itself as a module side-effect (guarded by a globalThis key so
// Next.js HMR can never create a second interval).  enqueue.ts imports this
// module as a side effect, so a server that enqueues/subscribes launches the

import { taskRepository } from "../core/repository";
import { resolveComfyBase } from "./client";
import { cliProcs } from "./executor-cli";
import { isComfyStarting } from "./lifecycle";
import { state, log, persistLogs, claimFinalize, type RunnerState } from "./runner-state";
import { logger } from "~/server/lib/logger";

/* ── DB-side QUEUED reaper ─────────────────────────
 * Symptom: after a dev-server cold restart, tasks in
 *   `status=QUEUED, promptId=null, finishedAt=null` linger forever —
 *   the in-memory `s.queue` is gone, the heartbeat only acts on
 *   the in-memory queue (above), and no code path
 *   re-claims DB-side QUEUED rows.  The user sees "加入队列后就不
 *   继续执行了".
 *
 * Two layers of fix:
 *   (a) reapStaleQueuedTasks() — runs on module load + every 30s
 *       afterwards.  An *orphaned* task that has been QUEUED for
 *       > STALE_MS without a `promptId` AND has no in-memory footprint
 *       in the current process (dev cold restart wiped the runner) is
 *       marked FAILED with a clear reason so the user can see the
 *       explanation in the log panel and re-run.  Tasks WITH a promptId
 *       are ComfyUI's responsibility (it's in ComfyUI's queue, not
 *       ours), so we leave them alone.
 *   (b) cancelTask() now also handles the DB-only state (no in-memory
 *       entry) so the user has an escape hatch even before the
 *       30s reaper tick fires.
 *
 *  IMPORTANT scope note: the QUEUED reaper must ONLY reap tasks that are
 *  truly orphaned (dev cold restart wiped the in-memory runner).  A task
 *  that the *current* process is still actively handling must be left
 *  alone — even if its DB row is `QUEUED, promptId=null`.  The raw
 *  UI-format path (@see executeViaComfyCli) does NOT mark the task
 *  RUNNING / write the promptId until the spawned comfy-cli process has
 *  converted the workflow and POSTed it to ComfyUI.  That window can
 *  exceed STALE_MS on a slow Python boot / model load, so without an
 *  in-memory claim check the reaper would wrongly kill a healthy
 *  in-flight task ("任务卡在队列超过 Ns…无人 re-claim").  The check
 *  below mirrors the RUNNING reaper's `promptToTask` guard.
 *
 *  判死前的最后一道保险（ISSUE #378）：in-memory 认领检查是**进程内**记忆，
 *  它有两个已知盲区——(1) `cliProcs` 若因 HMR 重新求值而丢失（已改挂
 *  globalThis，见 executor-cli.ts），(2) raw 任务在 comfy-cli 回传
 *  prompt_id 前 DB 行一直是 `QUEUED/promptId=null`，而 comfy-cli 子进程
 *  是**独立进程**：dev server 重启后旧子进程仍在驱动 ComfyUI，新进程对它
 *  一无所知。此时队列里没有、cliProcs 里没有、executedWorkflow 里也没有
 *  ——三个信号全空，但任务其实健康在跑（用户看到的正是节点在刷「▶ 开始执行」
 *  的同时被判死）。因此判死前必须向 ComfyUI 要**外部证据**：若 ComfyUI 的
 *  /queue 或 /history 仍有本应用（同一 client_id 家族 / 本地主机）的活动，
 *  就说明有在飞的工作流，本轮不回收，等下一 tick 再对账。ComfyUI 不可达
 *  （网络抖动）同样判「证据不足」而不杀——宁可晚一轮，不可误杀。
 */
const REAPER_MS = 30_000;
const STALE_MS = 30_000; // a QUEUED task older than this with no promptId is "dead"
/* RUNNING reaper: a task that DID reach ComfyUI (promptId set)
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

/* HMR fix: under Next.js HMR the runner module is
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
/**
 * Pure in-memory claim check: is `taskId` still owned by the CURRENT dev
 * server process (as opposed to a true orphan left behind by a cold
 * restart)?  A QUEUED task can legitimately be mid-flight with NO promptId
 * written yet — the raw UI-format path (@see executeViaComfyCli) only calls
 * `markRunning` once the spawned comfy-cli process echoes back a
 * `prompt_id`.  During that (possibly >STALE_MS) window the DB row is still
 * `QUEUED, promptId=null`, so a naive reaper would wrongly kill it.
 *
 * Signals, cheapest first:
 *   (a) still waiting in `s.queue`  → about to be de-queued;
 *   (b) a comfy-cli child process is driving it (cliProcs) → raw path is
 *       mid-flight, promptId not yet echoed;
 *   (c) executedWorkflow already recorded → raw path started.
 * Any true orphan (cold restart wiped the in-memory runner) has none of
 * these set.  Mirrors the RUNNING reaper's `promptToTask` guard.
 */
export function isTaskClaimedInProcess(
  s: Pick<RunnerState, "queue" | "executedWorkflow" | "settled">,
  hasCliProc: (taskId: string) => boolean,
  taskId: string
): boolean {
  return (
    s.queue.some((job) => job.taskId === taskId) ||
    hasCliProc(taskId) ||
    s.executedWorkflow.has(taskId) ||
    /* `settled` 是 reaper 与正常执行路径共享的「终态已认领」集合
     *  (@see claimSettle)。命中的任务已被本进程的 executor/看门狗收口，
     *  或已被上一次 reaper tick 收口——两种情况下都不该再被回收，否则
     *  同一个任务会被写两次终态（一条原因进 SSE、另一条进 DB / 应用日志），
     *  用户在「执行日志」与「应用日志」看到互相矛盾的两个失败原因。 */
    s.settled.has(taskId)
  );
}

/* reaper 与正常执行路径（executor / 看门狗）必须共享同一套「终态认领」语义。
 *  executor 侧用 `claimSettle()`（s.settled + 清看门狗定时器）。这里刻意不再
 *  从 executor-ws 反向 import —— 那会给 enqueue → reaper → executor-ws 这条
 *  既有单向链加上回边，纯粹为了一个 3 行的判断不值得。语义逐字对齐：
 *  已在 settled → 认领失败；否则加入 settled 并清掉看门狗定时器。
 *
 *  为什么必须共享：reaper 判 FAILED 与 executor 判 SUCCEEDED/FAILED 是两个
 *  独立写入者。若双方对同一 taskId 各写一次，SSE 订阅者先收到 reaper 的原因
 *  （「任务卡在队列超过 Ns…」），随后 DB / 应用日志又被 executor 的原因覆盖
 *  （「未找到生成结果」），用户就会看到「执行日志」与「应用日志」互相矛盾——
 *  这正是本次要修的跨次运行失败原因不一致。加锁后谁先认领谁赢，两处一致。 */
function claimTerminal(taskId: string): boolean {
  const s = state();
  if (s.settled.has(taskId)) return false;
  s.settled.add(taskId);
  const t = s.timers.get(taskId);
  if (t) clearTimeout(t);
  s.timers.delete(taskId);
  return true;
}

/** 外部证据探针：ComfyUI 侧此刻是否仍有「在飞的工作流」。
 *
 *  纯「进程内记忆」不足以判死一个 QUEUED 孤儿：raw 路径的 comfy-cli 子进程
 *  是独立进程，dev server 重启后新进程既无队列项、也无 cliProcs 句柄、
 *  executedWorkflow 也随内存一起丢了——三个信号全空，但 ComfyUI 其实正在执行。
 *  这里换一个**跨进程**的判据：问 ComfyUI 自己。
 *
 *  返回值语义（保守优先，只区分「有证据在飞」与「无证据」）：
 *    • true  → 在飞任务的**精确**命中（/queue 的 prompt_id 对得上本次执行
 *      已落库的 promptId），或 /queue 里有任何排队项（本应用 MAX_CONCURRENCY=1，
 *      队列非空即说明本应用有任务在跑）。
 *    • false → ComfyUI 明确回答「队列空，且最近一条历史也不是本次执行」→
 *      可以判孤儿。
 *    • null  → 探测失败（网络抖动 / ComfyUI 未运行）：**证据不足**，不回收。
 *
 *  判据取「队列非空」而不是「历史非空」：/history 会保留**全部**历史条目且
 *  无时间过滤，只要 ComfyUI 跑过一次生成，「历史非空」就恒为真——那等于永不
 *  回收，孤儿会永久卡在 QUEUED。因此历史只用于**精确匹配**：若最近一条历史的
 *  prompt_id 恰好等于本任务已落库的 promptId（QUEUED 行通常为 null，故这里
 *  几乎只对「刚写库就被判死」的竞态兜底），才判 true。
 *
 *  单独作为一次 tick 的探测（调用方每个 tick 只调一次，不按行重复请求）。 */
async function comfyHasActiveWorkflow(hintPromptId: string | null): Promise<boolean | null> {
  try {
    const base = await resolveComfyBase();
    const q = await fetch(`${base}/queue`, { signal: AbortSignal.timeout(3_000) });
    if (!q.ok) return null;
    const qd = (await q.json()) as
      | { queue_running?: { prompt_id?: string }[]; queue_pending?: { prompt_id?: string }[] }
      | null;
    const all = [...(qd?.queue_running ?? []), ...(qd?.queue_pending ?? [])];
    /* 队列非空 → 本应用（MAX_CONCURRENCY=1）必有任务在跑。raw 路径的
     *  comfy-cli 自己生成 client_id，无法反查属于哪个 taskId，因此无法区分
     *  时一律不杀。 */
    if (all.length > 0) return true;
    if (!hintPromptId) return false;
    /* 队列空但有 promptId 线索：只有「最近一条历史确实是本次 prompt」才算
     *  在飞（任务刚收尾的竞态窗口），否则视为已死。 */
    const h = await fetch(`${base}/history?max_items=1`, { signal: AbortSignal.timeout(3_000) });
    if (!h.ok) return null;
    const hd = (await h.json()) as Record<string, unknown> | null;
    return !!hd && Object.prototype.hasOwnProperty.call(hd, hintPromptId);
  } catch {
    /* 网络错误 / 超时：证据不足。 */
    return null;
  }
}

/** 导出以便判决矩阵被直接测试（ISSUE #315）：两条 sweeper 的规则是本模块
 *  唯一的价值，30s 定时器只是它们的调用者。生产调用方不变。 */
export async function reapStaleQueuedTasks(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await taskRepository.listStaleQueued(cutoff, 20);
    if (stale.length === 0) return;
    const s = state();
    /* 外部证据每个 tick 只探一次（不按行重复请求：20 行 × 2 次请求 = 40 次）。
     *  探测本身只在「进程内无认领足迹」的行才会被用到，见下方判决。 */
    let comfyEvidence: boolean | null | undefined;
    for (const t of stale) {
      /* In-process guard: if another (concurrent) reaper tick already
       *  claimed this task, skip to avoid duplicate FAILED logs.  The
       *  DB `status: QUEUED` query is not atomic, so two ticks fired
       *  within the same ms could both pick up the same row. */
      if (reaperState.reaping.has(t.id)) continue;
      reaperState.reaping.add(t.id);
      try {
        const ageSec = Math.round((Date.now() - t.createdAt.getTime()) / 1000);
        /* In-memory claim guard: if the current process still owns this
         *  task, it is NOT an orphan — leave it for the normal executor
         *  path to finalise.  Only a task with no in-memory footprint
         *  (dev cold restart) is a true orphan. */
        if (isTaskClaimedInProcess(s, (id) => cliProcs.has(id), t.id)) {
          log(t.id, "warn", `任务仍在当前进程的执行链中（已 ${ageSec}s），跳过 reaper 回收——等待 prompt_id 回传`);
          continue;
        }
        /* ComfyUI 正在自动启动（lifecycle 单飞进行中）时暂不回收——
         * 启动可能需要 30-120s，任务会在 WS 连上后正常出队执行。 */
        if (isComfyStarting()) {
          log(t.id, "warn", `任务在队列中等待 ComfyUI 自动启动（已 ${ageSec}s）——启动完成后自动执行`);
          continue;
        }
        /* 先抢终态：executor 若同时也在收口这个任务，谁先认领谁赢。
         *  抢不到说明本进程（或上一次 tick）已经判过终态——直接跳过，
         *  避免同一任务写出两个互相矛盾的失败原因。 */
        if (!claimTerminal(t.id)) {
          log(t.id, "warn", `reaper 跳过：任务终态已被本进程认领（已 ${ageSec}s）`);
          continue;
        }
        /* 与 executor 共享「DB 终态一次写入」锁：executor 已经落库过就
         *  不再写第二条原因，保证执行日志 / 应用日志 / DB 三者一致。 */
        if (!claimFinalize(t.id)) {
          log(t.id, "warn", `reaper 跳过：任务终态已落库（已 ${ageSec}s）`);
          continue;
        }
        /* 最后一道保险：进程内记忆全空不等于任务已死。raw 路径的 comfy-cli
         *  子进程是独立进程，dev server 重启后新进程看不到它，但 ComfyUI
         *  侧的工作流仍在跑。判死前先问 ComfyUI 要外部证据——有活动或探测
         *  失败都视为「证据不足」，本轮跳过，等下一 tick 再对账（见本函数
         *  上方注释 ISSUE #378）。 */
        if (comfyEvidence === undefined) {
          comfyEvidence = await comfyHasActiveWorkflow(null);
        }
        const comfyActive = comfyEvidence;
        if (comfyActive !== false) {
          log(
            t.id,
            "warn",
            comfyActive === true
              ? `ComfyUI 侧仍有正在执行/排队的工作流（已排队 ${ageSec}s）——跳过回收，等待其收口`
              : `无法确认任务是否仍由 ComfyUI 执行（已排队 ${ageSec}s，ComfyUI 不可达）——本轮不回收，稍后重试`
          );
          continue;
        }
        const reason = `任务卡在队列超过 ${ageSec}s，且 ComfyUI 队列与历史中均无对应活动（本进程内存队列也无此任务的执行链）— 请重新执行`;
        log(t.id, "error", reason);
        /* emit a synthetic state → error pair so any SSE
         *  subscriber immediately sees the terminal failure, then mark
         *  the DB row FAILED.  No processQueue() call — there is no
         *  in-memory job for this task, and we explicitly do NOT want
         *  to re-enqueue an unknown workflow. */
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

/** reconcile RUNNING tasks against ComfyUI.
 *  See header comment on RUNNING_STALE_MS for the verdict matrix. */
/** 同上：RUNNING 对账判决矩阵的测试入口。 */
export async function reapStaleRunningTasks(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - RUNNING_STALE_MS);
    const stale = await taskRepository.listStaleRunning(cutoff, RUNNING_TICK_CAP);
    if (stale.length === 0) return;
    const base = await resolveComfyBase();
    const s = state();
    for (const t of stale) {
      if (!t.promptId) continue;
      if (reaperState.reaping.has(t.id)) continue;
      /* 若该 prompt 仍被当前 dev server 进程的 in-memory runner 监控
       * （comfy-cli / WS 正在等待结果，`promptToTask` 中仍有映射），说明
       * 进程并未真正重启、任务仍在正常执行，reaper 不应插手 —— 正常监控
       * 路径会负责收口。只有 dev server 真正冷重启（内存状态丢失、无人再
       * 认领该 prompt）时才交给本 reaper 对账，避免误判正在执行的任务为
       * FAILED orphan。 */
      if (s.promptToTask.get(t.promptId) === t.id) continue;
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
        /* 与 QUEUED reaper 同一把锁：执行路径若已认领终态就跳过，
         *  保证「执行日志」与「应用日志 / DB」里的失败原因出自同一次收口。 */
        if (!claimTerminal(t.id)) {
          log(t.id, "warn", "reaper(running) 跳过：任务终态已被本进程认领");
          continue;
        }
        if (!claimFinalize(t.id)) {
          log(t.id, "warn", "reaper(running) 跳过：任务终态已落库");
          continue;
        }
        const finalStatus = verdict === "succeeded" ? "SUCCEEDED" : "FAILED";
        log(t.id, verdict === "succeeded" ? "success" : "error", reason);
        /* 复用函数顶层的 s，避免嵌套块内重复声明触发 no-shadow。 */
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
