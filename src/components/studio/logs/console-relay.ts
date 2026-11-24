/* ── console 中继的入库队列（规范 17 第②层；ISSUE #4919）────────────────
 *
 * LogProvider 的 console.* 中继**不能在调用当刻（或微任务里）直接写日志 store**：
 * store 的 `set` 会同步通知 LogPanel 重渲染，而 console.* 可能在**任何组件的
 * 渲染期**被触发（应用自己的日志、库的诊断输出……）——渲染期跨组件 setState
 * 是 React 明令的反模式（02 §2.4 / 08 §8.6），现场即 FeedbackDialog 渲染期踩中。
 * `queueMicrotask` 也不够：并发渲染让出主线程时，微任务会在「仍在渲染」的窗口里
 * 排空，照样踩线。
 *
 * 所以中继只做**纯数组入队**（任何时刻调用都安全），由 LogProvider 的既有轮询
 * （useInterval 回调，永不在渲染期）统一排空入库。打印时刻在入队时记下，入库
 * 沿用，不因排空晚而漂移。队列封顶 1000 条（面板未挂载 / 长期无人排空时也
 * 不会无界增长，丢最旧的——与日志面板「保留最近」的口径一致）。
 */

import type { LogEntry } from "./log-types";

/** 待入库的 console 条目（打印时刻已在入队时定死）。 */
export type PendingConsoleEntry = Omit<LogEntry, "id" | "seq">;

const MAX_PENDING = 1000;

const pending: Array<PendingConsoleEntry> = [];

/** console 中继入库：只入队，绝不直接碰 store（渲染期安全）。 */
export function queueConsoleEntry(entry: PendingConsoleEntry): void {
  pending.push(entry);
  if (pending.length > MAX_PENDING) {
    pending.splice(0, pending.length - MAX_PENDING);
  }
}

/** 把队列里的条目逐条交给 `addEntry`（在 LogProvider 的轮询回调里调用，永不在渲染期）。 */
export function drainPendingConsoleEntries(addEntry: (entry: PendingConsoleEntry) => void): void {
  if (pending.length === 0) {
    return;
  }
  const drained = pending.splice(0);
  for (const entry of drained) {
    addEntry(entry);
  }
}
