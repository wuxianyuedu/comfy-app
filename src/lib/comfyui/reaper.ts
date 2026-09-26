// 孤儿任务回收（reaper），服务于 ComfyUI 执行器。
//
// 从历史的单文件 `runner.ts` 里拆出来的。本模块负责两个 DB 侧的清扫器：
//   • reapStaleQueuedTasks()  —— QUEUED 超过 30s 且没有 promptId → FAILED
//   • reapStaleRunningTasks() —— RUNNING 的孤儿任务，拿 ComfyUI 的
//     /history 与 /queue 对账 → SUCCEEDED / FAILED
// 它以**模块级副作用**的形式启动自己（用 globalThis 键兜住，
// Next.js HMR 因此永远不会造出第二个定时器）。enqueue.ts 以副作用方式导入本模块，
// 于是任何会入队 / 订阅的服务端一启动就把它拉起来了。

import { errorText } from "~/lib/error-message";
import { isSchemaReady } from "~/lib/db-schema-ready";
// `../core/repository` 静态值 import 已改成 lazy（P3 §5 第 1 期·最后一步：
// 让整条 reaper 边不再撞 `import "server-only"` throw、纯 Node executor host
// 加载 reaper 时能干净过）。同 #1053 runner-state / #1068 executor-finalize
// / #1071 executor-cli / 本 PR enqueue 的模式：`configureReaper({ taskRepo })`
// + 未注入时首次调用 dynamic import 兜底 Next 侧真单例。
import { resolveComfyBase } from "./client";
import { cliProcs } from "./executor-cli";
import { isComfyStarting } from "./lifecycle";
import {
  state,
  log,
  persistLogs,
  claimFinalize,
  type RunnerState,
} from "./runner-state";
import { logger } from "~/lib/core/logger";

/* ── 依赖注入接缝（P3 §5 第 1 期·最后一步） ───────────────────────────── */

async function loadRealTaskRepo() {
  return (await import("../core/repository")).taskRepository;
}
type TaskRepoForReaper = Pick<
  Awaited<ReturnType<typeof loadRealTaskRepo>>,
  | "listStaleQueued"
  | "listStaleRunning"
  | "finalizeFailure"
  | "finalizeFromReaper"
>;

export type ReaperDeps = { taskRepo: TaskRepoForReaper };
let depsOverride: Partial<ReaperDeps> = {};

/** executor host 在 boot 时注入自带 DB 句柄；Next 侧无需（走 dynamic import 兜底）。 */
export function configureReaper(next: Partial<ReaperDeps>): void {
  depsOverride = { ...depsOverride, ...next };
}

async function resolveTaskRepo(): Promise<TaskRepoForReaper> {
  if (depsOverride.taskRepo) return depsOverride.taskRepo;
  return loadRealTaskRepo();
}

/* ── DB 侧的 QUEUED 回收器 ─────────────────────────
 * 症状：dev server 冷重启之后，状态为
 *   `status=QUEUED, promptId=null, finishedAt=null` 的任务会永远挂着 ——
 *   进程内的 `s.queue` 没了，心跳只作用于（上面的）内存队列，
 *   而没有任何代码路径……
 *   re-claims DB-side QUEUED rows.  The user sees "加入队列后就不
 *   继续执行了".
 *
 * 修法有两层：
 *   (a) reapStaleQueuedTasks() —— 模块加载时跑一次，之后每 30s 一次。
 *       一个**孤儿**任务满足「QUEUED 超过 STALE_MS 且没有 `promptId`，
 *       并且在当前进程里**没有任何内存足迹**」（dev 冷重启把执行器清空了），
 *       才被标成 FAILED，并给出明确原因 —— 用户能在日志面板看到解释并重跑。
 *       带 `promptId` 的任务归 ComfyUI 负责（它在 ComfyUI 的队列里，不在我们的），
 *       因此不碰。
 *   (b) cancelTask() 现在还处理「只有 DB 行、没有内存条目」的状态，
 *       用户不必等那 30s 的回收节拍就有出口。
 *
 *  **适用范围很重要**：QUEUED 回收器**只**能回收真正孤儿的任务
 *  （dev 冷重启抹掉了内存执行器）。**当前**进程仍在积极处理的任务必须放过 ——
 *  哪怕它的 DB 行还是 `QUEUED, promptId=null`。raw UI 格式那条路径
 *  （@see executeViaComfyCli）在 spawn 出来的 comfy-cli 进程把工作流转好、
 *  POST 给 ComfyUI 之前，是**不会**把任务标成 RUNNING / 写 promptId 的。
 *  而这个窗口在 Python 冷启动 / 加载模型时可能超过 STALE_MS，
 *  所以没有「内存认领」这道检查，回收器就会把一个健康的任务错杀。
 *  in-flight task ("任务卡在队列超过 Ns…无人 re-claim").  The check
 *  下面这条判据与 RUNNING 回收器的 `promptToTask` 守卫一致。
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
/* RUNNING 回收器：一个任务**确实**到了 ComfyUI（promptId 已写），
 *  但它的内存执行器丢了（dev 冷重启、崩溃），就会永远卡在 RUNNING ——
 *  心跳只重新驱动内存队列。ComfyUI 的 /queue 对内存状态也一无所知，
 *  于是我们直接问 ComfyUI 要结论：
 *    • /history/{promptId} 有条目 → 标 SUCCEEDED（若是 execution_error 则 FAILED）。
 *      产物在 ComfyUI 的 history 里；这里**不**重新拉二进制（那是另一件事），
 *      原因字符串把用户指向 promptId。
 *    • 404 → ComfyUI 从没见过它（ComfyUI 也重启了，或 prompt 被上游拒了）
 *      → 标成 FAILED 孤儿。
 *    • 还在 /queue 里 → 它确实在跑，放过，下一轮再看。
 *    • 网络错误 → 放过，下一轮再看。
 *  首次检查放在 60s：给 ComfyUI 留出确认一次快速出图的时间；
 *  回收节拍是 30s，所以长视频会在 ComfyUI 完成后不久对上账。
 *  finishes. */
const RUNNING_STALE_MS = 60_000;
const RUNNING_TICK_CAP = 5;

/* HMR 修正：Next.js HMR 下执行器模块会被重新求值，
 *  因此只在模块作用域放一个 `let reaperHandle` 的话，每次热重载都会被重置成 null，
 *  然后新建一个 setInterval。多个定时器会并发跑 reapStaleQueuedTasks() ——
 *  而 findMany → update 不是原子的，同一个 QUEUED 任务会被记 2~3 次
 *  （现场是「卡在队列 2203s / 2210s / 2217s」三条）。
 *  因此把 handle 与在途守卫**都**挂在 globalThis 上：
 *  无论热重载多少次，每个进程里只有一个回收器。 */
interface ReaperGlobal {
  handle: ReturnType<typeof setInterval> | null;
  reaping: Set<string>;
}

declare global {
  var __comfyReaper_v1: ReaperGlobal | undefined;
}

const reaperState: ReaperGlobal = (globalThis.__comfyReaper_v1 ??= {
  handle: null,
  reaping: new Set(),
});
/**
 * 纯内存的认领检查：`taskId` 是否仍被**当前** dev server 进程持有
 *  （相对于冷重启留下的真孤儿）。
 * 重启）？QUEUED 任务完全可能健康地在飞、还没有写下 promptId ——
 * raw UI 格式那条路径（@see executeViaComfyCli）要等 spawn 出来的
 * comfy-cli 进程回传 `prompt_id` 才会调 `markRunning`。在这个（可能超过
 * STALE_MS 的）窗口里，DB 行仍是 `QUEUED, promptId=null`，
 * 天真的回收器就会把它错杀。
 *
 * 判据信号，从最便宜的排起：
 *   (a) 还在 `s.queue` 里等着 → 马上要出队；
 *   (b) 有 comfy-cli 子进程在驱动它（cliProcs）→ raw 路径在飞，
 *       promptId 还没回传；
 *   (c) executedWorkflow 已有记录 → raw 路径已经起步。
 * 真正的孤儿（冷重启抹掉了内存执行器）这三个信号一个都没有。
 * 与 RUNNING 回收器的 `promptToTask` 守卫一致。
 */
export function isTaskClaimedInProcess(
  s: Pick<RunnerState, "queue" | "executedWorkflow" | "settled">,
  hasCliProc: (taskId: string) => boolean,
  taskId: string,
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
async function comfyHasActiveWorkflow(
  hintPromptId: string | null,
): Promise<boolean | null> {
  try {
    const base = await resolveComfyBase();
    const q = await fetch(`${base}/queue`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!q.ok) return null;
    const qd = (await q.json()) as {
      queue_running?: { prompt_id?: string }[];
      queue_pending?: { prompt_id?: string }[];
    } | null;
    const all = [...(qd?.queue_running ?? []), ...(qd?.queue_pending ?? [])];
    /* 队列非空 → 本应用（MAX_CONCURRENCY=1）必有任务在跑。raw 路径的
     *  comfy-cli 自己生成 client_id，无法反查属于哪个 taskId，因此无法区分
     *  时一律不杀。 */
    if (all.length > 0) return true;
    if (!hintPromptId) return false;
    /* 队列空但有 promptId 线索：只有「最近一条历史确实是本次 prompt」才算
     *  在飞（任务刚收尾的竞态窗口），否则视为已死。 */
    const h = await fetch(`${base}/history?max_items=1`, {
      signal: AbortSignal.timeout(3_000),
    });
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
  // 顶部一次性 resolve：下游 closure 沿用旧名（`taskRepository`），call site 不动。
  const taskRepository = await resolveTaskRepo();
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await taskRepository.listStaleQueued(cutoff, 20);
    if (stale.length === 0) return;
    const s = state();
    /* 外部证据每个 tick 只探一次（不按行重复请求：20 行 × 2 次请求 = 40 次）。
     *  探测本身只在「进程内无认领足迹」的行才会被用到，见下方判决。 */
    let comfyEvidence: boolean | null | undefined;
    for (const t of stale) {
      /* 进程内守卫：若另一个（并发的）回收节拍已经认领了这个任务，就跳过 ——
       *  免得重复记 FAILED 日志。DB 的 `status: QUEUED` 查询不是原子的，
       *  同一毫秒内触发的两个节拍可能同时捞到同一行。 */
      if (reaperState.reaping.has(t.id)) continue;
      reaperState.reaping.add(t.id);
      try {
        const ageSec = Math.round((Date.now() - t.createdAt.getTime()) / 1000);
        /* 内存认领守卫：当前进程仍持有这个任务时，它**不是**孤儿 ——
         *  留给正常的执行路径去收口。只有在内存里毫无足迹的任务
         *  （dev 冷重启）才算真孤儿。 */
        if (isTaskClaimedInProcess(s, (id) => cliProcs.has(id), t.id)) {
          log(
            t.id,
            "warn",
            `任务仍在当前进程的执行链中（已 ${ageSec}s），跳过 reaper 回收——等待 prompt_id 回传`,
          );
          continue;
        }
        /* ComfyUI 正在自动启动（lifecycle 单飞进行中）时暂不回收——
         * 启动可能需要 30-120s，任务会在 WS 连上后正常出队执行。 */
        if (isComfyStarting()) {
          log(
            t.id,
            "warn",
            `任务在队列中等待 ComfyUI 自动启动（已 ${ageSec}s）——启动完成后自动执行`,
          );
          continue;
        }
        /* 先抢终态：executor 若同时也在收口这个任务，谁先认领谁赢。
         *  抢不到说明本进程（或上一次 tick）已经判过终态——直接跳过，
         *  避免同一任务写出两个互相矛盾的失败原因。 */
        if (!claimTerminal(t.id)) {
          log(
            t.id,
            "warn",
            `reaper 跳过：任务终态已被本进程认领（已 ${ageSec}s）`,
          );
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
              : `无法确认任务是否仍由 ComfyUI 执行（已排队 ${ageSec}s，ComfyUI 不可达）——本轮不回收，稍后重试`,
          );
          continue;
        }
        const reason = `任务卡在队列超过 ${ageSec}s，且 ComfyUI 队列与历史中均无对应活动（本进程内存队列也无此任务的执行链）— 请重新执行`;
        log(t.id, "error", reason);
        /* 合成一对「state → error」事件，让任何 SSE 订阅者立刻看到终态失败，
         *  随后把 DB 行标成 FAILED。**不**调 processQueue() ——
         *  这个任务在内存里根本没有作业，而且我们明确不希望把一个未知工作流
         *  重新入队。 */
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
        `[comfyui] reaper: marked ${stale.length} stale QUEUED task(s) as FAILED (older than ${STALE_MS / 1000}s, no promptId)`,
      );
    }
  } catch (err) {
    logger.warn(`[comfyui] ${errorText(err, "reapStaleQueuedTasks 失败")}`);
  }
}

/** 拿 ComfyUI 对账 RUNNING 任务。
 *  判决矩阵见 RUNNING_STALE_MS 上方的文件头注释。 */
/** 同上：RUNNING 对账判决矩阵的测试入口。 */
export async function reapStaleRunningTasks(): Promise<void> {
  const taskRepository = await resolveTaskRepo();
  try {
    const cutoff = new Date(Date.now() - RUNNING_STALE_MS);
    const stale = await taskRepository.listStaleRunning(
      cutoff,
      RUNNING_TICK_CAP,
    );
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
            const entry =
              data && (data[t.promptId] as Record<string, unknown> | undefined);
            if (entry) {
              const status = entry.status as
                | { executed?: unknown; errored?: unknown; messages?: unknown }
                | undefined;
              const errMsg = (entry.error as { message?: string } | undefined)
                ?.message;
              if (status?.errored || errMsg) {
                verdict = "failed";
                reason = `ComfyUI execution_error: ${errMsg ?? "未知原因"} (promptId=${t.promptId})`;
              } else {
                verdict = "succeeded";
                reason = `已完成 · 输出见 ComfyUI /history/${t.promptId}（dev server 重启后由 reaper 对账恢复）`;
              }
            } else {
              /* 200 + 没有条目：ComfyUI 对未知 prompt **不会**回 404 ——
               *  它返回 `{}`。可能是 (a) prompt 还在处理（稍后会出现），
               *  也可能是 (b) ComfyUI 从没见过它（孤儿）。
               *  与 /queue 交叉核对：若该 prompt 既不在 queue_running
               *  也不在 queue_pending 里，那就等于丢了 → FAILED 孤儿。 */
              let inQueue = false;
              try {
                const q = await fetch(`${base}/queue`, {
                  signal: AbortSignal.timeout(3_000),
                });
                if (q.ok) {
                  const qd = (await q.json()) as {
                    queue_running?: { prompt_id?: string }[];
                    queue_pending?: { prompt_id?: string }[];
                  } | null;
                  const all = [
                    ...(qd?.queue_running ?? []),
                    ...(qd?.queue_pending ?? []),
                  ];
                  inQueue = all.some((all) => all?.prompt_id === t.promptId);
                }
              } catch {
                /* 队列探测失败 —— 落到「未知」分支 */
              }
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
          verdict === "failed" ? reason : null,
        );
        await persistLogs(t.id);
      } finally {
        reaperState.reaping.delete(t.id);
      }
    }
    logger.warn(
      `[comfyui] reaper(running): checked ${stale.length} stale RUNNING task(s) (older than ${RUNNING_STALE_MS / 1000}s)`,
    );
  } catch (err) {
    logger.warn(`[comfyui] ${errorText(err, "reapStaleRunningTasks 失败")}`);
  }
}

/** 单轮回收：表还没建好就整轮跳过，而不是让 sqlite 的错误浮出。 */
function sweepOnce(): void {
  if (!isSchemaReady()) return;
  void reapStaleQueuedTasks();
  void reapStaleRunningTasks();
}

function startReaper() {
  if (reaperState.handle) return; // 跨 HMR 重载的单例
  /* 模块加载时先跑一次：刚重启的 dev server 便能**立刻**收拾掉
   * 上一段生命周期遗留下的任务，而不是等到 30 秒之后。
   *
   *  守卫：本模块是以**裸副作用**方式被导入的（enqueue.ts），
   *  因此在「数据库还不可用」时加载模块图同样会执行它 —— 最典型的是
   *  `next build` 的 collect-page-data / prerender 阶段，
   *  以及还没跑过 `pnpm db:push` 的干净检出。
   *  那时读库会抛 `no such table: task`，浮出来变成构建阶段的错误，
   *  把 CI 的 `pnpm build` 门槛打红，而原因与报错栈里的路由毫无关系。
   *  跳过是安全的：回收是幂等的，每 REAPER_MS 还会再来一轮。
   *
   *  「库坏了」（表存在但查询失败）**不**在这里被吞掉——那种情况继续走
   *  各自的 catch 暴露出来，本判断只挡「表还没建」。 */
  sweepOnce();
  reaperState.handle = setInterval(sweepOnce, REAPER_MS);
  /* `unref()`：回收器是常驻后台职责，不该把 Node 事件循环吊住 ——
   * dev server 关停时能自然退出，而不必等这一轮 30s 间隔走完。
   * 常驻的 HTTP server 仍持有事件循环，unref 不会让进程提前退出。 */
  reaperState.handle.unref?.();
}
startReaper();
