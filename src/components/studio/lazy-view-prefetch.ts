/**
 * 懒加载视图分块的**空闲预热**（`WorkspaceViewStack` 的配套件）。
 *
 * 要解决的事（应用日志「界面打开」那几条读数）：工作区每一屏都由 `next/dynamic`
 * 懒加载，分块的 `import()` 在**点开那一屏**才发出。dev server
 * （`next dev --turbo`）对每个分块**按需编译** —— 首次点开模块图较大的屏
 * （现场：设置 / 队列 15s 上下、模式契约 23s）就要在点击之后干等一次编译；
 * 第二次起同一屏才是几十毫秒（分块已编译过）。生产构建没有按需编译，但首访
 * 仍要现拉一次分块。两条链路的共同点：代价都落在**用户的点击之后**。
 *
 * 做法：`lazyView`（动态 import 的唯一出口）把 loader 登记进来；工作区挂载后
 * 按空闲**串行**把它们逐个 `import()` 一遍。bundler 的模块注册表里同一模块
 * 第二次起就是缓存命中，等用户真点开那一屏时 `next/dynamic` 的 loader 直接
 * 兑现 —— 「界面打开」的耗时从「点击 + 编译/拉取」缩成「点击」。
 *
 * 两条硬约束（都有前车之鉴）：
 *   · **串行**：浏览器同源 HTTP/1.1 只有 6 条连接，并发预热会把日志轮询 /
 *     SSE / tRPC 的连接预算占满（同类事故：轮询原语 `ms: () => 0` 空转那一轮，
 *     按需分块 `import()` 撞 `net::ERR_INSUFFICIENT_RESOURCES`）。任何时候
 *     至多一条在途。
 *   · **失败静默**：预热失败不抛、不重试 —— 分块真的加载失败时走既有自愈
 *     （`~/lib/shell/lazy-chunk-recovery`），预热只是提前量，不是新故障面。
 */

/** 一份懒加载 loader（`() => import("…").then(m => m.X)` 那一条链）。 */
export type LazyViewLoader = () => Promise<unknown>;

/** 已登记、还没预热的 loader（`lazyView` 追加，预热队列逐个消费）。 */
const pending: Array<LazyViewLoader> = [];

/** 预热是否已排过（幂等闸：StrictMode 双跑 effect / 重复挂载只排一次）。 */
let scheduled = false;

/** 登记一份懒加载 loader —— 由 `WorkspaceViewStack` 的 `lazyView` 调用。 */
export function registerLazyViewLoader(loader: LazyViewLoader): void {
  pending.push(loader);
}

/** 启动空闲预热（幂等）—— 由工作区视图栈挂载时调用一次。 */
export function startLazyViewPrefetch(): void {
  if (scheduled) {
    return;
  }
  scheduled = true;
  scheduleIdle(drainOne);
}

/** 取队头一个 loader 要一次；要完（或失败）再排下一个 —— 串行的落点。 */
function drainOne(): void {
  const loader = pending.shift();
  if (!loader) {
    return;
  }
  void loader()
    .catch(() => undefined)
    .finally(() => {
      scheduleIdle(drainOne);
    });
}

/** 空闲回调的最长等待：页面一直忙（首屏数据在飞）也至多这么久就开始预热。 */
const IDLE_TIMEOUT_MS = 2_000;

/** 宿主没有 `requestIdleCallback`（老浏览器 / 测试环境）时的退化延迟。 */
const IDLE_FALLBACK_DELAY_MS = 1_000;

/** 浏览器空闲回调；宿主没有这个 API 时退化成定时器。 */
function scheduleIdle(run: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(run, IDLE_FALLBACK_DELAY_MS);
}
