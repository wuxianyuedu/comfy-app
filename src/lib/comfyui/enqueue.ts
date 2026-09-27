// 面向外部的任务操作入口：日志读取 / 取消，服务 ComfyUI 执行器。
//
// 从历史上的单文件 `runner.ts` 拆出。本模块持有 API 路由与编排方用的
// **公开入口**；真正的 WS 执行机制在 executor.ts，孤儿回收在 reaper.ts。
//
// **「把任务交给执行器」不在这个模块了**（P3 §5 ADR §14 D1 的第二刀）：这里曾有
// 一个 `enqueue()`，把 Job 推进进程内存队列并立即尝试出队——那是与 host 的领取
// 循环并存的**第二条**派发路径。现在两个宿主都只走 `executor-dispatch.ts` 那一条
// pull：提交方只写库里的 `QUEUED` 行，谁领由归属分片决定。本模块因此只剩
// 取消与日志两件事（`cancelTask` 仍是取消的唯一出口，§14 D2）。
//
// reaper 的启动也不在本模块：孤儿回收由宿主**显式**起（Next 侧
// `src/instrumentation.ts`、host 侧 `scripts/executor-host.mjs`，判据见
// `tests/reaper-side-effect.test.ts`）。本模块过去以裸副作用 import 顺带把它
// 起来，那条隐式耦合已随 §14 D3 摘掉。

import { interrupt } from "./client";
import { errorText } from "~/lib/error-message";
import {
  state,
  log,
  persistLogs,
  persistRawCli,
  claimFinalize,
  isDispatchedHere,
  releaseDispatchSlot,
} from "./runner-state";
import type { LogEntry } from "./runner-state";
import { cliProcs } from "./executor";
import { kickQueue } from "./executor-continuation";

/* ── 依赖注入接缝（P3 §5 第 1 期·最后一步：让 reaper / enqueue 也能被纯
   Node executor host 加载，不再撞 `../core/repository` 的 server-only throw） ── */

async function loadRealTaskRepo() {
  return (await import("../core/repository")).taskRepository;
}
type TaskRepoForEnqueue = Pick<
  Awaited<ReturnType<typeof loadRealTaskRepo>>,
  "findStatusAndPromptById" | "cancel"
>;

export type EnqueueDeps = { taskRepo: TaskRepoForEnqueue };
let depsOverride: Partial<EnqueueDeps> = {};

/** executor host 在 boot 时注入自带 DB 句柄；Next 侧无需（走下方 dynamic
 *  import 兜底）。 */
export function configureEnqueue(next: Partial<EnqueueDeps>): void {
  depsOverride = { ...depsOverride, ...next };
}

async function resolveTaskRepo(): Promise<TaskRepoForEnqueue> {
  if (depsOverride.taskRepo) return depsOverride.taskRepo;
  return loadRealTaskRepo();
}

export function getLogs(taskId: string): LogEntry[] {
  return state().logs.get(taskId) ?? [];
}

/**
 * 取消一个任务（用户动作的唯一出口，ADR §14 D2）。
 *
 * 「该不该发全局中断」的依据是**本进程是否握着这个任务的在飞子进程**
 * （`cliProcs.has(taskId)`），而不是去问 ComfyUI 的队列：端到端实测过，
 * comfy-cli 提交的 prompt 在整轮执行期间**不出现在** `/queue` 的
 * `queue_running`（真跑 10s，全程 `running=[]`），拿它当判据等于「永远不中断」。
 * 按归属反过来判才是构造性正确的：只有握着子进程的那一侧发全局停，inline 与
 * host 各管各的，天然不会误停对侧正在跑的任务。
 */
export async function cancelTask(taskId: string) {
  // 顶部一次性 resolve：下游 closure 沿用旧名（`taskRepository`），
  // call site 不动。拿不到（未注入 + 纯 Node dynamic import 撞 server-only）
  // → 本函数直接 reject，让 route handler / tRPC caller 感知。
  const taskRepository = await resolveTaskRepo();
  const store = state();
  /* 中断判据必须在 kill **之前**取：下面就把句柄从表里删掉了。 */
  const wasInFlightHere = cliProcs.has(taskId);
  // 先把驱动这个任务的 comfy-cli 子进程杀掉，再翻状态。

  const cliProc = cliProcs.get(taskId);

  if (cliProc) {
    try {
      cliProc.kill("SIGKILL");
    } catch {
      /* ignore */
    }

    cliProcs.delete(taskId);
  }

  const task = await taskRepository.findStatusAndPromptById(taskId);

  if (!task) return;
  /* 以前这里要求 `status === RUNNING || QUEUED`。现在改为接受**任何非终态**的
   * 状态（SUCCEEDED / FAILED / CANCELLED 会在下面被跳过），于是用户能取消掉一个
   * 卡住的 QUEUED 行 —— 哪怕内存态已经被清掉（例如 dev server 重启过、reaper
   * 还没扫到）。任务有 promptId 时仍会调 `interrupt()` 让 ComfyUI 也丢掉它的
   * prompt；没有的话就只把数据库这一行收口。 */

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

    const hadSlot = isDispatchedHere(taskId) || cliProcs.has(taskId);

    if (hadSlot) releaseDispatchSlot(taskId);

    await persistLogs(taskId);
    /* 归还了槽位就再领一次（同一条 pull）；纯数据库行（本进程没在飞）不动槽、
     * 也不 kick，免得白跑一次领取。 */
    if (hadSlot) kickQueue();

    return;
  }

  if (!isTerminal(task.status)) {
    /* 条件性中断（ADR §14 D2）：只有这个任务正由本进程执行时才发全局停。
     * host 名下的在飞任务不在这里发——本进程握不到它的子进程，由 host 自己的
     * tick 在 kill 之后发（`executor-host.mjs` 的 `reconcileCancelled`）。 */
    if (wasInFlightHere) {
      try {
        await interrupt();
        log(taskId, "warn", "已请求 ComfyUI 中断当前这一轮生成");
      } catch (err) {
        /* 中断失败不等于取消失败：状态照收，但要把「这一轮还会跑完」告诉用户，
         * 否则他们看到的就是「按了取消为什么还在出图」却没有任何解释（硬规则 4）。 */
        log(
          taskId,
          "warn",
          `中断请求失败：ComfyUI 会继续跑完当前这一轮（${errorText(err, "interrupt")}）`,
        );
      }
    } else {
      log(
        taskId,
        "info",
        "本进程没有该任务的在飞执行（排队中 / 归另一宿主），不发送全局中断——那会打断其它在飞任务",
      );
    }
  }

  const outcome = await taskRepository.cancel(taskId);
  if (outcome !== "written") {
    /* 守卫挡下来的取消（多数是「已经是终态了」）：内存记账照清，但库里那行
     *  没动，留一行免得事后从日志里查不到为什么状态没变。 */
    log(taskId, "warn", `取消未改写终态（${outcome}），仅清理本进程记账`);
  }

  if (task.promptId) store.promptToTask.delete(task.promptId);

  store.promptByTask.delete(taskId);
  // 清掉本模块给这个任务加的记账，同一个 taskId 再入队时从干净状态开始。

  store.startedAt.delete(taskId);

  store.lastNodeByTask.delete(taskId);
  /* 只有本进程确实握着这一条在飞时才归还槽位。纯数据库行（用户取消了一条
   * 排队中、或归另一宿主的任务）**不能**动本进程的记账——否则下一次领取会以为
   * 有空槽，去领一条其实排在前面的行。判据：要么持有 comfy-cli 子进程，要么
   * 它在本进程的在飞集合里（§14 D1 第二刀，取代原来的「躺在内存队列里」）。 */

  const hadSlot = isDispatchedHere(taskId) || cliProcs.has(taskId);

  if (hadSlot) releaseDispatchSlot(taskId);
  /* 把这个任务还没落盘的防抖日志刷出去：让「用户取消任务」这一行与在途的告警
   * 都先进数据库，再把行标成终态。否则「取消后立刻刷新」会看不到那条取消记录。
   *
   * 这里过去还发过一对合成的「state → error」事件去把画布节点翻成取消：SSE 自
   * 3-C 起只读库（ADR §13-3C），进程内事件通道已整体退役，客户端看到取消的
   * 唯一来源就是上面 `taskRepository.cancel` 落的那个终态行。 */

  await persistLogs(taskId);
  /* 被 kill 的 comfy-cli 在退出前吐的行正是「取消之后发生了什么」的现场，
   * 所以取消这条收口也写一包原文（P3 §5 ADR §14 D1 的 4-B2）。 */
  await persistRawCli(taskId);

  if (hadSlot) kickQueue();
}
