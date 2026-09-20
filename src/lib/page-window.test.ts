import { describe, expect, it } from "vitest";
import {
  chunkRange,
  countAfterPage,
  tailPages,
  tailWindow,
} from "./page-window";

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
    expect(tailPages(items, NaN, 3).page).toBe(1);
    expect(tailPages(items, -Infinity, 3).page).toBe(1);
  });

  it("页码为 NaN 时仍给出第 1 页的内容（不是空窗口）", () => {
    expect(tailPages(items, NaN, 3).entries).toEqual([8, 9, 10]);
  });

  it("空列表是「1 页、0 条」，不是 0 页", () => {
    const r = tailPages([], 1, 3);
    expect(r.totalPages).toBe(1);
    expect(r.entries).toEqual([]);
  });

  it("pageSize 为 0 / 负数 / NaN 都不会给出 Infinity 页", () => {
    for (const size of [0, -3, NaN]) {
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
    expect(tailWindow(items, NaN)).toEqual([10]);
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
    expect(chunkRange(10, 4, NaN).start).toBe(0);
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
    expect(chunkRange(NaN, 4, 0)).toEqual({ start: 0, end: 0, total: 1 });
    expect(chunkRange(Infinity, 4, 0)).toEqual({ start: 0, end: 0, total: 1 });
  });

  it("片长为 0 / 负数 / NaN 时按 1 处理（不会出现 Infinity 块）", () => {
    for (const size of [0, -1, NaN]) {
      const r = chunkRange(3, size, 0);
      expect(r.total).toBe(3);
      expect(r).toEqual({ start: 0, end: 1, total: 3 });
    }
  });
});
