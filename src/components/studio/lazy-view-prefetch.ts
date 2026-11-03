/**
 * 懒加载视图分块的**空闲预热**（`WorkspaceViewStack` 的配套件）：工作区每屏由 `next/dynamic` 懒加载，`import()` 在点开那屏才发出 —— dev server 按需编译（现场：设置 / 队列 15s 上下、模式契约 23s），
 * 生产首访也要现拉一次，代价都落在**用户点击之后**。做法：`lazyView` 登记 loader，挂载后按空闲**串行**逐个 `import()`，真点开时即缓存命中。
 * 硬约束：串行（同源 HTTP/1.1 只有 6 条连接，并发预热会占满日志轮询 / SSE / tRPC 预算，前车之鉴是 `ERR_INSUFFICIENT_RESOURCES`）；失败静默不抛不重试（真失败走 `~/lib/shell/lazy-chunk-recovery`）。
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
const IDLE_TIMEOUT_MS = 2000;

/** 宿主没有 `requestIdleCallback`（老浏览器 / 测试环境）时的退化延迟。 */
const IDLE_FALLBACK_DELAY_MS = 1000;

/** 浏览器空闲回调；宿主没有这个 API 时退化成定时器。 */
function scheduleIdle(run: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return;
  }
  setTimeout(run, IDLE_FALLBACK_DELAY_MS);
}
