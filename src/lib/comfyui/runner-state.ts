// // comfyui 执行层内部共享状态 + 日志落盘。

//

// // 由历史单文件 `runner.ts` 拆分而来（拆成 enqueue / executor / reaper）。

// // 本模块持有那几个子模块共享的**单例运行时状态**与**日志基建**。

// // RunnerState 类型族与不含 IO 的初始化工厂在 `./runner-state-shape.ts`；

// // 宿主依赖（taskRepository / logger）经 `configureRunner` 注入，未注入时首次

// // `persistLogs` lazy 走 Next 侧的动态 import（见下方 `resolveDeps`）。

// // 它**不是**对外 API —— 外部代码请从 enqueue.ts 取公开入口。

// //

// // **§18.4 三选一：本模块走第三类（纯 Node 宿主，不加 server-only / 不加 .server.ts）**。
// // P3 executor host 迁移第 1 期·第三步：整条 ComfyUI 执行链从 Next 专属耦合里解绑。
// // `scripts/executor-host.mjs`（纯 Node 宿主）与 Next server 双宿主加载本模块；
// // 一旦给它加 `server-only`，纯 Node 侧的 import 就是一句 `throw`——正是硬规则
// // 「纯 Node 宿主两者都不加」的原型（同 `src/lib/process/kill-process-tree.ts`）。
// // 进程内事件通道（emitter）随 P3 §5 ADR §14 D1 退役后，本模块顶层不再 import
// // 任何 Node 内建值，于是 scanner 视角它不再落进 `unguarded`、`PURE_NODE_HOSTS`
// // 那条登记也随之删掉——**但「不许带 `server-only`」这条约束一字未变**，改带
// // 之后 host 侧 `bootRuntime()` 的注入链会在加载本模块时直接 throw。

// //

// // 模块边界见 docs/standards/18-lib层规范.md。

//

import { errorText } from "~/lib/error-message";
import { fireAndForget } from "~/lib/async-action";
import { HISTORY_READ } from "../retry-policy";
import { lastSegments } from "~/lib/path-display";
import { createEmptyState, type LogEntry, type RunnerState } from "./runner-state-shape";

export const CLIENT_ID = process.env.COMFY_CLIENT_ID ?? "comfy-app-web";

export const MAX_CONCURRENCY = 1; // single GPU — serial execution

export const JOB_TIMEOUT_MS = 5 * 60 * 1000;

/** ComfyUI 先发 `executing:null` / `execution_success`，随后才把结果写进 history。

 *  直接读会拿到空，必须轮询几轮。

 *  取值走 `~/lib/retry-policy` 的 {@link HISTORY_READ}（**固定间隔 + 有界次数**：
 *  对端一定就绪、只是慢一拍，指数退避只会让它更晚拿到结果 —— 见 §16.2.4.49）。 */

export const HISTORY_RETRIES = HISTORY_READ.maxAttempts;

export const HISTORY_RETRY_DELAY_MS = HISTORY_READ.baseMs;

/* WS 断线重连的退避参数（基数 / 封顶 / `2 ** attempt` 的夹取）**已整体搬到
 * `~/lib/retry-policy` 的 WS_RECONNECT** —— `executor-ws` 的 `scheduleReconnect`
 * 直接 `backoffDelayMs({ ...WS_RECONNECT, attempt })`，因此这里不再各留一个
 * 「转发常量」：那只会让「重试策略有几处定义」这件事又多一处看不出消费方的
 * 中转（`check-dead-exports` 正是这么抓出来的，见 §16.2.4.49）。 */

/**

 * ComfyUI 的 WS 端点路径随版本变化：

 *   - 现代版本（v0.20+）：`/api/ws?clientId=...`

 *   - 旧版本：`/ws?clientId=...`（访问 `/api/ws` 会 404）

 * 连接阶段失败时按此顺序逐条回退，避免「能提交但收不到事件」。

 */

export const WS_PATHS = ["/api/ws", "/ws"];

/* 类型族与「不含 IO 的初始化工厂」在 `./runner-state-shape.ts`；这里保留同名
 * 再导出，让 enqueue / reaper / executor-* / queue-status / SSE 路由等既有消费方
 * 保持原样的 `from "./runner-state"` 入口（零 import-graph 变化，见 P3 方案第 1 期）。 */
export type { Job, LogEntry, RawWorkflowOverride, RunnerState } from "./runner-state-shape";

/* 名字里带版本：**给 `RunnerState` 加字段时必须一起升版**。`??=` 只认键名，
 *  旧单例不会被补全，热重载后新字段就是 `undefined`——读它是 TypeError，写判据的
 *  地方则静默失效（`pendingDispatch` 与 `queuedEntries` 都是加过字段没升版的实例）。 */
declare global {
  var comfyRunner_v3: RunnerState | undefined;
}

export function state(): RunnerState {
  /* 单例里不再有 EventEmitter：进程内事件通道已随 ADR §14 D1 退役，执行进度的
   * 对外通道只剩 DB 行 + `/api/tasks/[id]/stream` 的轮询（§13-3C 单源化）。 */
  globalThis.comfyRunner_v3 ??= createEmptyState();

  return globalThis.comfyRunner_v3;
}

function callerLoc(): string {
  try {
    const stack = new Error().stack;

    if (stack === undefined) {
      return "";
    }

    const lines = stack.split("\n");

    // 栈的形状：lines[0] 是 "Error"，lines[1] 是 " at log (…)"，lines[2] 才是真正的调用方。

    // oxlint-disable-next-line typescript/prefer-nullish-coalescing
    const frame = lines[2] || lines[1] || "";

    const match = /\((?<file>[^():]+):(?<line>\d+):(?<col>\d+)\)/.exec(frame);

    if (match) {
      const file = lastSegments(match.groups?.file, 1) || match.groups?.file;

      return `${file}:${match.groups?.line}`;
    }

    const m2 = /at\s+(?<file>\S+):(?<line>\d+):(?<col>\d+)/.exec(frame);

    if (m2) {
      const file = lastSegments(m2.groups?.file, 1) || m2.groups?.file;

      return `${file}:${m2.groups?.line}`;
    }

    return "";
  } catch {
    return "";
  }
}

// 追加一条结构化日志：留内存 + 防抖落库，

// 让 SSE 重放能覆盖全部内容。

//

// 原先的 `log()` 只推到内存的 `s.logs` 与 EventEmitter，

// 而 `persistLogs()` 只在终结点（complete / finalizeFailure）被调用。

// 于是「前端打开 EventSource 之前发出的日志」全都不可见

// （EventSource 只在 /api/generate 返回 taskId、

// 前端把 d.taskId 补上之后才会打开）：

// 那些 emit 落在没有订阅者的时刻，

// SSE 首次回放 `Task.logs` 又只拿到空数组。

// 面板上的表现是：「📡 已订阅」之后长时间静默，

// 用户看不出执行器在干什么。

//

// 修法：每条日志都落库，但用 200ms 防抖合并写入 ——

// 高频突发（执行期间的按节点 ▶/✔ 成对日志）因此收敛成约 1 次写，

// 而不是每条一次。另有 1500ms 保底刷盘，

// 保证持续输出时不会把数据库写饿。

/* 内存态按任务留存的缓冲必须有上限（规范 §2.1「列表/日志必须有上限」）。
 * 两个维度缺一不可：
 *  - `LOGS_MAX_LINES`：单个任务的行数，超出丢最旧的（保留最新一段）；
 *  - `LOGS_MAX_TASKS`：同时驻留的任务数，超出按「最久没写过」淘汰。
 * 只限行数，Map 的键仍随执行过的任务数单调增长；只限任务数，一个失控任务
 * 照样能把内存撑爆。淘汰不丢数据：**还有 pending 落库定时器的任务不淘汰**
 * （见下方 `touchAndEvict` 的 `skip`，#4021），日志必然先落库再退出驻留；
 * SSE 回放读不到内存时会回落 DB 列（见 stream route 的 `replaySrc`）。 */
export const LOGS_MAX_LINES = 5000;

export const LOGS_MAX_TASKS = 64;

// 每个 taskId 一个防抖落库器。一个任务最多只有一次待写；

// 防抖窗口内后续的 `log()` 调用会重置计时器。

// 「最长延迟」看门狗保证持续输出（例如按节点 ▶/✔ 的突发）

// 仍能在约 1.5s 内落库，SSE 重放因此能及时拿到。

// （每条都写会把数据库写爆，所以必须合并。）

const PERSIST_DEBOUNCE_MS = 200;

const PERSIST_MAX_DELAY_MS = 1500;

const persistTimers = new Map<
  string,
  {
    debounce: ReturnType<typeof setTimeout>;
    maxDelay: ReturnType<typeof setTimeout>;
  }
>();

/** 已追加进 `taskLog` 表的最大行号（按任务记）：增量落库只取「此游标之后」的行，
 *  这是取代整包重写的游标本体（#4605）。任务缓冲被淘汰后随之清除——游标丢了
 *  也不会重写已落库的行，最坏多追加一次缓冲里剩下的行。 */
const appendedSeqByTask = new Map<string, number>();

/** 每任务的下一个日志行号。与 `appendedSeqByTask` 刻意分开：重跑清场删的是
 *  已落库的行，行号**不回退**（新轮次从旧值之后继续编），SSE 游标按 seq 比大小
 *  因此跨轮次单调，不会把新轮日志误判成「已发送」。
 *  有界（ISSUE #4731 / #3850）：LRU 封顶（`LOG_SEQ_MAX_TASKS`），覆盖全部驻留
 *  日志缓冲（`LOGS_MAX_TASKS`=64）之外再留一段最近结束任务的行号——这些任务
 *  「原样重跑」时行号跨轮次继续单调；被挤出 LRU 的极老任务重跑则从 1 重新编
 *  （那一轮的 SSE 增量与 taskLog 增量退化，`task.logs` 整包列在收口点仍完整）。 */
const logSeqByTask = new Map<string, number>();

/** 行号账本的 LRU 容量（ISSUE #4731 / #3850）：见 `logSeqByTask` 的注释。 */
const LOG_SEQ_MAX_TASKS = 512;

/** 写入并把该任务标记为「最近使用」，再淘汰超出 `maxTasks` 的最久未用项。
 *  Map 的迭代序是插入序、对已存在的键 `set` 不改变位置 —— 所以标记最近
 *  使用要 delete 后再 set，淘汰时取迭代器的第一个键即得最旧项。
 *
 *  `skip`：命中即**跳过本轮淘汰**（#4021）。日志 Map 传「还有 pending 落库
 *  定时器」——缓冲被淘汰后，那些行再也没有机会增量落库（游标清了、内存没了），
 *  等于把已发生的日志从库里漏掉；「日志已落库才可淘汰」这条不变式靠它守住。
 *  全部键都被 skip 时允许暂时超限（ bounded：最迟 1.5s 的兜底 flush 后回落）。
 *
 *  同一形态的第二处消费（ISSUE #4351）：`executor-dispatch` 的 `wsWaitLogged`
 *  提示去重表也用它封顶。新需求要「有界去重 / 驻留」时直接复用本函数，
 *  别再抄第四份淘汰循环（此前 instrumentation 与画布各有一份同形内联）。 */
export function touchAndEvict<V>(
  map: Map<string, V>,
  taskId: string,
  value: V,
  maxTasks: number,
  skip?: (taskId: string) => boolean,
): void {
  map.delete(taskId);
  map.set(taskId, value);
  while (map.size > maxTasks) {
    let oldest: string | undefined;
    for (const key of map.keys()) {
      if (skip?.(key) !== true) {
        oldest = key;
        break;
      }
    }
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
}

export function log(taskId: string, level: LogEntry["level"], msg: string): LogEntry {
  const store = state();

  const entry: LogEntry = { t: Date.now(), level, msg, src: callerLoc() };

  /* 行号在写日志那一刻定死：增量落库（appendLogs）与 SSE 增量游标都按它比大小。
   * 计数跨轮次单调（重跑清场只删行、不回退计数），见 logSeqByTask 的注释。 */
  const seq = (logSeqByTask.get(taskId) ?? 0) + 1;
  touchAndEvict(logSeqByTask, taskId, seq, LOG_SEQ_MAX_TASKS);
  entry.seq = seq;

  const arr = store.logs.get(taskId) ?? [];

  arr.push(entry);

  if (arr.length > LOGS_MAX_LINES) {
    arr.splice(0, arr.length - LOGS_MAX_LINES);
  }

  /* 淘汰跳过「还有 pending 落库」的任务（#4021）：先落库、再淘汰，顺序不能反。 */
  touchAndEvict(store.logs, taskId, arr, LOGS_MAX_TASKS, (id) => persistTimers.has(id));

  schedulePersistLogs(taskId);

  return entry;
}

/** 排队期一行写入量的上限：等待原因只有几种固定句式，超了就是异常，不再攒。 */
const QUEUED_KEEP_MAX = 8;

/** 记一行**排队期**日志，并把它登记为「本轮领取时要保留的行」。
 *
 *  为什么要有这个：`claimAndDispatchOnce()` 领到行会重开缓冲（原意是「重跑不混
 *  上一轮的尾巴」），那连带抹掉了本轮刚写下的「⏳ 等待 ComfyUI WebSocket 连接
 *  就绪…」——而回收器不再兜底判死排队行之后（ISSUE #1204），那句是用户唯一能
 *  看到「这条在等什么」的地方（ISSUE #1206）。边界不能整体挪到收口：收口之后
 *  还会再打「✓ 全部完成」这类行，先删缓冲会让这些行失去落库机会（增量追加只认
 *  缓冲里还在线的行，#4605）。所以只把「排队期的行」单独保住。 */
export function logWhileQueued(taskId: string, level: LogEntry["level"], msg: string): void {
  const store = state();
  const kept = store.queuedEntries.get(taskId) ?? [];
  kept.push(log(taskId, level, msg));
  if (kept.length > QUEUED_KEEP_MAX) {
    kept.splice(0, kept.length - QUEUED_KEEP_MAX);
  }
  store.queuedEntries.set(taskId, kept);
  /* 有界：JS Map 的迭代顺序=插入顺序，超量时淘汰最早登记的 taskId（这些行已经
   * 落过一次库，丢的只是「领取时保留」这份冗余，不是现场）。 */
  if (store.queuedEntries.size > LOGS_MAX_TASKS) {
    const oldest = store.queuedEntries.keys().next().value;
    if (oldest !== undefined) {
      store.queuedEntries.delete(oldest);
    }
  }
}

/** 领取时取回本轮排队期写下的行，并结束这份登记（一个 taskId 只用一次）。 */
export function takeQueuedEntries(taskId: string): Array<LogEntry> {
  const store = state();
  const kept = store.queuedEntries.get(taskId) ?? [];
  store.queuedEntries.delete(taskId);
  return kept;
}

/** 取消某个任务的「日志落库」防抖定时器（若存在）。
 *
 *  为什么公共 API 需要它：`schedulePersistLogs` 排的是**游离定时器** —— 它不属于
 *  任何组件生命周期，也不随任务结束自动消失。测试里清空内存 state 之后，
 *  上一次排的定时器仍会在 200ms / 1500ms 后触发 `persistLogs`，打到
 *  **已经被 `vi.mock` 换掉或已随用例撤销的 repository** 上
 *  （实测形态：`TypeError: taskRepository.replaceLogs is not a function`，
 *  以 Unhandled Rejection 浮出、让 `pnpm test` 随机非零退出，而用例层面全绿，
 *  报错点名的文件是当时恰好在跑的那个）。ISSUE #489。
 *
 *  生产语义同理：任务被丢弃 / 重跑时先把上一次的落库排期掐掉——重跑的清场走
 *  `resetLogsForRerun`（删上一轮增量行）；排期若还挂着，会把上一轮的尾巴追加进
 *  新一轮（#4605 增量语义下同样是「混尾巴」，只是形态从覆盖变成掺入）。 */
export function cancelPersistLogs(taskId: string): void {
  const pending = persistTimers.get(taskId);

  if (!pending) {
    return;
  }

  clearTimeout(pending.debounce);

  clearTimeout(pending.maxDelay);

  persistTimers.delete(taskId);
}

/* 防抖/看门狗定时器回调里的最后兜底（#4221）：persistLogs 的双重失败（落库失败 +
 * logger 也起不来）会 re-throw。`await persistLogs(...)` 的调用方自己接那个 throw；
 * 这三个定时器回调原本写的是 `void persistLogs(...)`——没人接，rejection 直接走
 * unhandledRejection，Node ≥15 默认即退出整个进程。这里显式接住：logger 既已不可用，
 * stderr 是两宿主（Next / executor host）都被启动链捕获落日志的最后通道；语义从
 * 「意外崩进程」改为「响亮留痕 + 继续跑」。 */
function onPersistLogsFailure(error: unknown): void {
  process.stderr.write(
    `[comfyui] persistLogs 双重失败（落库与 logger 均不可用）：${errorText(error, "unknown")}\n`,
  );
}

export function schedulePersistLogs(taskId: string) {
  if (!taskId) {
    return;
  }

  const existing = persistTimers.get(taskId);

  if (existing) {
    // 只重置防抖计时器；最长延迟看门狗继续保持武装。

    clearTimeout(existing.debounce);

    existing.debounce = setTimeout(() => {
      const cur = persistTimers.get(taskId);

      if (cur) {
        clearTimeout(cur.maxDelay);

        persistTimers.delete(taskId);
      }

      fireAndForget(flushLogsDelta(taskId), onPersistLogsFailure);
    }, PERSIST_DEBOUNCE_MS);

    return;
  }

  const debounce = setTimeout(() => {
    const cur = persistTimers.get(taskId);

    if (cur) {
      clearTimeout(cur.maxDelay);

      persistTimers.delete(taskId);
    }

    fireAndForget(persistLogs(taskId), onPersistLogsFailure);
  }, PERSIST_DEBOUNCE_MS);

  const maxDelay = setTimeout(() => {
    const cur = persistTimers.get(taskId);

    if (cur) {
      clearTimeout(cur.debounce);

      persistTimers.delete(taskId);
    }

    fireAndForget(persistLogs(taskId), onPersistLogsFailure);
  }, PERSIST_MAX_DELAY_MS);

  persistTimers.set(taskId, { debounce, maxDelay });
}

/** 终态去重标记的有界保留上限（ISSUE #3961 / #3850）：`settled`/`finalized` 只需
 *  挡住同一任务在“可见时间窗”内的重复收口；终态落库后 DB 自身也有终态守卫。
 *  无上限会让已完成 taskId 在长生命周期进程中单调增长，这里按插入序淘汰最旧项。 */
const TERMINAL_MARK_MAX = 4096;

function rememberTerminalMark(set: Set<string>, taskId: string): void {
  if (set.has(taskId)) {
    set.delete(taskId);
  }
  set.add(taskId);
  while (set.size > TERMINAL_MARK_MAX) {
    const oldest = set.values().next().value;
    if (oldest === undefined) {
      break;
    }
    set.delete(oldest);
  }
}

/**
 * 抢占任务的终态。
 *
 * 返回 true 表示本次调用赢得了收口权（并已停掉超时定时器）；返回 false 表示
 * 别处已经把任务结算过了，调用方应直接退出。
 *
 * ⚠️ 历史坑：complete() 曾在入口就 `settled.add`，随后它内部的失败分支再调
 * fail()，而 fail() 第一行就是 `if (settled.has) return` —— 直接空转。结果
 * 是任务永远停在 RUNNING、`active` 不回落、MAX_CONCURRENCY=1 的队列被彻底
 * 堵死，只能重启进程。所以失败收口一律走 finalizeFailure()，不再经过 fail()。
 */
export function claimSettle(taskId: string): boolean {
  const s = state();
  if (s.settled.has(taskId)) {
    return false;
  }
  rememberTerminalMark(s.settled, taskId);
  const t = s.timers.get(taskId);
  if (t) {
    clearTimeout(t);
  }
  s.timers.delete(taskId);
  return true;
}

/** 尝试认领「DB 终态写入」这一次性权利。首个调用者返回 true（应落库），
 *  其余（含 reaper 与 executor 并发收口同一任务）返回 false（必须跳过）。
 *  语义与 `claimSettle` 平行，但锁的是「DB 终态」而不是「收口流程」。 */
export function claimFinalize(taskId: string): boolean {
  const s = state();
  if (s.finalized.has(taskId)) {
    return false;
  }
  rememberTerminalMark(s.finalized, taskId);
  return true;
}

/** 任务被重新入队（同一个 taskId 重跑）时清掉上一次的收口标记，
 *  否则第二次执行会被这把一次性锁误判为「已落库」而静默丢失终态。 */
export function clearFinalize(taskId: string): void {
  state().finalized.delete(taskId);
}

/* ── 「取消中」标记（ISSUE #4800） ──
 * 取消要杀本进程握着的 comfy-cli，而被杀进程的退出码非 0、也不再回 envelope，
 * 进程退出收口凭退出码分不清「崩溃」与「被取消杀掉」。这个标记由 cancelTask
 * 在**杀进程之前**挂上、结束时（含提前返回）摘掉；executor-cli 的 close 处理器
 * 与看门狗见到它就不写失败终态，把终态让给取消路径的 CANCELLED。 */

/** 取消路径在杀进程前调用：声明「这个任务的退出是取消造成的」。 */
export function markCancelling(taskId: string): void {
  state().cancelling.add(taskId);
}

/** 进程退出收口（close / 看门狗）读：本任务是否正被本进程取消。 */
export function isCancellingHere(taskId: string): boolean {
  return state().cancelling.has(taskId);
}

/** 取消收口结束（终态已落库或确认无需落库）后摘标记；同一个 taskId 重跑时
 *  不让上一轮的标记吞掉这一轮真实的失败。 */
export function clearCancelling(taskId: string): void {
  state().cancelling.delete(taskId);
}

/* ── 在飞记账（P3 §5 ADR §14 D1 的第二刀：内存队列 `queue` + 计数器 `active` 的替身） ──
 *
 * 领取成功即 `markDispatched`，收口（成功 / 失败 / 取消 / 被回收）时
 * `releaseDispatchSlot`。三个读它的地方必须是同一份判据：
 *   · 并发槽位（`MAX_CONCURRENCY`）——决定这一拍还领不领；
 *   · reaper 的进程内认领检查——决定这一行是不是孤儿；
 *   · 取消路径——决定要不要归还槽位。
 * 用 Set 而不是计数：计数答不了「这一条是不是我的」，而孤儿判决要的正是后者。 */

/** 记下一条「本进程已领走、尚未收口」的任务。 */
export function markDispatched(taskId: string): void {
  state().pendingDispatch.add(taskId);
}

/** 归还槽位（幂等：没记过就是 no-op，重复调用也不会把别人的槽减掉）。 */
export function releaseDispatchSlot(taskId: string): void {
  state().pendingDispatch.delete(taskId);
}

/** 本进程是否正握着这一条在飞（reaper 与取消路径的判据入口）。 */
export function isDispatchedHere(taskId: string): boolean {
  return state().pendingDispatch.has(taskId);
}

/**
 * 摘掉「本进程还在执行这一行」的**全部**内存足迹（ISSUE #1250）。
 *
 * 为什么必须一次摘干净，而不是「归还槽位」就够了：`reaper.ts` 的
 * `isTaskClaimedInProcess` 读的是四样（`pendingDispatch` / comfy-cli 子进程 /
 * `executedWorkflow` / `settled`），**任何一样还留着，回收器就认为这一行有人管**，
 * 每 30s 只打一句 `checked` 而永不动作。桌包实演量到过一次：终态写穷尽后只归还了
 * 槽位，那一行在 `RUNNING` 上停了 11 分钟、22 轮回收全部空转 —— 因为 `fail()` 在
 * `writeTerminal` 抛出后就没走到那几行 `delete`。
 *
 * 键表与原来两处手工清理逐字一致（成功分支与失败分支各抄一份 = 第四份副本，
 * 这里收成唯一出口）：**不动** `settled` / `finalized`（正常收口成功后仍要它们挡住
 * 二次写库，语义见 {@link claimSettle} / {@link claimFinalize}），也**不动**
 * comfy-cli 子进程句柄（那是 `executor-cli` 的 `cliProcs`，杀进程才是它的清理）。
 */
export function forgetTaskFootprint(taskId: string, promptId?: string): void {
  const s = state();
  s.pendingDispatch.delete(taskId);
  s.executedWorkflow.delete(taskId);
  s.startedAt.delete(taskId);
  s.lastNodeByTask.delete(taskId);
  s.lastLogPct.delete(taskId);
  /* 手里有 promptId 就按它删（调用点那一格），再整表反查一遍兜底：
   * 本进程同时在飞最多 1 条（MAX_CONCURRENCY），扫不出性能问题，
   * 却能保证「摘干净」这句话没有例外 —— 传空串的那些路径（提交前就崩）靠的就是反查。 */
  if (promptId !== undefined && promptId !== "" && s.promptToTask.get(promptId) === taskId) {
    s.promptToTask.delete(promptId);
  }
  for (const [known, owner] of s.promptToTask) {
    if (owner === taskId) {
      s.promptToTask.delete(known);
    }
  }
}

/**
 * 终态那一次写**没落库**时的自处：足迹与两把一次性锁一起丢掉。
 *
 * 与 {@link forgetTaskFootprint} 的差别只在最后一句：库里的行仍然是 `RUNNING`，
 * 本进程对它的「已认领终态」「已落终态」两个主张都成了谎 —— 留着它们，回收器的
 * `claimTerminal` 会被自己的旧记账挡死，那一行就再没有人判。清掉之后接管成立，
 * 而重复写库仍有库里那道 CAS（`status not in (SUCCEEDED, FAILED, CANCELLED)`）兜着。
 */
export function forgetTaskClaimEntirely(taskId: string): void {
  const s = state();
  forgetTaskFootprint(taskId);
  s.settled.delete(taskId);
  s.finalized.delete(taskId);
}

/**
 * runner-state 的**宿主依赖注入接缝**（P3 迁移第 1 期·第二/三步）。
 *
 * 现状：本模块只剩两处真 IO —— `persistLogsCore` 里的增量 `appendLogs` 与收口时
 * `replaceLogs` 的整包列写，加失败分支的 `logger.warn`。这两条在**加载时**会牵进 `server-only` 链（repository
 * 与 logger 各自带 `import "server-only"`），把整个 runner-state 拖回 Next 专属
 * 上下文；纯 Node 宿主（未来的 `scripts/executor-host.mjs`）动态加载本模块时会撞
 * `server-only` 的入口 throw。P3 §5 第 3 步「摘 server-only」卡在这两条静态值
 * import 上。
 *
 * 解法：deps 不再**静态初始化**，改为**首次 persistLogs 时 lazy 解析**：
 *   1. 若外部先 `configureRunner({ taskRepo, log })` 注入了（executor host 走这条），
 *      `resolveDeps` 直接返回；
 *   2. 否则 dynamic `import()` 拉 Next 侧的 taskRepository / logger 填默认
 *      （Next server 走这条；scanner 的 parseImports 只识别静态 import 语句、
 *      不识别 `import()` 表达式，因此 `libOnlyReachable` 与 `clientReachable`
 *      两条判据都不会看见这条边）。
 *
 * 类型刻意写成**结构最小**（只 `replaceLogs` / `warn` 两个方法），未来宿主不用
 * 背整个 `taskRepository` 或 pino 的全部面。
 */
export type RunnerDeps = {
  log: {
    warn(msg: string): void;
  };
  taskRepo: {
    /** 日志增量追加（#4605）：只交「游标之后」的新行，不再整包重写。 */
    appendLogs(taskId: string, entries: Array<LogEntry>): Promise<void>;
    replaceLogs(taskId: string, entries: Array<LogEntry>): Promise<void>;
    /** comfy-cli 完整原文整包落库（P3 §5 ADR §14 D1 的 4-B2）：「查看完整输出」
     *  这个排障入口此前只有执行进程自己看得见。 */
    replaceRawCli(taskId: string, lines: Array<string>): Promise<void>;
    /** 重跑清场：删掉上一轮落在 `taskLog` 表里的行（与内存缓冲的领取重开同口径）。 */
    resetLogs(taskId: string): Promise<void>;
  };
};

let deps: Partial<RunnerDeps> | null = null;

/** 覆盖 runner-state 的宿主依赖（executor host 用它注入自带 DB / 日志通道）。
 *  传 `Partial`：允许只覆盖一侧，另一侧留给 `resolveDeps` 的 lazy 默认填。 */
export function configureRunner(next: Partial<RunnerDeps>): void {
  deps = { ...deps, ...next };
}

/** `deps` 的两条边分别补齐：
 *  - 若 `configureRunner` 全给了（两条都在），本函数无副作用地返回。
 *  - 若只给了一侧（甚至完全没给），剩下那条走 Next 侧的 dynamic import——
 *    在纯 Node 下这一句会撞 `server-only` throw，这是**故意的**：宿主必须
 *    先 `configureRunner` 注入自己的 DB / 日志通道，才会走到 persistLogs。
 *    错误信息里点出「configureRunner」这条契约。 */
async function resolveDeps(): Promise<RunnerDeps> {
  const cur: Partial<RunnerDeps> = deps ?? {};
  const taskRepo: RunnerDeps["taskRepo"] =
    cur.taskRepo ?? (await import("../core/repository")).taskRepository;
  const log: RunnerDeps["log"] = cur.log ?? (await import("~/lib/core/logger")).logger;
  deps = { taskRepo, log };
  return { taskRepo, log };
}

/** 取「此游标之后」的未落库增量。内存视图有 5000 行封顶（丢最旧），游标按
 *  「已落库的最大 seq」记账、与数组位置无关 —— 封顶截断不影响增量判定。 */
function takeUnpersistedLogs(taskId: string): Array<LogEntry> {
  const arr = state().logs.get(taskId) ?? [];
  const appended = appendedSeqByTask.get(taskId) ?? 0;
  const delta: Array<LogEntry> = [];
  for (const entry of arr) {
    if ((entry.seq ?? 0) > appended) {
      delta.push(entry);
    }
  }
  return delta;
}

/**
 * 日志落库的唯一实现（#4605 拆成两档）：
 *
 *   · `flushLogsDelta`（防抖/看门狗定时器走这档）—— 只把「游标之后」的增量行
 *     `appendLogs` 进 `taskLog` 表。单次写入与防抖窗口内的增量成正比，不再把
 *     最多 5000 行的 JSON 列整包重写一遍（那是长任务高频日志期 SQLITE_BUSY
 *     写放大与 MB 级序列化的主要来源）。
 *   · `persistLogs`（收口点走这档：成功 / 失败 / 取消 / reaper 回收）—— 先补齐
 *     增量，再把内存视图**整包**写一次 `task.logs` 列。列是「完整记录」的权威
 * 面（历史查看、无增量行的旧任务回放都读它），每轮只在此刻写一次。
 *
 * 防抖写与终结点的 `await persistLogs(...)` 会竞争：进到这里先取消防抖计时器，
 * 让最终这次同步刷盘成为该任务**唯一**的在途写入。
 *
 * 落库失败不向外抛（理由与旧行为一致）：定时器回调那几处经 fireAndForget 接到
 * `onPersistLogsFailure`（stderr 最后通道，#4221）；`await persistLogs(...)`
 * 的收口方（enqueue / executor-finalize / reaper）若被这里抛错会整段回滚，
 * 比漏一份日志严重。日志的**内存视图**仍完整，真故障经 `log.warn` 落
 * app-runtime.log 镜像通道。`resolveDeps` 自身也可能抛（宿主忘 configureRunner
 * → dynamic import 撞 server-only），同样进 catch 走 warn 兜底。
 */
async function persistLogsCore(taskId: string, writeColumn: boolean): Promise<void> {
  const pending = persistTimers.get(taskId);

  if (pending) {
    clearTimeout(pending.debounce);

    clearTimeout(pending.maxDelay);

    persistTimers.delete(taskId);
  }

  try {
    const { taskRepo } = await resolveDeps();

    const delta = takeUnpersistedLogs(taskId);

    if (delta.length > 0) {
      await taskRepo.appendLogs(taskId, delta);

      const lastSeq = delta.at(-1)?.seq ?? 0;

      if (lastSeq > (appendedSeqByTask.get(taskId) ?? 0)) {
        appendedSeqByTask.set(taskId, lastSeq);
      }
    }

    if (writeColumn) {
      const arr = state().logs.get(taskId) ?? [];

      await taskRepo.replaceLogs(taskId, arr);
    }

    /* 缓冲已被 LRU 淘汰（本轮落库是它最后的机会）且已全部落库：游标随之清掉，
     * 不给长生命周期进程留单调增长的死角。行号计数保留——跨轮次单调的依据。 */
    if (!state().logs.has(taskId)) {
      appendedSeqByTask.delete(taskId);
    }
  } catch (error) {
    const message = `[comfyui] persistLogs(${taskId}) 落库失败：${errorText(error, "unknown")}`;
    // 兜底 warn：若 resolveDeps 已经拉起了 log，走注入侧；否则再试一次 dynamic
    // import。这一句本身在纯 Node + 未 configure 的失败路径下也会抛（server-only），
    // 但那时上面 catch 里已经没有别的兜底手段可依赖了（logger 都没起来），
    // 抛回 caller 的 `void persistLogs` 会走 unhandledRejection —— 那种状态下
    // executor host 的入口就该主动 exit，不靠这里做二次容错。
    try {
      const { log } = await resolveDeps();
      log.warn(message);
    } catch {
      throw error;
    }
  }
}

/** 防抖/看门狗定时器的落库动作：只追加增量行，不碰 `task.logs` 列。 */
export function flushLogsDelta(taskId: string): Promise<void> {
  return persistLogsCore(taskId, false);
}

/** 收口点的日志落库：补齐增量 + `task.logs` 列整包写一次（完整记录面）。 */
export async function persistLogs(taskId: string): Promise<void> {
  return persistLogsCore(taskId, true);
}

/**
 * 重跑清场的日志侧（#4605）：同一任务行再次领取时，删掉上一轮落在 `taskLog`
 * 表里的行、清掉追加游标 —— 与内存缓冲的「领取重开」同一口径（重跑不混上一轮
 * 的尾巴）。行号计数刻意不清（见 `logSeqByTask`）：新轮次的行从旧值之后继续
 * 编号，SSE 游标跨轮次单调。
 *
 * 失败吞掉只 warn：清场失败的表现是旧轮次行还留在表里，内存优先的回放与
 * 按游标的增量读都不会把它们重放给用户，比把领取链路整段回滚轻。
 */
export async function resetLogsForRerun(taskId: string): Promise<void> {
  appendedSeqByTask.delete(taskId);

  try {
    const { taskRepo } = await resolveDeps();

    await taskRepo.resetLogs(taskId);
  } catch (error) {
    const message = `[comfyui] resetLogsForRerun(${taskId}) 清场失败：${errorText(error, "unknown")}`;
    try {
      const { log } = await resolveDeps();
      log.warn(message);
    } catch {
      throw error;
    }
  }
}

/* comfy-cli 完整原始输出缓冲（详见 RunnerState.rawCli 的字段说明）。
 *
 * 上限远大于面板摘要的 300 行，足以覆盖节点数很多的 workflow；超出后
 * 丢弃最旧的行（保留「最新的一段」），避免失控执行把内存撑爆。 */
export const RAW_CLI_MAX_LINES = 5000;

/** 追加一行 comfy-cli 完整原文（不截断），供前端「查看完整输出」按需拉取。 */
export function appendRawCli(taskId: string, line: string): void {
  if (!taskId) {
    return;
  }
  const store = state();
  const arr = store.rawCli.get(taskId) ?? [];
  arr.push(line);
  if (arr.length > RAW_CLI_MAX_LINES) {
    arr.splice(0, arr.length - RAW_CLI_MAX_LINES);
  }
  touchAndEvict(store.rawCli, taskId, arr, LOGS_MAX_TASKS);
}

/** 读取某次执行累积的 comfy-cli 完整原文（无记录返回空数组）。
 *  刻意**不导出**：唯一的读者是下面的 `persistRawCli`，对外入口是
 *  `/api/tasks/[id]/raw-cli`，它读库而不是读本进程的内存。 */
function getRawCli(taskId: string): Array<string> {
  return state().rawCli.get(taskId) ?? [];
}

/** 把 comfy-cli 完整原文整包落库（P3 §5 ADR §14 D1 的 4-B2）。
 *
 *  与 `persistLogs` 的分工：日志跟着 200ms 防抖走（增量追加，见 `flushLogsDelta`），
 *  原文**只在收口点写一次**——它能到几千行，跟着防抖写等于白写几十遍。所以这一句
 *  的调用点是成功 / 失败 / 取消三条收口，不是 `appendRawCli`。
 *  失败的处理与 `persistLogs` 同形：排障入口少一份原文，不该把收口链路整段回滚。 */
export async function persistRawCli(taskId: string): Promise<void> {
  const lines = getRawCli(taskId);
  if (lines.length === 0) {
    return;
  }
  try {
    const { taskRepo } = await resolveDeps();
    await taskRepo.replaceRawCli(taskId, lines);
  } catch (error) {
    const message = `[comfyui] persistRawCli(${taskId}) 落库失败：${errorText(error, "unknown")}`;
    try {
      const { log: hostLog } = await resolveDeps();
      hostLog.warn(message);
    } catch {
      throw error;
    }
  }
}
