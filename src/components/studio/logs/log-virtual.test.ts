/**
 * 虚拟滚动窗口的纯逻辑（ISSUE #609 八审）。
 *
 * 为什么单独立测：这件事的**全部判断**都可以脱离 DOM 断言——「渲染哪一段」
 * 「每行多高」「滚动条多长」都是输入到输出的纯函数。真实浏览器里「节点数不再
 * 随页大小增长」由 e2e 量（jsdom 不做布局），这里锁住判据本身。
 */
import { describe, expect, it } from "vitest";

import {
  LOG_ROW_LINE,
  LOG_ROW_SINGLE,
  LOG_SCROLL_MAX,
  LOG_VIRTUAL_OVERSCAN,
  countLines,
  estimateRowHeight,
  firstVisibleRow,
  layoutRows,
  pinPlan,
  pinScrollTop,
  pinTargetIndex,
  scrollHeightOf,
  visibleRange,
  type RowLayout,
} from "./log-virtual";

/** 造一批等高行（不换行），几何断言才可手算。 */
function flat(count: number, size = LOG_ROW_SINGLE): RowLayout[] {
  return Array.from({ length: count }, (_, i) => ({
    start: i * size,
    size,
  }));
}

describe("行高估算", () => {
  it("不换行时恒为单行高度（truncate 下内容不影响高度）", () => {
    expect(estimateRowHeight("短", false)).toBe(LOG_ROW_SINGLE);
    expect(estimateRowHeight("很长".repeat(200), false)).toBe(LOG_ROW_SINGLE);
    /* 多行 payload 在不换行显示时也只占一行——它是被截断的，不是被展开的。 */
    expect(estimateRowHeight("a\nb\nc", false)).toBe(LOG_ROW_SINGLE);
  });

  it("换行时按显式换行符加高", () => {
    expect(estimateRowHeight("一行", true)).toBe(LOG_ROW_SINGLE);
    expect(estimateRowHeight("一行\n两行", true)).toBe(
      LOG_ROW_SINGLE + LOG_ROW_LINE,
    );
    expect(estimateRowHeight("a\nb\nc\nd", true)).toBe(
      LOG_ROW_SINGLE + 3 * LOG_ROW_LINE,
    );
  });

  it("量不到宽度（首帧 / jsdom）时只数显式换行，不瞎估软换行", () => {
    const long = "x".repeat(5000);
    expect(countLines(long, 0)).toBe(1);
    expect(estimateRowHeight(long, true)).toBe(LOG_ROW_SINGLE);
  });

  it("量到宽度时按最窄的字估软换行下界", () => {
    /* 容量 130px / 每字 13px = 每行 10 字；25 字 → 3 行 */
    expect(countLines("x".repeat(25), 130)).toBe(3);
    /* 空串也是 1 行，不会是 0 行——0 行会让整行高度塌成 0。 */
    expect(countLines("", 130)).toBe(1);
  });
});

describe("行位置表", () => {
  it("start 是单调前缀和，总高等于各行之和", () => {
    const entries = [{ message: "a" }, { message: "a\nb" }, { message: "a" }];
    const { rows, totalSize } = layoutRows(entries, true, 0);
    expect(rows[0]).toEqual({ start: 0, size: LOG_ROW_SINGLE });
    expect(rows[1]!.start).toBe(LOG_ROW_SINGLE);
    expect(rows[2]!.start).toBe(LOG_ROW_SINGLE * 2 + LOG_ROW_LINE);
    expect(totalSize).toBe(LOG_ROW_SINGLE * 3 + LOG_ROW_LINE);
    /* 单调性：二分查找的前提，破了它滚动定位会静默错位。 */
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.start).toBeGreaterThan(rows[i - 1]!.start);
    }
  });

  it("空列表给出空位置表与 0 总高", () => {
    expect(layoutRows([], true, 0)).toEqual({ rows: [], totalSize: 0 });
  });
});

describe("可见区间", () => {
  const rows = flat(2000);

  it("只给视口内的那一段，上下各留 overscan 行", () => {
    const { start, end } = visibleRange(rows, 0, 600);
    expect(start).toBe(0);
    /* 600px / 27px = 22 行整（第 22 行起点 594 落在视口内）+ overscan */
    expect(end).toBe(23 + LOG_VIRTUAL_OVERSCAN);
  });

  it("滚到中间时区间跟着走，且长度恒定（DOM 节点数不随页大小增长）", () => {
    const a = visibleRange(rows, 10_000, 600);
    const b = visibleRange(rows, 30_000, 600);
    expect(a.end - a.start).toBe(b.end - b.start);
    expect(a.start).toBeGreaterThan(0);
    expect(b.start).toBeGreaterThan(a.start);
  });

  it("滚到底时区间末尾钳在行数上（不会 slice 出 undefined）", () => {
    const { start, end } = visibleRange(rows, 2000 * 27, 600);
    expect(end).toBe(2000);
    expect(start).toBeLessThan(2000);
  });

  it("行数不足一屏时给全量", () => {
    const few = flat(3);
    expect(visibleRange(few, 0, 600)).toEqual({ start: 0, end: 3 });
  });

  it("空列表给出空区间（start/end 都不得为负）", () => {
    expect(visibleRange([], 0, 600)).toEqual({ start: 0, end: 0 });
  });

  it("scrollTop / 视口高度取不到值（NaN、负数）时当 0 处理", () => {
    expect(visibleRange(rows, Number.NaN, Number.NaN)).toEqual({
      start: 0,
      end: LOG_VIRTUAL_OVERSCAN + 1,
    });
    expect(visibleRange(rows, -500, -100)).toEqual({
      start: 0,
      end: LOG_VIRTUAL_OVERSCAN + 1,
    });
  });
});

describe("二分定位", () => {
  it("命中的是「起点不超过 offset 的最后一行」", () => {
    const rows = flat(10);
    expect(firstVisibleRow(rows, 0)).toBe(0);
    expect(firstVisibleRow(rows, LOG_ROW_SINGLE - 1)).toBe(0);
    expect(firstVisibleRow(rows, LOG_ROW_SINGLE)).toBe(1);
    expect(firstVisibleRow(rows, LOG_ROW_SINGLE * 3 + 7)).toBe(3);
    expect(firstVisibleRow(rows, 1e9)).toBe(9);
    expect(firstVisibleRow([], 100)).toBe(0);
  });
});

describe("滚动条总高", () => {
  it("常规页远低于上限，按原值撑开", () => {
    expect(scrollHeightOf(2000 * LOG_ROW_SINGLE)).toEqual({
      height: 2000 * LOG_ROW_SINGLE,
      compressed: false,
    });
  });

  it("超限时压到上限并标记（牺牲极端精度换滚动稳定）", () => {
    const huge = LOG_SCROLL_MAX * 4;
    expect(scrollHeightOf(huge)).toEqual({
      height: LOG_SCROLL_MAX,
      compressed: true,
    });
  });

  it("取不到 / 负数一律当 0（绝不能给出负高度）", () => {
    expect(scrollHeightOf(Number.NaN).height).toBe(0);
    expect(scrollHeightOf(-100).height).toBe(0);
  });
});

/* ISSUE #637：贴底（pin）的位置算术抽到本模块后，判据可以脱离 DOM 断言。
 * 真实浏览器里的现象（「滚到底看最新」被下一轮轮询按回顶部）由 e2e 兜住。 */
describe("贴底目标", () => {
  it("取基线与「已追到哪」的较大者，并钳到本页末条", () => {
    expect(pinTargetIndex(0, -1, 1999)).toBe(0);
    expect(pinTargetIndex(50, 10, 1999)).toBe(50);
    expect(pinTargetIndex(10, 50, 1999)).toBe(50);
    expect(pinTargetIndex(9999, 0, 1999)).toBe(1999);
    expect(pinTargetIndex(-5, -9, 1999)).toBe(0);
  });
});

describe("贴底该不该动", () => {
  const base = {
    baseline: 0,
    applied: 0,
    bottomIndex: 1999,
    scrollTop: 0,
    appliedTop: 0,
  };

  it("目标行变了就动（打开面板 / 回到最新 / 换页）", () => {
    expect(pinPlan({ ...base, baseline: 1999 })).toBe(1999);
    expect(pinPlan({ ...base, applied: -1 })).toBe(0);
  });

  it("目标行没变、位置仍是自己写的 → 按原位置钉住", () => {
    expect(pinPlan(base)).toBe(0);
  });

  it("用户已把位置滚到别处 → 不动（滚到底看最新不被按回顶部）", () => {
    expect(pinPlan({ ...base, scrollTop: 53482 })).toBeNull();
  });

  it("容差 1px：浏览器取整造成的分毫差不算「用户接管」", () => {
    expect(pinPlan({ ...base, scrollTop: 1 })).toBe(0);
    expect(pinPlan({ ...base, scrollTop: 54 })).toBeNull();
  });
});

describe("贴底要写入的 scrollTop", () => {
  it("按真实节点几何让目标行贴住视口底边", () => {
    expect(pinScrollTop({ offsetTop: 2700, offsetHeight: 27 }, 500)).toBe(2227);
  });

  it("按估算位置（目标行未渲染时的兜底）同样贴住底边", () => {
    expect(pinScrollTop({ start: 2700, size: 27 }, 500)).toBe(2227);
  });

  it("顶部的行给出 0（不出现负 scrollTop）", () => {
    expect(pinScrollTop({ offsetTop: 0, offsetHeight: 27 }, 500)).toBe(0);
  });

  it("视口高度取不到时按 0 处理，且绝不给出负数", () => {
    expect(pinScrollTop({ offsetTop: 10, offsetHeight: 0 }, Number.NaN)).toBe(
      10,
    );
    expect(pinScrollTop({ start: 0, size: 0 }, -100)).toBe(0);
  });
});
