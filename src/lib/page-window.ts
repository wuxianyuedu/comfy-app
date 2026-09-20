// ── 「给一个列表做分页 / 窗口切片」的唯一出口（规范 16 §16.2.4.67）──────
//
// 按**形态**扫出来的账：全库做「从一个列表里切出一段」的算术，而它们不是
// 同一件事的几种写法，是**三种方向相反**的窗口，此前从未被写下来：
//
//   · **倒序分页**（日志面板）：第 1 页**最新**，往前翻看更早的。
//     算式是 `end = total - (page - 1) * size; start = max(0, end - size)`，
//     而「这一页之后还有多少条更新的」在另两处写成了
//     `Math.max(0, len - page * size)` —— 同一份账算了三遍；
//   · **尾部窗口**（两个日志弹窗与三处 store）：恒取最后 N 条，
//     两处逐字相同的 `slice(-300)`，而那个 `300` 谁都不说为什么是 300；
//   · **平行分块**（代码块高亮）：从头按固定片长切，`chunkIndex * size`
//     与 `ceil(total / size)` 各写一遍。
//
// 三者的**边界处理各不相同**，而每一种差异都是静默的：
//
//   · 空列表时 `end` 可能为负（`slice(0, -5)` 不是空窗口，而是从末尾倒数）；
//   · 页码越界（用户在 3 页时删到只剩 1 页）—— 表现成「看着第 1 页、
//     state 里却是第 9 页」；
//   · `pageSize` 传 0 或负数（配置错误）—— `ceil(total / 0)` 是 `Infinity`，
//     页脚渲染成「第 1 / Infinity 页」。
//
// 口径（本文件是全库唯一的定义处）：
//   · **三种窗口各给一支具名函数** —— 它们方向不同，合并成一支只会给调用处
//     一个「从哪一端数」的参数，而那正是最容易传反的；
//   · **`pageSize` 一律按「至少 1 条」处理**，负数 / 0 / `NaN` 都不许
//     变成 `Infinity` 页；
//   · **越界页码钳回有效区间**，并把钳过的页码一并返回 —— 调用处才能据此
//     把 state 归位。

import { clamp } from "~/lib/clamp";

/** 一页 / 一个窗口的条目数与它在原列表里的位置（左闭右开）。 */
export interface PageWindow<T> {
  entries: T[];
  /** 钳回有效区间之后的页码（从 1 起）。 */
  page: number;
  /** 总页数，**至少 1**（空列表也是「1 页」，只是这一页有 0 条）。 */
  totalPages: number;
}

/** `pageSize` 的合法下限：0 / 负数 / `NaN` 都会让 `ceil(total / size)` 变成 `Infinity`。 */
function safeSize(pageSize: number): number {
  return Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : 1;
}

/**
 * 页码 / 块号的归一 —— 三族窗口共用**同一口径**（这是本模块唯一需要说清的一句）。
 *
 * 三种入参各按它的语义归一，不能混成一句 `Number.isFinite(x) ? x : 默认`：
 *   · `NaN` —— 「算不出来」，落回**第 1 页 / 第 0 块**（与 `~/lib/clamp` 对
 *     `NaN` 取 `min` 同一口径）；
 *   · `±Infinity` —— 「明确超出范围」，交给 `clamp` 撞到那一端（末页 / 末块）。
 *     ⚠️ 这一支实测踩到过：最初写的 `Number.isFinite(index) ? … : 0` 会把
 *     `Infinity` 一起归成第 0 块，而它是「明确越界」不是「算不出来」；
 *   · 普通数先取整（`1.5` 页没有意义）。
 */
function normalizeIndex(value: number, fallback: number): number {
  return Number.isNaN(value) ? fallback : Math.floor(value);
}

/**
 * **倒序分页**：第 1 页是列表**末尾**的一段（最新的一段），页码越大越靠前。
 *
 * 日志面板用它：读日志的习惯是「先看最新的」，往前翻才是看历史。
 * 分页在**过滤后的时间线**上做，所以「最新一页」恒为 `page === 1`。
 *
 * 页码越界时**钳回**（不是返回空页）：用户在 3 页时把日志清到只剩 1 页，
 * 期望的是落回末页那一档，而不是看到一片空白。
 */
export function tailPages<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): PageWindow<T> {
  const size = safeSize(pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = clamp(normalizeIndex(page, 1), 1, totalPages);
  const end = total - (safePage - 1) * size;
  const start = Math.max(0, end - size);
  return { entries: items.slice(start, end), page: safePage, totalPages };
}

/**
 * 「这一页**之后**还有多少条更新的」—— 倒序分页的页脚文案就靠它。
 *
 * 方向容易读反，写清：倒序分页里页码越大越**老**，所以「页 N 之后」指的是
 * **更新**的那一侧（页 1 的方向）。于是它是「总数 - 已经翻过去的条数」，
 * 在最老的一页上自然为 0。
 *
 * ⚠️ 收口前这一支在 `log-store` 与 `LogPanel` 各写一遍，而其中一处用的是
 * 钳过的页码、另一处用的是原始页码 —— 页码越界时它们会给出不同答案
 *（虽然那时页面正好也被钳回了，差值恰好被 `max(0, …)` 吃掉，所以一直没人发现）。
 */
export function countAfterPage(
  total: number,
  page: number,
  pageSize: number,
): number {
  const size = safeSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = clamp(normalizeIndex(page, 1), 1, totalPages);
  return Math.max(0, total - safePage * size);
}

/**
 * 日志弹窗（画布步骤日志 / 工作流库运行日志）一次显示的最大行数。
 *
 * 两处此前各写一遍字面量 `300`，谁都没说为什么是 300。收成具名常量的意义
 * 不在于「统一成一个数」，而在于**这个数第一次有了出处**：它是弹窗里的
 * 界面预算（300 行 × 27px ≈ 一屏多，够看上下文又不必虚拟化）。
 *
 * 它与 `log-store` 的 `LOG_PAGE_SIZE`（分页那一档，2000）不是同一个量 ——
 * 那个是「一页有多少条」，这个是「弹窗里最多显示多少行」。
 */
export const LOG_MODAL_MAX_ROWS = 300;

/**
 * **尾部窗口**：恒取列表最后 `size` 条。
 *
 * 两个日志弹窗、`workflow-run-store`、`generation-log.server` 与
 * `use-runtime-log-source` 都用它。它的语义与分页不同 —— 这里没有页码，
 * 永远看最新的一段，`size` 是「最多留多少条」这个预算。
 *
 * 与 `tailPages` 分开的原因是**它们回答的问题不同**：`tailPages` 回答
 * 「第 N 页是哪一段」（要能往前翻），本函数回答「最新的 N 条是哪几条」。
 * 硬合成一支会需要一个「有没有页码」的开关，而那是调用处该说的事。
 */
export function tailWindow<T>(items: readonly T[], size: number): T[] {
  const n = safeSize(size);
  if (n >= items.length) return items.slice();
  return items.slice(items.length - n);
}

/** 分块遍历：第 `index` 块在原列表里的位置（左闭右开）。 */
export interface ChunkRange {
  start: number;
  end: number;
  /** 总块数，至少 1（空列表也是「1 块」的空块）。 */
  total: number;
}

/**
 * **平行分块**：把列表从头按固定片长切开，返回第 `index` 块的范围。
 *
 * 代码块高亮用它（400 行一块，块间让出主线程）。与上两族的区别是**它从
 * 头部数**：分块是「处理顺序」，不是「展示窗口」。
 *
 * 返回范围而不是切好的数组：调用处常常要在同一块上做多件事（取片段、
 * 算进度、标记已处理），交出范围比交出数组更贴用途 —— 也让「块内元素个数」
 * 与「块在原文里的位置」不会各算一遍。
 */
export function chunkRange(
  totalItems: number,
  size: number,
  index: number,
): ChunkRange {
  const s = safeSize(size);
  /* 条目数先归零：负数会让下面的 `Math.min` 给出负的 `end`（`slice(0, -5)`
   * 不是空窗口，而是「从末尾倒数」）。 */
  const count = Number.isFinite(totalItems) ? Math.max(0, totalItems) : 0;
  const total = Math.max(1, Math.ceil(count / s));
  const i = clamp(normalizeIndex(index, 0), 0, total - 1);
  const start = i * s;
  return { start, end: Math.min(count, start + s), total };
}
