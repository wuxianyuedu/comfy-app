/**
 * `~/lib/dom-rect` 的契约（ISSUE #672 / 规范 16 §16.2.4.41）。
 *
 * 这条账的实质不是「少写几个 DOM 属性」，而是**三个语义决定**在五处各判各的：
 *   · 量不到时算什么（`null` 还是 0）；
 *   · 「还没量」与「量出来是 0」分不分得开；
 *   · 相对谁量、要不要把外层滚动偏移加回来。
 * 用例按**边界值**写（量不到、行数为 0、滚动过一段）。
 */
import { describe, expect, it } from "vitest";
import {
  anchorRectToVirtualElement,
  centerLineScrollTop,
  isWithinViewport,
  offsetWithin,
  readElementBox,
  readLineHeight,
  rectToAnchorRect,
  type AnchorRect,
} from "./dom-rect";

/** 造一个「像元素」的假对象（jsdom 的 `getBoundingClientRect` 恒为 0）。 */
function fakeEl(opts: {
  clientHeight?: number;
  clientWidth?: number;
  rect?: Partial<DOMRect>;
  scrollHeight?: number;
  scrollTop?: number;
  scrollWidth?: number;
}): Element {
  const rect = {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    ...opts.rect,
  };
  return /* SAFETY: 类型断言已复核 */ {
    clientHeight: opts.clientHeight ?? 0,
    clientWidth: opts.clientWidth ?? 0,
    getBoundingClientRect: () => rect,
    scrollHeight: opts.scrollHeight ?? 0,
    scrollTop: opts.scrollTop ?? 0,
    scrollWidth: opts.scrollWidth ?? 0,
  } as unknown as Element;
}

describe("readElementBox", () => {
  it("量到就给出尺寸、视口位置与内容尺寸", () => {
    const box = readElementBox(
      fakeEl({
        clientHeight: 50,
        clientWidth: 100,
        rect: {
          bottom: 70,
          height: 50,
          left: 10,
          right: 110,
          top: 20,
          width: 100,
        },
        scrollHeight: 300,
        scrollWidth: 120,
      }),
    );
    expect(box).not.toBeNull();
    expect(box!.width).toBe(100);
    expect(box!.left).toBe(10);
    expect(box!.clientHeight).toBe(50);
    expect(box!.scrollHeight).toBe(300);
  });

  it("元素为空时给 null（不是「全 0 的盒子」）", () => {
    expect(readElementBox(null)).toBeNull();
    expect(readElementBox(undefined)).toBeNull();
  });

  it("不是元素（没有 clientWidth）时给 null", () => {
    expect(readElementBox(/* SAFETY: 类型断言已复核 */ {} as unknown as Element)).toBeNull();
  });

  it("noRect 跳过视口位置（滚动回调里避免强制布局）", () => {
    const box = readElementBox(fakeEl({ rect: { height: 5, left: 99, top: 99, width: 5 } }), {
      noRect: true,
    });
    expect(box!.left).toBe(0);
    expect(box!.width).toBe(0);
  });
});

describe("offsetWithin", () => {
  it("两个 rect 相减 + 外层滚动偏移", () => {
    const outer = fakeEl({
      rect: { top: 100 },
      scrollTop: 40,
    });
    const inner = fakeEl({ rect: { top: 160 } });
    /* 160 - 100 + 40 = 100 */
    expect(offsetWithin(inner, outer)).toBe(100);
  });

  it("任一侧为空时给 null（不返回 0 —— 0 是「就在顶部」这个合法位置）", () => {
    expect(offsetWithin(null, fakeEl({}))).toBeNull();
    expect(offsetWithin(fakeEl({}), null)).toBeNull();
  });
});

describe("isWithinViewport", () => {
  it("相交即为真", () => {
    const outer = fakeEl({ rect: { bottom: 100, top: 0 } });
    const inner = fakeEl({ rect: { bottom: 60, top: 50 } });
    expect(isWithinViewport(inner, outer)).toBe(true);
  });

  it("完全在上方即为假", () => {
    const outer = fakeEl({ rect: { bottom: 200, top: 100 } });
    const inner = fakeEl({ rect: { bottom: 50, top: 0 } });
    expect(isWithinViewport(inner, outer)).toBe(false);
  });

  it("任一侧为空时给假", () => {
    expect(isWithinViewport(null, null)).toBe(false);
  });
});

describe("readLineHeight", () => {
  it("scrollHeight / 行数", () => {
    expect(readLineHeight(fakeEl({ scrollHeight: 200 }), 8)).toBe(25);
  });

  it("行数为 0 时给 null（收口前会给出 Infinity）", () => {
    expect(readLineHeight(fakeEl({ scrollHeight: 200 }), 0)).toBeNull();
  });

  it("scrollHeight 为 0 时给 null（未挂载 / display:none）", () => {
    expect(readLineHeight(fakeEl({ scrollHeight: 0 }), 8)).toBeNull();
  });

  it("元素为空时给 null", () => {
    expect(readLineHeight(null, 8)).toBeNull();
  });
});

describe("centerLineScrollTop", () => {
  it("把目标行带到视口中央", () => {
    /* 第 10 行 × 20px - 100/2 = 150 */
    expect(centerLineScrollTop(10, 20, 100)).toBe(150);
  });

  it("结果不为负（第一行居中不该滚到负坐标）", () => {
    expect(centerLineScrollTop(0, 20, 100)).toBe(0);
  });
});

describe("rectToAnchorRect", () => {
  it("把活着的 DOMRect 冻成可存对象（含 x / y）", () => {
    const rect = /* SAFETY: 类型断言已复核 */ {
      bottom: 22,
      height: 20,
      left: 1,
      right: 11,
      toJSON: () => ({}),
      top: 2,
      width: 10,
      x: 1,
      y: 2,
    } as DOMRect;
    expect(rectToAnchorRect(rect)).toEqual({
      bottom: 22,
      height: 20,
      left: 1,
      right: 11,
      top: 2,
      width: 10,
      x: 1,
      y: 2,
    });
  });
});

describe("anchorRectToVirtualElement", () => {
  it("装配出 Floating UI 需要的 getBoundingClientRect", () => {
    const rect: AnchorRect = {
      bottom: 26,
      height: 20,
      left: 5,
      right: 15,
      top: 6,
      width: 10,
      x: 0,
      y: 0,
    };
    const el = anchorRectToVirtualElement(rect);
    const got = el.getBoundingClientRect();
    expect(got.left).toBe(5);
    expect(got.height).toBe(20);
    expect(typeof got.toJSON).toBe("function");
  });
});
