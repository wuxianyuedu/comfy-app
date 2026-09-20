// ── 「给一个异步结果加超时」的唯一出口（规范 16 §16.2.4.62）──
//
// 按**形态**扫出来的账（ISSUE #672）：`Promise.race` + `setTimeout` 的样板散在
// 六处，而它们对三件事各判各的：
//
//   · **定时器谁来清** —— `use-workflow-detail-loader` 用 `.finally(clearTimeout)`；
//     `orchestrator.runFFmpeg` 在 `close` 与 `error` 两个分支各清一次（漏一个就是
//     悬挂的定时器把进程引用留到超时）；`firstframe.waitForImage` 在三个分支里
//     各清一次；`process-launch.waitForDetachMediator` 只在 `exit` 分支清；
//   · **超时之后干什么** —— 有的 `reject`（调用方能 catch）、有的 `resolve`
//     一个哨兵值（`{code: -1, stderr: "timeout"}` / `null`），有的**杀掉子进程**
//     再 fail（`runFFmpeg` 的 `cp.kill("SIGKILL")`、`executor-cli` 的看门狗）。
//     差异没写下来，于是同一件事在不同函数里「超时算失败还是算一种结果」不同；
//   · **时长的来源与文案** —— 硬编码（`5 * 60 * 1000` / `120000`）与参数化并存，
//     超时文案有的带量纲换算（`${ms / 1000}s`）、有的不带。
//
// 收口口径（与 §16.2.4.48 的文本截断同款）：**超时之后怎么收尾是调用处的域决定**
//（有的是「给个兜底值继续」、有的是「杀进程再报错」），但「跟时间赛跑并保证定时器
// 一定被清」这件事只该有一处定义。因此这里给的是：
//
//   · `withTimeout(promise, ms, { onTimeout })` —— 超时**抛错**（能给调用方 catch）；
//   · `withTimeoutResult(promise, ms, fallback)` —— 超时**给兜底值**（不抛）；
//   · 两个出口共用同一条「胜出即清定时器」的收尾，不留给调用处各写一遍。
//
// 一句话判据：**要「跟时间赛跑」用本模块**；仅仅 `await sleep(ms)` 不是这条账
//（那是「等一会儿」，没有赛跑，也没有要清的定时器）。

/** 超时异常的具名类 —— 调用处可据此区分「超时」与「业务失败」。 */
export class TimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(message: string, timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface WithTimeoutOptions {
  /**
   * 超时时抛出的错误文案。给了 `message` 用它；只给 `label` 则由出口拼
   * `${label}超时（${秒}s）` —— 秒数是**出口自己算**的（`ms / 1000`），
   * 调用处不再重复一遍量纲换算（收口前六处里三处自己算、三处硬编码）。
   */
  message?: string;
  label?: string;
  /**
   * 超时那一刻的收尾钩子（在抛出之前调）。
   *
   * 存在的意义是把「超时不只是放弃等待」这类落点收进来：`runFFmpeg` 与
   * `executor-cli` 的看门狗要在超时时**杀掉子进程**，否则放弃等待之后
   * 进程还在占 GPU。钩子里的异常**不会**顶替超时错误（吞掉即可）——
   * 收尾失败不该改变「这是一次超时」这个结论。
   */
  onTimeout?: () => void;
}

/** 超时文案的默认拼法（带量纲，与收口前的 `加载超时（25s）` 同形）。 */
function timeoutMessage(ms: number, label?: string): string {
  const seconds = Math.round(ms / 1000);
  return `${label ?? ""}超时（${seconds}s）`;
}

/**
 * 与时间赛跑：`ms` 内不 resolve 就 reject 一个 {@link TimeoutError}。
 *
 * **定时器一定被清**：成功 / 失败 / 超时三条路径都经同一个收尾，
 * 调用处不再各写一遍 `clearTimeout`（收口前那六处漏清的表现是「进程被留到超时」
 * 或「测试结束后还有活动定时器」）。
 *
 * ⚠️ 底层 promise **不会**被取消 —— JS 没有取消原语。它超时后仍可能最终
 * settle（此时已被 race 丢掉，不会影响结果）。要真的停掉工作请用
 * `onTimeout` 去中断它持有的事物（子进程 / socket / AbortController）。
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  opts: WithTimeoutOptions = {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        opts.onTimeout?.();
      } catch {
        /* 收尾钩子失败不改结论：这依然是一次超时。 */
      }
      reject(
        new TimeoutError(opts.message ?? timeoutMessage(ms, opts.label), ms),
      );
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * 与时间赛跑，但超时**给兜底值**而不是抛错。
 *
 * 用于「拿不到就当没有」的探测类落点（端口探测 / 中介进程读 stderr）：
 * 它们本来就把「超时」当成一种结果，包成异常只会让每个调用处都写一遍
 * `try / catch` 去把它转回值 —— 那正是收口前 `resolve({code: -1, stderr: "timeout"})`
 * 那两处的做法。
 *
 * `fallback` 是**值**不是工厂：调用处要「按当时的状态算出兜底」请自己包一层
 * （`withTimeoutResult(p, ms, null).then((r) => r ?? computeFallback())`）——
 * 出口不猜兜底值依赖什么。
 */
export function withTimeoutResult<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  opts: Omit<WithTimeoutOptions, "message" | "label"> = {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      try {
        opts.onTimeout?.();
      } catch {
        /* 同上：收尾钩子失败不改结论。 */
      }
      resolve(fallback);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * 「等一会儿」—— 可注入的睡眠（默认真 `setTimeout`）。
 *
 * 它**不是**本条账的主角（没有赛跑），但与上面两个出口同属「定时器」这一族，
 * 收在同一文件里免得各域再写一份 `new Promise((r) => setTimeout(r, ms))`
 *（收口前有 15 处，其中 8 处逐字相同）。
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
