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
  rect?: Partial<DOMRect>;
  clientWidth?: number;
  clientHeight?: number;
  scrollWidth?: number;
  scrollHeight?: number;
  scrollTop?: number;
}): Element {
  const rect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...opts.rect,
  };
  return {
    clientWidth: opts.clientWidth ?? 0,
    clientHeight: opts.clientHeight ?? 0,
    scrollWidth: opts.scrollWidth ?? 0,
    scrollHeight: opts.scrollHeight ?? 0,
    scrollTop: opts.scrollTop ?? 0,
    getBoundingClientRect: () => rect,
  } as unknown as Element;
}

describe("readElementBox", () => {
  it("量到就给出尺寸、视口位置与内容尺寸", () => {
    const box = readElementBox(
      fakeEl({
        rect: {
          left: 10,
          top: 20,
          width: 100,
          height: 50,
          right: 110,
          bottom: 70,
        },
        clientWidth: 100,
        clientHeight: 50,
        scrollWidth: 120,
        scrollHeight: 300,
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
    expect(readElementBox({} as unknown as Element)).toBeNull();
  });

  it("noRect 跳过视口位置（滚动回调里避免强制布局）", () => {
    const box = readElementBox(
      fakeEl({ rect: { left: 99, top: 99, width: 5, height: 5 } }),
      { noRect: true },
    );
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
    const outer = fakeEl({ rect: { top: 0, bottom: 100 } });
    const inner = fakeEl({ rect: { top: 50, bottom: 60 } });
    expect(isWithinViewport(inner, outer)).toBe(true);
  });

  it("完全在上方即为假", () => {
    const outer = fakeEl({ rect: { top: 100, bottom: 200 } });
    const inner = fakeEl({ rect: { top: 0, bottom: 50 } });
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
    const rect = {
      x: 1,
      y: 2,
      left: 1,
      top: 2,
      right: 11,
      bottom: 22,
      width: 10,
      height: 20,
      toJSON: () => ({}),
    } as DOMRect;
    expect(rectToAnchorRect(rect)).toEqual({
      x: 1,
      y: 2,
      left: 1,
      top: 2,
      right: 11,
      bottom: 22,
      width: 10,
      height: 20,
    });
  });
});

describe("anchorRectToVirtualElement", () => {
  it("装配出 Floating UI 需要的 getBoundingClientRect", () => {
    const rect: AnchorRect = {
      x: 0,
      y: 0,
      left: 5,
      top: 6,
      right: 15,
      bottom: 26,
      width: 10,
      height: 20,
    };
    const el = anchorRectToVirtualElement(rect);
    const got = el.getBoundingClientRect();
    expect(got.left).toBe(5);
    expect(got.height).toBe(20);
    expect(typeof got.toJSON).toBe("function");
  });
});
