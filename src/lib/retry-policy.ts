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

/** 退避策略的两种形状。 */
export type BackoffShape =
  /** 固定间隔：适合「对端一定就绪、只是慢一拍」。 */
  | "fixed"
  /** 指数退避 + 上限：适合「对端可能长时间不可用，别一直砸它」。 */
  | "exponential";

export interface BackoffShapeOptions {
  /** `fixed` 的间隔，或 `exponential` 的基数（毫秒）。 */
  baseMs: number;
  shape: BackoffShape;
  /** 指数退避的封顶（毫秒）。`fixed` 下忽略。 */
  maxMs?: number;
  /**
   * 指数退避里 `attempt` 的封顶（默认无）。
   *
   * **这不是「最多重试几次」** —— 它是 `2 ** attempt` 的防溢出夹取：
   * `attempt` 一路涨到 1024 时 `2 ** 1024` 是 `Infinity`，`Math.min(Infinity, max)`
   * 虽然仍等于 `max`，但把夹取写在这里能让意图显式（且 `attempt` 本身用于
   * 展示时也是有限数）。「最多几次」由调用处的循环边界表达。
   */
  maxAttempt?: number;
}

export interface BackoffOptions extends BackoffShapeOptions {
  /** 第几次（**从 0 起**）。 */
  attempt: number;
}

/**
 * 算这一次的等待时长（毫秒）。**纯函数** —— 不 sleep、不循环。
 *
 * 睡眠与循环留在调用处：它们各自的循环体是**域逻辑**（history 每轮要 trace、
 * 就绪轮询每轮要探一个具体的服务），硬塞进一个通用 `retryAsync` 只会把这些
 * 差异挤进回调里，读起来比现在更绕。本出口负责的是**唯一不该各处写一遍的
 * 那一半**：delay 的算法。
 */
export function backoffDelayMs(opts: BackoffOptions): number {
  const { attempt, baseMs, shape, maxMs, maxAttempt } = opts;
  const n = Math.max(0, attempt);
  if (shape === "fixed") return baseMs;
  const capped = maxAttempt === undefined ? n : Math.min(n, maxAttempt);
  return Math.min(baseMs * 2 ** capped, maxMs ?? Number.POSITIVE_INFINITY);
}

/* ── 具名策略：每个数都注明了它被什么约束 ──────────────────────────────────
 *
 * 与 `text-clamp` 的具名上限同款：不是统一取值，而是把「为什么是这个数」
 * 从散落的字面量收成一处能读懂的定义。
 */

/** WS 断线重连：基数 1s、封顶 15s、`2 ** attempt` 夹在 8。 */
export const WS_RECONNECT = {
  shape: "exponential",
  baseMs: 1000,
  maxMs: 15000,
  /** `2 ** 8 = 256` → 1s × 256 = 256s 远超封顶，再涨没有意义。 */
  maxAttempt: 8,
} as const satisfies BackoffShapeOptions;

/** history 轮询：12 轮 × 250ms（共 3s）—— 覆盖「结果晚一拍落盘」。 */
export const HISTORY_READ = {
  shape: "fixed",
  baseMs: 250,
  maxAttempts: 12,
} as const;

/** Ollama 冷启动就绪：20 次 × 2s（共 40s）—— 覆盖冷启动的常见耗时。 */
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
export const FIRST_FRAME_WAIT = {
  shape: "fixed",
  baseMs: 2000,
  maxAttempts: 150,
} as const;

/** ComfyUI 停止后的探针：5 次 × 500ms（共 2.5s）—— 等进程树退出。 */
export const COMFY_STOP_PROBE = {
  shape: "fixed",
  baseMs: 500,
  maxAttempts: 5,
} as const;

/** Drizzle Studio 停止后的探针：8 次 × 400ms（共 3.2s）。 */
export const DRIZZLE_STOP_PROBE = {
  shape: "fixed",
  baseMs: 400,
  maxAttempts: 8,
} as const;

/** Ollama 停止后的探针：10 次 × 500ms（共 5s）。 */
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
export const TERMINAL_DB_WRITE = {
  shape: "exponential",
  baseMs: 40,
  maxMs: 300,
  /** 含首次尝试的总次数（循环边界写在这里，退避算法仍在调用处）。 */
  maxAttempts: 4,
} as const;
