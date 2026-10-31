import { describe, expect, it } from "vitest";
import { chunkRange, countAfterPage, tailPages, tailWindow, tailWindowAppend } from "./page-window";

const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe("page-window —— 倒序分页", () => {
  it("第 1 页是最新的一段（列表末尾）", () => {
    expect(tailPages(items, 1, 3).entries).toEqual([8, 9, 10]);
  });

  it("页码越大越靠前", () => {
    expect(tailPages(items, 2, 3).entries).toEqual([5, 6, 7]);
    expect(tailPages(items, 3, 3).entries).toEqual([2, 3, 4]);
  });

  it("最后一页可能不满（且不会多给）", () => {
    /* 10 条、每页 3 条 = 3 + 3 + 3 + 1。 */
    expect(tailPages(items, 4, 3).entries).toEqual([1]);
  });

  it("越界页码钳到最后一页，并把钳过的页码返回（state 据此归位）", () => {
    const r = tailPages(items, 99, 3);
    expect(r.page).toBe(4);
    expect(r.totalPages).toBe(4);
    expect(r.entries).toEqual([1]);
  });

  it("页码为 0 / 负数同样钳回", () => {
    expect(tailPages(items, 0, 3).page).toBe(1);
    expect(tailPages(items, -5, 3).page).toBe(1);
  });

  it("页码为 Infinity 钳到末页；NaN 才是「算不出来」落回第 1 页", () => {
    /* 两者语义不同：`Infinity` 是「明确超出范围」，`NaN` 是「算不出来」。 */
    expect(tailPages(items, Infinity, 3).page).toBe(4);
    expect(tailPages(items, Number.NaN, 3).page).toBe(1);
    expect(tailPages(items, -Infinity, 3).page).toBe(1);
  });

  it("页码为 NaN 时仍给出第 1 页的内容（不是空窗口）", () => {
    expect(tailPages(items, Number.NaN, 3).entries).toEqual([8, 9, 10]);
  });

  it("空列表是「1 页、0 条」，不是 0 页", () => {
    const r = tailPages([], 1, 3);
    expect(r.totalPages).toBe(1);
    expect(r.entries).toEqual([]);
  });

  it("pageSize 为 0 / 负数 / NaN 都不会给出 Infinity 页", () => {
    for (const size of [0, -3, Number.NaN]) {
      const r = tailPages(items, 1, size);
      expect(Number.isFinite(r.totalPages)).toBe(true);
      expect(r.totalPages).toBe(items.length);
      expect(r.entries).toEqual([10]);
    }
  });

  it("pageSize 超过总数时整表就是一页", () => {
    const r = tailPages(items, 1, 100);
    expect(r.totalPages).toBe(1);
    expect(r.entries).toEqual(items);
  });
});

describe("page-window —— 「这一页之后还有多少条」", () => {
  it("第 1 页 = 总数 - 一页（最新的一段之后还有更早的条数）", () => {
    /* ⚠️ 注意这与 `LogPanel` 的「第 1 页恒为 0」**不是同一个量**：那边用的是
     * **锚定窗口**（`selectFirstPageWindow` 的 `truncatedFromEnd`），窗口大小
     * 恰好等于一页、且窗口原地不动，所以它后面确实没有东西。本函数回答的是
     * 「按页码分页时，第 N 页之上压着多少条」。 */
    expect(countAfterPage(10, 1, 3)).toBe(7);
  });

  it("第 N 页给出「还没被翻过去的更新条数」", () => {
    expect(countAfterPage(10, 2, 3)).toBe(4);
    /* 第 4 页是最老的一页：更新的 9 条都已经被翻过去了，所以是 0。 */
    expect(countAfterPage(10, 4, 3)).toBe(0);
  });

  it("越界页码用**钳回后**的页码算 —— 与页面显示的页号一致", () => {
    /* 总 10 条、每页 3 条 → 4 页。页码 99 显示为第 4 页，则与它同解。 */
    expect(countAfterPage(10, 99, 3)).toBe(countAfterPage(10, 4, 3));
  });

  it("永不为负（页码大过总数时）", () => {
    expect(countAfterPage(2, 5, 3)).toBe(0);
  });
});

describe("page-window —— 尾部窗口", () => {
  it("取最后 N 条", () => {
    expect(tailWindow(items, 3)).toEqual([8, 9, 10]);
  });

  it("N 不小于长度时给整表的副本（不是原引用）", () => {
    const out = tailWindow(items, 100);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it("空列表给空数组", () => {
    expect(tailWindow([], 3)).toEqual([]);
  });

  it("N 为 0 / 负数 / NaN 时按 1 条处理（不是空 / 整表）", () => {
    expect(tailWindow(items, 0)).toEqual([10]);
    expect(tailWindow(items, -2)).toEqual([10]);
    expect(tailWindow(items, Number.NaN)).toEqual([10]);
  });
});

describe("page-window —— 尾部窗口的增量追加", () => {
  it("未满时追加到末尾", () => {
    expect(tailWindowAppend([1, 2], 3, 5)).toEqual([1, 2, 3]);
  });

  it("已达上限时挤掉最旧的一条", () => {
    expect(tailWindowAppend([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
  });

  it("未满时返回新数组（调用处靠换引用触发渲染）", () => {
    const items = [1, 2];
    const out = tailWindowAppend(items, 3, 5);
    expect(out).not.toBe(items);
    expect(items).toEqual([1, 2]);
  });

  it("同一形态：与「先展开再取尾部窗口」逐字等价", () => {
    const size = 4;
    let fast: Array<number> = [];
    let slow: Array<number> = [];
    for (let i = 0; i < 12; i++) {
      fast = tailWindowAppend(fast, i, size);
      slow = tailWindow([...slow, i], size);
      expect(fast).toEqual(slow);
    }
  });

  it("size 归一成「至少 1 条」：窗口恒为 1，不会被当成「无上限」", () => {
    /* 0 / 负数 / NaN 都落到 1 条 —— 调用处传错参数时宁可只留最后一条，
     * 也不要把内存上限悄悄取消掉（`safeSize` 的口径，与 `tailWindow` 同源）。 */
    expect(tailWindowAppend([], 3, 0)).toEqual([3]);
    expect(tailWindowAppend([], 3, -5)).toEqual([3]);
    expect(tailWindowAppend([], 3, Number.NaN)).toEqual([3]);
    /* `Infinity` 也落到 1 条（`Number.isFinite(Infinity)` 为 false）——「没有上限」
     * 这个意图在本模块没有表达方式，调用处想留整表就别传 size。 */
    expect(tailWindowAppend([], 3, Infinity)).toEqual([3]);
  });

  it("逐字对齐 tailWindow：整段追加序列与「每步先展开再切片」一致", () => {
    /* 判据要按**整段序列**比，不能拿中途的窗口当起点：某一刻的 `[1,2]`
     * 是「上限 2 时攒下来的」，而 `[1,2,3]` 是「上限 3 时攒下来的」——
     * 两个窗口拿同一个 size 去追加，本就该得出不同结果。 */
    for (const size of [0, -3, 1, 2, 5, Number.NaN, Infinity]) {
      let fast: Array<number> = [];
      let slow: Array<number> = [];
      for (let i = 0; i < 10; i++) {
        fast = tailWindowAppend(fast, i, size);
        slow = tailWindow([...slow, i], size);
        expect(fast, `size=${size} i=${i}`).toEqual(slow);
      }
    }
  });

  it("封顶后长度恒定（不会一边 shift 一边长胖）", () => {
    let logs: Array<number> = [];
    for (let i = 0; i < 100; i++) {
      logs = tailWindowAppend(logs, i, 10);
    }
    expect(logs).toHaveLength(10);
    expect(logs).toEqual([90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
  });
});

describe("page-window —— 平行分块", () => {
  it("从头按片长切，第 index 块给出它覆盖的范围", () => {
    expect(chunkRange(10, 4, 0)).toEqual({ start: 0, end: 4, total: 3 });
    expect(chunkRange(10, 4, 1)).toEqual({ start: 4, end: 8, total: 3 });
  });

  it("最后一块在末尾收口（不外溢）", () => {
    expect(chunkRange(10, 4, 2)).toEqual({ start: 8, end: 10, total: 3 });
  });

  it("越界块号钳回有效区间", () => {
    expect(chunkRange(10, 4, 99).start).toBe(8);
    expect(chunkRange(10, 4, -1).start).toBe(0);
  });

  it("块号为 NaN 时按第 0 块处理；Infinity 钳到末块（与页码同一口径）", () => {
    expect(chunkRange(10, 4, Number.NaN).start).toBe(0);
    expect(chunkRange(10, 4, Infinity).start).toBe(8);
    /* 不钳的话 `i * s` 是 Infinity，`slice(Infinity, Infinity)` 静默给空。 */
    expect(chunkRange(10, 4, Infinity).end).toBe(10);
    expect(chunkRange(10, 4, -Infinity).start).toBe(0);
  });

  it("空列表是「1 块的空块」", () => {
    expect(chunkRange(0, 4, 0)).toEqual({ start: 0, end: 0, total: 1 });
  });

  it("负数 / 非有限条目数当 0 处理（不会出现负的 end 或 Infinity 块）", () => {
    expect(chunkRange(-5, 4, 0)).toEqual({ start: 0, end: 0, total: 1 });
    expect(chunkRange(Number.NaN, 4, 0)).toEqual({ start: 0, end: 0, total: 1 });
    expect(chunkRange(Infinity, 4, 0)).toEqual({ start: 0, end: 0, total: 1 });
  });

  it("片长为 0 / 负数 / NaN 时按 1 处理（不会出现 Infinity 块）", () => {
    for (const size of [0, -1, Number.NaN]) {
      const r = chunkRange(3, size, 0);
      expect(r.total).toBe(3);
      expect(r).toEqual({ start: 0, end: 1, total: 3 });
    }
  });
});
