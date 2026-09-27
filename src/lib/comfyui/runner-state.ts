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
import { HISTORY_READ } from "../retry-policy";
import { lastSegments } from "~/lib/path-display";
import {
  createEmptyState,
  type LogEntry,
  type RunnerState,
} from "./runner-state-shape";

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
export type {
  Job,
  LogEntry,
  RawWorkflowOverride,
  RunnerState,
} from "./runner-state-shape";

declare global {
  var comfyRunner: RunnerState | undefined;
}

export function state(): RunnerState {
  /* 单例里不再有 EventEmitter：进程内事件通道已随 ADR §14 D1 退役，执行进度的
   * 对外通道只剩 DB 行 + `/api/tasks/[id]/stream` 的轮询（§13-3C 单源化）。 */
  globalThis.comfyRunner ??= createEmptyState();

  return globalThis.comfyRunner;
}

function callerLoc(): string {
  try {
    const stack = new Error().stack;

    if (!stack) return "";

    const lines = stack.split("\n");

    // 栈的形状：lines[0] 是 "Error"，lines[1] 是 " at log (…)"，lines[2] 才是真正的调用方。

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const frame = lines[2] || lines[1] || "";

    const match = /\(([^():]+):(\d+):(\d+)\)/.exec(frame);

    if (match) {
      const file = lastSegments(match[1], 1) || match[1];

      return `${file}:${match[2]}`;
    }

    const m2 = /at\s+(\S+):(\d+):(\d+)/.exec(frame);

    if (m2) {
      const file = lastSegments(m2[1], 1) || m2[1];

      return `${file}:${m2[2]}`;
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
 * 照样能把内存撑爆。淘汰不丢数据：日志已由 `persistLogs` 落库，SSE 回放
 * 读不到内存时会回落 DB 列（见 stream route 的 `replaySrc`）。 */
export const LOGS_MAX_LINES = 5000;

export const LOGS_MAX_TASKS = 64;

/** 写入并把该任务标记为「最近使用」，再淘汰超出 `maxTasks` 的最久未用项。
 *  Map 的迭代序是插入序、对已存在的键 `set` 不改变位置 —— 所以标记最近
 *  使用要 delete 后再 set，淘汰时取迭代器的第一个键即得最旧项。 */
function touchAndEvict<V>(
  map: Map<string, V>,
  taskId: string,
  value: V,
  maxTasks: number,
): void {
  map.delete(taskId);
  map.set(taskId, value);
  while (map.size > maxTasks) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function log(taskId: string, level: LogEntry["level"], msg: string) {
  const store = state();

  const entry: LogEntry = { t: Date.now(), level, msg, src: callerLoc() };

  const arr = store.logs.get(taskId) ?? [];

  arr.push(entry);

  if (arr.length > LOGS_MAX_LINES) arr.splice(0, arr.length - LOGS_MAX_LINES);

  touchAndEvict(store.logs, taskId, arr, LOGS_MAX_TASKS);

  schedulePersistLogs(taskId);
}

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
 *  生产语义同理：任务被丢弃 / 重跑时先把上一次的落库排期掐掉，避免**旧日志
 *  覆盖新日志**（`persistLogs` 是整包 `replaceLogs`，不是在末尾追加）。 */
export function cancelPersistLogs(taskId: string): void {
  const pending = persistTimers.get(taskId);

  if (!pending) return;

  clearTimeout(pending.debounce);

  clearTimeout(pending.maxDelay);

  persistTimers.delete(taskId);
}

export function schedulePersistLogs(taskId: string) {
  if (!taskId) return;

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

      void persistLogs(taskId);
    }, PERSIST_DEBOUNCE_MS);

    return;
  }

  const debounce = setTimeout(() => {
    const cur = persistTimers.get(taskId);

    if (cur) {
      clearTimeout(cur.maxDelay);

      persistTimers.delete(taskId);
    }

    void persistLogs(taskId);
  }, PERSIST_DEBOUNCE_MS);

  const maxDelay = setTimeout(() => {
    const cur = persistTimers.get(taskId);

    if (cur) {
      clearTimeout(cur.debounce);

      persistTimers.delete(taskId);
    }

    void persistLogs(taskId);
  }, PERSIST_MAX_DELAY_MS);

  persistTimers.set(taskId, { debounce, maxDelay });
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
  if (s.settled.has(taskId)) return false;
  s.settled.add(taskId);
  const t = s.timers.get(taskId);
  if (t) clearTimeout(t);
  s.timers.delete(taskId);
  return true;
}

/** 尝试认领「DB 终态写入」这一次性权利。首个调用者返回 true（应落库），
 *  其余（含 reaper 与 executor 并发收口同一任务）返回 false（必须跳过）。
 *  语义与 `claimSettle` 平行，但锁的是「DB 终态」而不是「收口流程」。 */
export function claimFinalize(taskId: string): boolean {
  const s = state();
  if (s.finalized.has(taskId)) return false;
  s.finalized.add(taskId);
  return true;
}

/** 任务被重新入队（同一个 taskId 重跑）时清掉上一次的收口标记，
 *  否则第二次执行会被这把一次性锁误判为「已落库」而静默丢失终态。 */
export function clearFinalize(taskId: string): void {
  state().finalized.delete(taskId);
}

/**
 * runner-state 的**宿主依赖注入接缝**（P3 迁移第 1 期·第二/三步）。
 *
 * 现状：本模块只剩一处真 IO —— `persistLogs` 里的 `await taskRepository.replaceLogs`
 * 加失败分支的 `logger.warn`。这两条在**加载时**会牵进 `server-only` 链（repository
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
  taskRepo: {
    replaceLogs(taskId: string, entries: LogEntry[]): Promise<void>;
    /** comfy-cli 完整原文整包落库（P3 §5 ADR §14 D1 的 4-B2）：「查看完整输出」
     *  这个排障入口此前只有执行进程自己看得见。 */
    replaceRawCli(taskId: string, lines: string[]): Promise<void>;
  };
  log: {
    warn(msg: string): void;
  };
};

let deps: Partial<RunnerDeps> | null = null;

/** 覆盖 runner-state 的宿主依赖（executor host 用它注入自带 DB / 日志通道）。
 *  传 `Partial`：允许只覆盖一侧，另一侧留给 `resolveDeps` 的 lazy 默认填。 */
export function configureRunner(next: Partial<RunnerDeps>): void {
  deps = { ...(deps ?? {}), ...next };
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
  const log: RunnerDeps["log"] =
    cur.log ?? (await import("~/lib/core/logger")).logger;
  deps = { taskRepo, log };
  return { taskRepo, log };
}

export async function persistLogs(taskId: string) {
  // 此时防抖写与终结点的 `await persistLogs(taskId)` 调用在竞争。

  // 取消防抖计时器，让最终这次同步刷盘

  // 成为该任务**唯一**的写入。

  const pending = persistTimers.get(taskId);

  if (pending) {
    clearTimeout(pending.debounce);

    clearTimeout(pending.maxDelay);

    persistTimers.delete(taskId);
  }

  const arr = state().logs.get(taskId) ?? [];

  // 内部把 DB 落库的失败咽下——理由与旧行为不匹配：
  //   · caller 有 3 处写 `void persistLogs(...)`（防抖回调里），
  //     不 catch 就直接变成 unhandledRejection，进程级噪声；
  //   · 另外 7 处 `await persistLogs(...)`（enqueue / executor-finalize /
  //     reaper），若这里抛错会让 finalize 链路整段回滚，表现比「一份日志
  //     没落库」严重得多。
  // 日志面板的**内存视图**仍完整（state().logs），只是这一次没持久化；
  // 真故障通过 log.warn 落 app-runtime.log 镜像通道，运维看得到。
  // resolveDeps 自身也可能抛（executor host 忘记 configureRunner → 动态
  // import 撞 server-only throw）；这条抛同样进下面的 catch，走 warn 兜底。
  try {
    const { taskRepo } = await resolveDeps();
    await taskRepo.replaceLogs(taskId, arr);
  } catch (e) {
    const message = `[comfyui] persistLogs(${taskId}) 落库失败：${errorText(
      e,
      "unknown",
    )}`;
    // 兜底 warn：若 resolveDeps 已经拉起了 log，走注入侧；否则再试一次 dynamic
    // import。这一句本身在纯 Node + 未 configure 的失败路径下也会抛（server-only），
    // 但那时上面 catch 里已经没有别的兜底手段可依赖了（logger 都没起来），
    // 抛回 caller 的 `void persistLogs` 会走 unhandledRejection —— 那种状态下
    // executor host 的入口就该主动 exit，不靠这里做二次容错。
    try {
      const { log } = await resolveDeps();
      log.warn(message);
    } catch {
      // 完全无法落库 + 无法 warn：让 caller 通过 unhandled rejection 感知，
      // 不吞掉。
      throw e;
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
  if (!taskId) return;
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
function getRawCli(taskId: string): string[] {
  return state().rawCli.get(taskId) ?? [];
}

/** 把 comfy-cli 完整原文整包落库（P3 §5 ADR §14 D1 的 4-B2）。
 *
 *  与 `persistLogs` 的分工：日志跟着 200ms 防抖走（每几秒一次整包重写），原文
 *  **只在收口点写一次**——它能到几千行，跟着防抖重写等于白写几十遍。所以这一句
 *  的调用点是成功 / 失败 / 取消三条收口，不是 `appendRawCli`。
 *  失败的处理与 `persistLogs` 同形：排障入口少一份原文，不该把收口链路整段回滚。 */
export async function persistRawCli(taskId: string): Promise<void> {
  const lines = getRawCli(taskId);
  if (lines.length === 0) return;
  try {
    const { taskRepo } = await resolveDeps();
    await taskRepo.replaceRawCli(taskId, lines);
  } catch (e) {
    const message = `[comfyui] persistRawCli(${taskId}) 落库失败：${errorText(
      e,
      "unknown",
    )}`;
    try {
      const { log: hostLog } = await resolveDeps();
      hostLog.warn(message);
    } catch {
      throw e;
    }
  }
}
