/**
 * `executor-dispatch.ts` — 唯一的派发循环：从库里领一行，交给 comfy-cli
 * ===========================================================================
 *
 * 为什么只有一条 pull（P3 §5 ADR §14 D1 的第二刀）
 * ------------------------------------------------
 * 这里此前有**两条**派发循环：
 *
 *   - Next 侧 `executor-scheduler.ts` 的 `processQueue()` —— 提交方把 Job
 *     `push` 进进程内存队列，再由出队 / 3s 心跳往前推；
 *   - host 侧 `scripts/executor-host.mjs` 的 `claimTickOnce()` —— 按
 *     `claimedBy` 从库里领行。
 *
 * 两条循环读的是两份真相（内存 vs 库），后果不止「代码重复」：
 *   1. `RUNNING` 的含义分裂——host 那片把行领走时库里已经是 `RUNNING`，而它可能
 *      还躺在内存队列里等空槽，那段窗口里状态栏的 `queued` 数出来是 0（4-B2 端到
 *      端实测到的；inline 那片等待的行仍是 `QUEUED`，计数没错）；
 *   2. 冷启动遗留在 `QUEUED` 的行只有 host 那条 pull 会救回来（inline 那条看不见
 *      库，只能等回收器按 30s 判死——那条规则本身也已被 ISSUE #1204 收窄）；
 *   3. 「谁负责起 ComfyUI」挂在内存队列的入队动作上（`enqueue()` 里那句
 *      `void connect()`），改成库驱动后必须一起搬进来，否则没人拉起。
 *
 * 现在两宿主共用本模块：Next 的 owner 是 `inline`、host 的是 `host`，领取谓词
 * 仍是 impl 里唯一的 `ownedBy()`。**领之前先确认本进程跑得动**（签字选定的形态）：
 * WS 没就绪就不领行，行留在 `QUEUED`，等就绪的下一拍再领——`QUEUED` 因此是健康的
 * 等待态，回收器不会来判死它（死信规则已收窄到「没有任何宿主片会领」的行，
 * ISSUE #1204；ComfyUI 冷启动那 30~120s 的窗口原先靠 `isComfyStarting()` 守卫兜，
 * 现在整类都不进候选集）。这样 `RUNNING` 就只剩一个意思：真的在跑。
 *
 * 启动点是**两处显式调用**（与 reaper 在 §14 D3 之后的形态同构，判据由
 * `tests/dispatch-startup-points.test.ts` 钉）：Next 侧
 * `src/instrumentation.ts` 的 nodejs 分支、host 侧 `scripts/executor-host.mjs`
 * 注入链之后。模块加载不起循环，避免「host 进程里也跑一条 inline 心跳」。
 *
 * §18.4 三选一：第三类（纯 Node 宿主可加载）——无 `server-only`、无 Node 内建
 * value import；DB 句柄与 owner 由宿主经 {@link configureDispatch} 注入，Next 侧
 * 未注入时走 dynamic import 兜底（与 reaper / enqueue 同一形态）。
 *
 * @module comfyui/executor-dispatch — 唯一的派发循环（领取 + 提交）
 */
import WebSocket from "ws";
import { errorText } from "~/lib/error-message";
import { fireAndForget } from "~/lib/async-action";
import { logger } from "~/lib/core/logger";
import {
  MAX_CONCURRENCY,
  clearFinalize,
  log,
  logWhileQueued,
  markDispatched,
  releaseDispatchSlot,
  state,
  takeQueuedEntries,
} from "./runner-state";
import type { Job, LogEntry } from "./runner-state";
import { executeViaComfyCli } from "./executor-cli";
import { connect } from "./executor-ws";
import { finalizeFailure } from "./executor-finalize";
import {
  registerQueueAnnounce,
  registerQueueKick,
} from "./executor-continuation";
import type { TaskClaimMode, TaskRepoImpl } from "../core/repository-task-impl";

/** 领取节拍。与 host 侧原 `CLAIM_TICK_MS` 同值（2s）：它是「安全网」的节奏，
 *  正常路径靠提交后与收口后的即时 kick，不靠等这一拍。 */
export const DISPATCH_TICK_MS = 2_000;

/** 本模块要的那三条仓储能力（结构化最小，方便宿主注入自己的 impl 实例）。 */
type DispatchRepo = Pick<
  TaskRepoImpl,
  "claimNextQueued" | "findExecJob" | "finalizeFailure" | "listQueuedIds"
>;

let repoOverride: DispatchRepo | null = null;
let ownerOverride: TaskClaimMode | null = null;

/** 宿主注入自带的 DB 句柄与归属声明（host 必调；Next 不调，走下方兜底）。
 *  `owner` 与 `createTaskRepoImpl(db, { owner })` 那次声明**必须同源**，
 *  否则领到的行与收口时的守卫判据不一致（同 reaper 那条约束）。 */
export function configureDispatch(next: {
  taskRepo?: DispatchRepo;
  owner?: TaskClaimMode;
}): void {
  if (next.taskRepo) repoOverride = next.taskRepo;
  if (next.owner) ownerOverride = next.owner;
}

let warnedUnconfigured = false;

/** 返回 `null` = 纯 Node 宿主且尚未注入：本轮跳过（幂等，下一拍还会来），
 *  但留一行——「不注入却安静什么都不领」是最难查的那种死法（规范硬规则 4）。 */
async function resolveDispatch(): Promise<{
  repo: DispatchRepo;
  owner: TaskClaimMode;
} | null> {
  if (repoOverride && ownerOverride) {
    return { repo: repoOverride, owner: ownerOverride };
  }
  try {
    const { taskRepository } = await import("../core/repository");
    return { repo: taskRepository, owner: ownerOverride ?? "inline" };
  } catch (err) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      logger.warn(
        `[comfyui] dispatch 未注入 taskRepo 且 Next barrel 不可达，本轮跳过领取：${errorText(err, "resolveDispatch")}`,
      );
    }
    return null;
  }
}

/** 「WS 未就绪」那条一次性提示的判定目标：库里排在最前的那些行。
 *  领之前先读一眼（只读 id，不改状态）——不这么做就只能把提示打进应用日志，
 *  用户在执行日志面板上看到的仍是长时间静默。 */
const WAIT_HINT_LIMIT = 5;

async function hintWaitingTasks(repo: DispatchRepo, owner: TaskClaimMode) {
  const s = state();
  try {
    const ids = await repo.listQueuedIds(owner, WAIT_HINT_LIMIT);
    for (const id of ids) {
      if (s.wsWaitLogged.has(id)) continue;
      s.wsWaitLogged.add(id);
      logWhileQueued(
        id,
        "warn",
        "⏳ 等待 ComfyUI WebSocket 连接就绪；若 ComfyUI 未运行且已开启自动启动，将自动拉起并在此后继续执行…",
      );
    }
  } catch (err) {
    logger.warn(`[comfyui] ${errorText(err, "等待提示写入失败")}`);
  }
}

/** 一次领取尝试；返回领到并交棒给执行链的 taskId，没领到返回 null。
 *
 * 一个 tick 最多推进一个任务（`MAX_CONCURRENCY=1`）。**不抛**：调用点是定时器与
 * 收口后的续跑，任何异常都要变成「下一拍再来」而不是 unhandled rejection。
 *
 * 顺序即判据，三步都不许调：
 *   1. 就绪门控（WS OPEN）——不就绪就不领行，行留在 `QUEUED`；
 *   2. 槽位（本进程在飞数 < `MAX_CONCURRENCY`）——满了也不领，同样是 `QUEUED`；
 *   3. 领取（单语句原子，见 impl 的 `claimNextQueued`）→ 重建 Job → 提交。
 * 先领后判会把行翻成 `RUNNING` 却什么都不跑，那正是 §14 D1 要消灭的形态。
 *
 * `skipReadyGate` **只**给 `executor-host.mjs --claim-once` 那个契约/排障钩子用：
 * 它要验的是「领取与载荷重建的机械步骤」，而那在不跑真 ComfyUI 的机器上永远
 * 过不了就绪门控。常驻循环与提交后的 kick 都不传它。 */
export async function claimAndDispatchOnce(options?: {
  skipReadyGate?: boolean;
}): Promise<string | null> {
  const s = state();
  const resolved = await resolveDispatch();
  if (!resolved) return null;
  const { repo, owner } = resolved;

  if (!options?.skipReadyGate && s.ws?.readyState !== WebSocket.OPEN) {
    // 就绪前不领行；顺手把拉起 ComfyUI 的触发点带起来（原来挂在入队动作上）。
    // 用 fireAndForget 而不是 `void connect()`：连接内部自己会重试，但「兜底通道
    // 之外还抛出来」的那一条要有名字地落一行 warn，而不是变成 unhandled rejection。
    fireAndForget(connect(), (err: unknown) => {
      logger.warn(
        `[comfyui] ${errorText(err, "就绪探测（连接 ComfyUI）失败")}`,
      );
    });
    await hintWaitingTasks(repo, owner);
    return null;
  }
  if (s.pendingDispatch.size >= MAX_CONCURRENCY) return null;

  let claimed: string[];
  try {
    claimed = await repo.claimNextQueued(owner, 1);
  } catch (err) {
    logger.warn(`[comfyui] ${errorText(err, "领取队列任务失败")}`);
    return null;
  }
  const taskId = claimed[0];
  if (!taskId) return null;

  markDispatched(taskId);
  /* 领到手 = 这一轮的执行起点，原来在 `enqueue()` 里做的四件记账搬到这里（第二刀）：
   *   · `settled` / `finalized` 两把一次性锁要清，否则同一个 taskId 重跑时新的
   *     终态会被上一轮的标记挡住；
   *   · 日志缓冲重开，但**接上本轮排队期写下的行**（`takeQueuedEntries`）。清成空
   *     数组会连带抹掉「⏳ 等待 ComfyUI WebSocket 连接就绪…」，而回收器不再兜底判死
   *     排队行之后（ISSUE #1204），那句是唯一说明「这条在等什么」的出口（#1206）；
   *   · `startedAt` 记时刻，完成时那句「总耗时 Xs」以它为基准（库里另有一列
   *     `claimedAt` 给状态栏用，两者同刻）。 */
  s.settled.delete(taskId);
  clearFinalize(taskId);
  s.logs.set(taskId, takeQueuedEntries(taskId));
  s.startedAt.set(taskId, Date.now());
  log(
    taskId,
    "info",
    `任务已从队列领取（本进程在飞：${s.pendingDispatch.size}/${MAX_CONCURRENCY}）`,
  );

  const row = await repo.findExecJob(taskId);
  if (!row?.execPayload) {
    /* 行没有执行载荷 = 建行异常（或本刀之前的历史 host 行）。判失败并留可见原因，
     * 不许变 RUNNING 僵尸——host 片的 reaper 是这条的兜底，主动收口更快也更准。 */
    log(taskId, "error", "任务缺少执行载荷（execPayload），无法提交给 ComfyUI");
    await repo.finalizeFailure(
      taskId,
      "任务缺少执行载荷（execPayload），无法提交给 ComfyUI",
    );
    releaseDispatchSlot(taskId);
    return taskId;
  }

  const job: Job = {
    taskId,
    workflowName: row.workflowName,
    rawJson: row.execPayload,
    overrides: (row.params as { workflowInputs?: Job["overrides"] })
      ?.workflowInputs,
  };

  /* 完整输入参数入日志（原 `processQueue` 里那条）：任务日志是复现与排障的唯一
   * 现场，本次提交的 workflowInputs 全量进日志，执行面板与历史回放都能看到
   * 当时到底填了什么。 */
  if (job.overrides?.length) {
    log(
      taskId,
      "info",
      `输入参数（workflowInputs，${job.overrides.length} 项）：\n` +
        JSON.stringify(job.overrides, null, 2),
    );
  }

  /* fire-and-forget + `.catch`：`executeViaComfyCli` 若 reject（resolveComfyBase
   * throw、writeFile EACCES、spawn ENOENT…），不兜住就是 unhandled rejection，
   * 而在飞记账会永远占着那个槽（界面表现：任务永远 QUEUED 0%）。 */
  void executeViaComfyCli(job).catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(taskId, "error", `工作流启动异常：${msg}`);
    try {
      await finalizeFailure(taskId, "", msg);
    } catch (inner) {
      /* finalizeFailure 自己也可能抛（数据库挂了）：不再嵌 catch，只归还槽位。
       * 这里**刻意不再立刻领一次**——走到这一支的含义就是「库此刻写不进去」，
       * 在它上面自旋只会把每一次领取都变成一次失败；下一拍（2s 的常驻循环）
       * 再试才是有退避的推进。 */
      log(taskId, "error", errorText(inner, "finalizeFailure 二次失败"));
      releaseDispatchSlot(taskId);
    }
  });

  return taskId;
}

interface DispatchGlobal {
  handle: ReturnType<typeof setInterval> | null;
}

declare global {
  var __comfyDispatch_v1: DispatchGlobal | undefined;
}

const dispatchState: DispatchGlobal = (globalThis.__comfyDispatch_v1 ??= {
  handle: null,
});

/**
 * 起常驻领取循环。**由宿主显式调用**（与 `startReaper()` 同一形态）：Next 侧
 * `src/instrumentation.ts` 一处、host 侧 `scripts/executor-host.mjs` 一处。
 *
 * 幂等：`handle` 已在就直接返回（Next 的 HMR、host 的重复调用都安全）。
 * 节拍是安全网：即时推进靠提交后与收口后的 `kickQueue()`（同一条
 * `claimAndDispatchOnce`），所以这里不需要很快。
 */
export function startDispatchLoop(intervalMs = DISPATCH_TICK_MS): void {
  if (dispatchState.handle) return;
  dispatchState.handle = setInterval(() => {
    fireAndForget(claimAndDispatchOnce(), (err: unknown) => {
      logger.warn(`[comfyui] ${errorText(err, "领取循环异常（下一轮重试）")}`);
    });
  }, intervalMs);
  /* `unref()`：常驻后台职责不该把事件循环吊住（dev server 关停能自然退出）。 */
  dispatchState.handle.unref?.();
}

/** 停循环（测试与关停路径用；生产里没有调用方就不假装需要）。 */
export function stopDispatchLoop(): void {
  if (dispatchState.handle) {
    clearInterval(dispatchState.handle);
    dispatchState.handle = null;
  }
}

/* 把「收口后继续领下一个」注册进叶子总线（唯一注册点，规范 12.7 断环）：
 * 收口侧（finalize / ws）只调 `kickQueue()`，不 import 本模块，依赖方向单向。
 * 放在模块体而不是函数里：注册必须先于任何收口发生。 */
registerQueueKick(() => {
  fireAndForget(claimAndDispatchOnce(), (err: unknown) => {
    logger.warn(
      `[comfyui] ${errorText(err, "续跑领取失败（下一拍由常驻循环再试）")}`,
    );
  });
});

/** 广播给「本归属片里还在 `QUEUED` 的任务」的行数上限。
 *  `MAX_CONCURRENCY=1`，正常情况下一次只有个位数在排队；上限是为了不让一条
 *  坏消息在极端积压下变成 N 次整表写。 */
const ANNOUNCE_LIMIT = 20;

async function announceWaiting(
  msg: string,
  level: LogEntry["level"],
): Promise<void> {
  const resolved = await resolveDispatch();
  if (!resolved) return;
  const ids = await resolved.repo.listQueuedIds(resolved.owner, ANNOUNCE_LIMIT);
  for (const id of ids) logWhileQueued(id, level, msg);
}

/* 同一个叶子总线、第二种注册：通道层（executor-ws）在 ComfyUI 自动启动的每个
 * 节点上要说「你在等什么」，而「谁还在排队」只有本模块知道（内存队列没了之后，
 * 排队的真相在库里）。 */
registerQueueAnnounce(announceWaiting);
