// 面向外部的入队 API：队列 / 订阅 / 日志 / 取消，服务 ComfyUI 执行器。
//
// 从历史上的单文件 `runner.ts` 拆出。本模块持有 API 路由与编排方用的
// **公开入口**；真正的 WS 执行机制在 executor.ts，孤儿回收在 reaper.ts。
//
// reaper 冷启动：import 本模块会以模块副作用的形式带上 `./reaper`，于是任何
// 会入队 / 订阅的服务端都会启动孤儿清扫（QUEUED/RUNNING 对账）。所有需要
// enqueue/subscribe/cancelTask 的 API 与编排方都从这里导入 —— 因此删掉旧的
// `runner.ts` 转发壳也不会让 reaper 掉出启动路径。

import "./reaper"; // module side-effect: launch the reaper sweeps
import { interrupt } from "./client";
import {
  state,
  log,
  persistLogs,
  claimFinalize,
  clearFinalize,
  MAX_CONCURRENCY,
} from "./runner-state";
import type { Job, TaskEvent, LogEntry } from "./runner-state";
import { connect, processQueue, cliProcs } from "./executor";

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

export function enqueue(job: Job) {
  const store = state();

  store.settled.delete(job.taskId);

  /* 同一 taskId 重跑（重试 / 复用）：清掉上一次的「终态已落库」标记，
   *  否则新的终态会被一次性锁挡住，任务永远停在旧状态。 */
  clearFinalize(job.taskId);

  store.queue.push(job);

  if (job.prompt) store.promptByTask.set(job.taskId, job.prompt);

  state().logs.set(job.taskId, []);
  /* 记下开始时间：完成时能打一行「总耗时 Xs」，客户端日志也能据此显示任务
   * 已跑多久，方便排查「卡在 RUNNING」。 */

  store.startedAt.set(job.taskId, Date.now());

  log(job.taskId, "info", "任务已加入执行队列");
  /* 打出队列位置与在跑的并发槽：让用户看出任务是在等前面那个、还是马上就要跑。
   * 如果用户在点「生成」之前就开着日志面板，这就是他最先看到的一行。 */

  log(
    job.taskId,

    "info",

    `队列位置：${store.queue.length} / 活跃槽位：${store.active}/${MAX_CONCURRENCY}`,
  );

  void connect();

  void processQueue();
}

export function subscribe(
  taskId: string,
  cb: (e: TaskEvent) => void,
): () => void {
  const store = state();

  store.emitter.on(taskId, cb);

  return () => store.emitter.off(taskId, cb);
}

export function getLogs(taskId: string): LogEntry[] {
  return state().logs.get(taskId) ?? [];
}

export async function cancelTask(taskId: string) {
  // 顶部一次性 resolve：下游 closure 沿用旧名（`taskRepository`），
  // call site 不动。拿不到（未注入 + 纯 Node dynamic import 撞 server-only）
  // → 本函数直接 reject，让 route handler / tRPC caller 感知。
  const taskRepository = await resolveTaskRepo();
  const store = state();
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

    const hadQueueSlot = store.queue.some((queue) => queue.taskId === taskId);

    if (hadQueueSlot || cliProcs.has(taskId))
      store.active = Math.max(0, store.active - 1);

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
  // 清掉本模块给这个任务加的记账，同一个 taskId 再入队时从干净状态开始。

  store.startedAt.delete(taskId);

  store.lastNodeByTask.delete(taskId);
  /* 只有确实占着并发槽时才归还它。纯数据库任务（内存里没有对应 job）**不能**
   * 递减 `s.active`，否则后续 `processQueue` 会短暂以为有空槽，去入队一个并不
   * 存在的幻影任务。`hadSlot` 的判据是：要么持有 comfy-cli 子进程，要么任务
   * 正躺在内存队列里。 */

  const inQueue = store.queue.some((queue) => queue.taskId === taskId);

  const hadSlot = inQueue || cliProcs.has(taskId);

  if (hadSlot) store.active = Math.max(0, store.active - 1);
  /* 以前取消只改数据库与内存槽，从不往 SSE 推送 —— 于是前端的 d.status 永远停在
   * "running"，「生成中…」按钮再也不回来。现在发一个合成的 state 事件，让画布的
   * patch() 把节点翻成 error；再发一个终态 error 事件，让 EventSource 的
   * onmessage 处理器关掉连接（与 finalizeFailure 里的做法一致）。顺序要紧：
   * 先 state（修 UI），后 error（关连接）。 */

  store.emitter.emit(taskId, {
    type: "state",

    status: "CANCELLED",

    progress: 0,

    error: "用户取消",

    validationErrors: [],
  });

  store.emitter.emit(taskId, { type: "error", error: "用户取消" });
  /* 把这个任务还没落盘的防抖日志刷出去：让「用户取消任务」这一行与在途的告警
   * 都先进数据库，再把行标成终态。否则「取消后立刻刷新」会看不到那条取消记录。 */

  await persistLogs(taskId);

  if (hadSlot) void processQueue();
}
