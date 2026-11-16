// ── 「一个异步动作重试几次、退避多久」的唯一出口（规范 16 §16.2.4.49）──────
//
// 这条账与「进度」「截断」同族：**不是重复代码，是口径**。全库有三处各写
// 一份重试策略，而三处的形状其实只有两种 —— 但此前没有任何一处说明
// 「为什么这一处用指数退避、那一处用固定间隔」：
//
//   · `executor-ws` 的 WS 重连 —— `Math.min(RECONNECT_BASE_MS * 2 ** attempt,
//     RECONNECT_MAX_MS)`，**指数退避 + 上限**，attempt 还额外夹在 8（防止
//     `2 ** n` 溢出成 Infinity）。它的场景是「对端可能长时间不可用」——
//     固定间隔会一直以固定压力砸一个已经宕掉的服务，指数退避是给对端恢复时间。
//   · `executor-history` 的 history 轮询 —— `12 轮 × 250ms`，**固定间隔 +
//     有界次数**。场景是「对端一定就绪、只是慢一拍」（ComfyUI 先发
//     `execution_success` 才把结果写进 history）—— 这里**不该**用指数退避：
//     总共只等 3 秒，退避会让它更晚拿到结果。
//   · `use-settings-page` 的 Ollama 就绪轮询 —— `20 次 × 2000ms`，**固定间隔 +
//     有界次数**。场景是「冷启动需要几十秒」，固定 2s 是为了让状态行尽快
//     反映就绪（退避会让用户多等）。
//   · 另外还有一组**探针**（停止后确认进程真的没了）：`lifecycle` 5×500、
//     `drizzle-studio` 8×400、`ollama-stop` 10 —— 同一形状但各自内联，
//     连「等多久」都没有一个名字。
//
// 收口方式与 §16.2.4.9 同款：**只搬定义、不动取值** —— 三处的轮询/退避行为
// 一字不改，只是把「几次 / 多久」与「delay 怎么算」搬到这里各定义一次。
// 判据是「同一件事的定义只有一处」，而不是「把三处改成同一种策略」
// —— 策略**本就该不同**，本条账要的是把「为什么不同」写下来。

import { clamp } from "~/lib/clamp";

/** 退避策略的两种形状。 */
export type BackoffShape =
  /** 固定间隔：适合「对端一定就绪、只是慢一拍」。 */
  | "fixed"
  /** 指数退避 + 上限：适合「对端可能长时间不可用，别一直砸它」。 */
  | "exponential";

/**
 * 抖动形状（ISSUE #3888）：给等待时长加随机量，错开多个客户端的同拍重试。
 *
 * - `none`（缺省）：不加随机量 —— 既有取值一字不变；单客户端对单服务的重试不需要它。
 * - `full`：在 `[0, delay]` 内均匀取值 —— 竞争者多、谁先试都行的场景。
 * - `equal`：在 `[delay/2, delay]` 内均匀取值 —— 保留一半底噪，避免抖出近乎 0
 *   的等待把刚失败的操作立刻又打回去。
 *
 * 什么时候该开：**多个进程 / 多个客户端会同时撞同一个资源**的重试（典型：一群
 * worker 同时对同一份库切 WAL、抢写锁）。单客户端的指数退避本身已经错峰，不必开。
 */
export type JitterShape = "none" | "full" | "equal";

export type BackoffShapeOptions = {
  /** `fixed` 的间隔，或 `exponential` 的基数（毫秒）。 */
  baseMs: number;
  /**
   * 抖动形状（缺省 `none` = 不加随机量，既有取值不变）。语义见 {@link JitterShape}。
   */
  jitter?: JitterShape;
  /**
   * 指数退避里 `attempt` 的封顶（默认无）。
   *
   * **这不是「最多重试几次」** —— 它是 `2 ** attempt` 的防溢出夹取：
   * `attempt` 一路涨到 1024 时 `2 ** 1024` 是 `Infinity`，`Math.min(Infinity, max)`
   * 虽然仍等于 `max`，但把夹取写在这里能让意图显式（且 `attempt` 本身用于
   * 展示时也是有限数）。「最多几次」由调用处的循环边界表达。
   */
  maxAttempt?: number;
  /** 指数退避的封顶（毫秒）。`fixed` 下忽略。 */
  maxMs?: number;
  shape: BackoffShape;
};

export type BackoffOptions = {
  /** 第几次（**从 0 起**）。 */
  attempt: number;
} & BackoffShapeOptions;

/**
 * 算这一次的等待时长（毫秒）。**纯函数** —— 不 sleep、不循环。
 *
 * 睡眠与循环留在调用处：它们各自的循环体是**域逻辑**（history 每轮要 trace、
 * 就绪轮询每轮要探一个具体的服务），硬塞进一个通用 `retryAsync` 只会把这些
 * 差异挤进回调里，读起来比现在更绕。本出口负责的是**唯一不该各处写一遍的
 * 那一半**：delay 的算法。
 *
 * `rand` 是随机源注入口（测试喂定值）；缺省 `Math.random`。只在 `jitter`
 * 非 `none` 时被调用 —— 缺省形状下连随机源都不碰，既有取值逐位不变。
 */
export function backoffDelayMs(opts: BackoffOptions, rand: () => number = Math.random): number {
  const { attempt, baseMs, shape, maxMs, maxAttempt, jitter = "none" } = opts;
  const n = Math.max(0, attempt);
  const delay =
    shape === "fixed"
      ? baseMs
      : Math.min(
          baseMs * 2 ** (maxAttempt === undefined ? n : Math.min(n, maxAttempt)),
          maxMs ?? Number.POSITIVE_INFINITY,
        );
  if (jitter === "none") {
    return delay;
  }
  /* rand 越界（调用方给了野值）夹回 [0,1]：抖动只改变时机，不许越过 delay
   * （也就不越过 maxMs）—— 那是「错峰」，不是「再赌一把更大的」。 */
  const r = clamp(rand(), 0, 1);
  const scaled = jitter === "full" ? delay * r : delay / 2 + (delay / 2) * r;
  return Math.round(scaled);
}

/* ── 具名策略：每个数都注明了它被什么约束 ──────────────────────────────────
 *
 * 与 `text-clamp` 的具名上限同款：不是统一取值，而是把「为什么是这个数」
 * 从散落的字面量收成一处能读懂的定义。
 */

/** WS 断线重连：基数 1s、封顶 15s、`2 ** attempt` 夹在 8。 */
/* SAFETY: 类型断言已复核 */
export const WS_RECONNECT = {
  shape: "exponential",
  baseMs: 1000,
  maxMs: 15_000,
  /** `2 ** 8 = 256` → 1s × 256 = 256s 远超封顶，再涨没有意义。 */
  maxAttempt: 8,
} as const satisfies BackoffShapeOptions;

/** history 轮询：12 轮 × 250ms（共 3s）—— 覆盖「结果晚一拍落盘」。 */
/* SAFETY: 类型断言已复核 */
export const HISTORY_READ = {
  shape: "fixed",
  baseMs: 250,
  maxAttempts: 12,
} as const;

/** Ollama 冷启动就绪：20 次 × 2s（共 40s）—— 覆盖冷启动的常见耗时。 */
/* SAFETY: 类型断言已复核 */
export const OLLAMA_READY = {
  shape: "fixed",
  baseMs: 2000,
  maxAttempts: 20,
} as const;

/** 首帧（文生视频的第一跳）等库里收口：150 次 × 2s（共 5min）。
 *
 *  与 `HISTORY_READ` 同为「固定间隔」而不是指数退避：这一等的对象是**自己刚提交
 *  的任务**，它一定会走到终态，退避只会让「图早就好了、调用方却很晚才知道」。
 *  5min 这个包络不是新口径 —— 它就是执行链给单个任务的 `JOB_TIMEOUT_MS`，
 *  也与本助手改之前的超时一致（改前是 emitter 订阅 + `withTimeout`，见
 *  `comfyui/firstframe.ts`）。 */
/* SAFETY: 类型断言已复核 */
export const FIRST_FRAME_WAIT = {
  shape: "fixed",
  baseMs: 2000,
  maxAttempts: 150,
} as const;

/** ComfyUI 停止后的探针：5 次 × 500ms（共 2.5s）—— 等进程树退出。 */
/* SAFETY: 类型断言已复核 */
export const COMFY_STOP_PROBE = {
  shape: "fixed",
  baseMs: 500,
  maxAttempts: 5,
} as const;

/** Drizzle Studio 停止后的探针：8 次 × 400ms（共 3.2s）。 */
/* SAFETY: 类型断言已复核 */
export const DRIZZLE_STOP_PROBE = {
  shape: "fixed",
  baseMs: 400,
  maxAttempts: 8,
} as const;

/** Ollama 停止后的探针：10 次 × 500ms（共 5s）。 */
/* SAFETY: 类型断言已复核 */
export const OLLAMA_STOP_PROBE = {
  shape: "fixed",
  baseMs: 500,
  maxAttempts: 10,
} as const;

/**
 * 终态那一次库写：最多 4 次写、指数退避基数 40ms、封顶 300ms（累计等待 40+80+160 = 280ms）。
 *
 * 场景与 `WS_RECONNECT` **不同**，所以不复用它的形状：对手不是「可能长时间不可用的服务」，
 * 而是**另一个进程持有的写锁** —— 桌包拓扑里内嵌 server 与执行宿主同时写同一份 WAL 库。
 * 宿主那条连接的等待预算只有 `SQLITE_BUSY_TIMEOUT_MS`（250ms；形状是客户端 `timeout`
 * 选项，不是开机 PRAGMA，理由见 `sqlite-pragmas` 文件头），稍长一点的锁照旧撞回
 * `SQLITE_BUSY`（ISSUE #1250 的现场）。这种冲突通常几十毫秒内自己散掉 ⇒ 基数要小
 * （多等不如早让路），次数要少：穷尽之后不是继续等，而是**摘干净本进程对这一行的足迹、
 * 让回收器对账接管**（见 `comfyui/executor-write-retry.ts`）。只归还槽位是不够的 ——
 * 回收器那句「本进程没有足迹」的判据读的是四样，实测漏掉 `executedWorkflow` 时那一行
 * 在 `RUNNING` 上停了 11 分钟、22 轮回收全打 `checked` 空转。
 * 与 `HISTORY_READ` 同为「对端一定就绪、只是慢一拍」那一族，但次数明显更少 ——
 * 收口拖在库里没有意义，用户的界面在等这个终态。
 */
/* SAFETY: 类型断言已复核 */
export const TERMINAL_DB_WRITE = {
  shape: "exponential",
  baseMs: 40,
  maxMs: 300,
  /** 含首次尝试的总次数（循环边界写在这里，退避算法仍在调用处）。 */
  maxAttempts: 4,
} as const;

/**
 * 开机那几条库级 PRAGMA：最多 5 次、指数退避基数 25ms、封顶 200ms（累计 25+50+100+200 = 375ms）。
 *
 * 对手与 `TERMINAL_DB_WRITE` **同族但更短命**：它不是「另一个进程正写着一行」，而是
 * **一群进程同时把一份新库切到 WAL**。实测（7 个独立进程同时跑 `PRAGMA journal_mode = WAL`
 * 打一份刚建的空库）：3/8 抛 `SQLITE_BUSY` —— 切换日志模式要独占锁，而那一刻别人不是
 * 「正在写」，只是「正在开」。`next build` 的 `Collecting page data using 7 workers` 正是
 * 这个形状：每个 worker 都 import `src/server/db.ts`，于是每个都跑一次开机 PRAGMA。
 * 几毫秒内自己散掉，所以基数比终态写还小、次数略多（这里每次都很便宜，且失败是
 * **构建直接红**，与「一行任务卡住」不是一个量级）。
 *
 * 形状仍是**有界**的：穷尽后如实抛出（不吞），因为「切 WAL 切不掉」也可能是只读挂载 /
 * 磁盘满一类真故障，那类必须让构建或启动失败得看得见。
 *
 * **抖动开着**（`equal`，ISSUE #3954）：这正是 §8.10 第③条点名的「一群进程同时撞
 * 同一资源」——7 个 worker 的重试拍原本同步落下，实测 3/8 首轮即撞 `SQLITE_BUSY`；
 * 抖动把各进程的重试拍错开，保留一半底噪（不抖出 0ms 立即重打）。
 */
/* SAFETY: 类型断言已复核 */
export const SQLITE_PRAGMA_BOOT = {
  shape: "exponential",
  baseMs: 25,
  maxMs: 200,
  jitter: "equal",
  /** 含首次尝试的总次数（循环边界写在这里，退避算法仍在调用处）。 */
  maxAttempts: 5,
} as const;

/**
 * 用户在等的那一次设置保存撞锁：最多 3 次、指数退避基数 40ms、封顶 200ms
 * （累计等待 40 + 80 = 120ms）。
 *
 * 对手是**另一个正占着写锁的事务**：`BEGIN IMMEDIATE` 撞锁时是**立刻**抛
 * `SQLITE_BUSY`（不是「等一会儿再抛」），因为 Next 侧刻意不给 `PRAGMA busy_timeout`
 * —— node:sqlite 的语句执行是同步的（libsql 也一样），等锁多少毫秒就是本进程停摆多少毫秒（实测与理由见
 * 规范 §7.6 与 `sqlite-pragmas` 文件头）。所以这一族的等待预算只能落在重试这一层。
 *
 * 比 `TERMINAL_DB_WRITE` 少一次（3 vs 4）：那一族收的是「一行任务的终态」，拖在库里
 * 没人看得见，多等 160ms 换来的是少一次回收器对账；这一条是界面上的一次点击，
 * 穷尽之后**把错误呈现给用户**比让界面卡着更诚实（失败路径必须有用户可见出口，硬规则 4）。
 */
/* SAFETY: 类型断言已复核 */
export const SETTINGS_DB_WRITE = {
  shape: "exponential",
  baseMs: 40,
  maxMs: 200,
  /** 含首次尝试的总次数（循环边界写在这里，退避算法仍在调用处）。 */
  maxAttempts: 3,
} as const;

/**
 * LLM 密钥文件的并发首启重读：5 次 × 固定 25ms（共 125ms）。
 *
 * 场景（ISSUE #3877 立的完整性校验 / #3956 收口取值）：Next server 与 Workshop MCP
 * 两进程同时首启时，`wx` 独占创建保证盘上只有一份密钥文件，但**后到者**可能在对方
 * write→close 的窄窗口里读到半截内容。与 `HISTORY_READ` 同为「对端一定就绪、只是
 * 慢一拍」的固定间隔族 —— 总共只等 125ms，指数退避只会更晚拿到完整口令。
 *
 * **刻意保持同步形态**（调用处用 `Atomics.wait` 短眠，不是异步 sleep）：取值发生在
 * `encryptLlmKey` / `decryptLlmKey` 的**同步签名**里，调用方（`repository-user` 的
 * 行映射、Workshop MCP 的 `workshop/llm`）是同步上下文，async 化会把整条加解密链
 * 传染成 Promise。窄窗口最坏阻塞 125ms、且每进程至多发生一次（`cachedKey` 之后恒
 * 命中）—— 用同步短眠换接口形状稳定是划算的，理由就地记录在 `llm/secrets.ts` 的
 * 循环处。
 */
export const KEY_FILE_READ = {
  shape: "fixed",
  baseMs: 25,
  maxAttempts: 5,
} as const;
