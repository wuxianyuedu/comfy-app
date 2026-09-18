/**
 * 日志面板浮层层级契约（ISSUE #262）。
 *
 * 为什么单独立测：这条回归**单测全绿也照样复现**——jsdom 不做层叠与命中测试，
 * 「弹层画出来了但被遮罩压住、收不到点击」在 jsdom 里与正常无异。所以这里不退而
 * 求其次去断言 DOM 结构，而是把层级关系本身变成可断言的事实：常量之间的大小
 * 关系 + 面板实际用的 class 串。
 *
 * 与之配套的**端到端**验证（真实 Chromium 里 elementFromPoint 命中弹层、点得动
 * 选项）在 e2e 里，两者分工：这里保证「常量关系不被改成相等/倒挂」，
 * e2e 保证「浏览器里真的点得到」。
 */
import { describe, expect, it } from "vitest";

import { Z, zClass } from "~/lib/shell/overlay-z";

import {
  LOG_PANEL_OVERLAY_Z,
  LOG_PANEL_OVERLAY_Z_CLASS,
  LOG_PANEL_POPUP_Z,
  LOG_PANEL_POPUP_Z_CLASS,
  isPopupLayerAboveOverlay,
  parseZClass,
} from "./log-panel-layers";

describe("日志面板浮层层级契约", () => {
  it("弹层定位层严格高于面板遮罩（同 z 也会被后写的遮罩盖住）", () => {
    expect(LOG_PANEL_POPUP_Z).toBeGreaterThan(LOG_PANEL_OVERLAY_Z);
    expect(isPopupLayerAboveOverlay(LOG_PANEL_POPUP_Z)).toBe(true);
  });

  it("相等与更低一律判为不安全", () => {
    /* 相等是最容易误判成「一样高就够了」的一档：同 z 时层叠顺序由 DOM 决定，
       弹层先挂、遮罩后挂就必然被盖住——「时灵时不灵」正是本契约要排除的。 */
    expect(isPopupLayerAboveOverlay(LOG_PANEL_OVERLAY_Z)).toBe(false);
    expect(isPopupLayerAboveOverlay(LOG_PANEL_OVERLAY_Z - 1)).toBe(false);
    expect(isPopupLayerAboveOverlay(Number.NaN)).toBe(false);
  });

  it("两档都取自刻度表（规范 16 §16.2.5），且关系仍成立", () => {
    /* P4 把这两档从「自成一档的 z-99 / z-200」改成刻度表的 modal / popup：
       同一件事（一条模态遮罩 + 挂在它里面的下拉）在库里只该有一个值。 */
    expect(LOG_PANEL_OVERLAY_Z).toBe(Z.modal);
    expect(LOG_PANEL_POPUP_Z).toBe(Z.popup);
    expect(LOG_PANEL_OVERLAY_Z_CLASS).toBe(zClass("modal"));
    expect(LOG_PANEL_POPUP_Z_CLASS).toBe(zClass("popup"));
    /* 面板遮罩用的 class 常量必须真的出现在面板上（不是只在测试里对得上） */
    expect(LOG_PANEL_OVERLAY_Z_CLASS).toBe("z-modal");
    expect(LOG_PANEL_POPUP_Z_CLASS).toBe("z-popup");
  });

  it("解析器只认纯数字 z：不认任意值写法（规范 03 §3.2）与枚举档", () => {
    expect(parseZClass("z-[200]")).toBeNull();
    expect(parseZClass("flex items-center")).toBeNull();
    expect(parseZClass("")).toBeNull();
    /* 枚举档由 zClass() 生成、取值看刻度表，不是本函数要解的形态 */
    expect(parseZClass("z-modal")).toBeNull();
    expect(parseZClass("z-popup")).toBeNull();
    /* 带前缀/后缀的邻居 class 不能被误读成层级 */
    expect(parseZClass("w-8 z-200 gap-2")).toBe(200);
    expect(parseZClass("hover:z-50")).toBeNull();
  });
});
