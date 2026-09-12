import { describe, expect, it } from "vitest";

import {
  FLOAT_MARGIN,
  placeFloating,
  type FloatPlacementInput,
} from "./floating-position";

/** 默认视口 1280×720；触发器是画布节点底部的一颗小按钮。 */
function input(over: Partial<FloatPlacementInput> = {}): FloatPlacementInput {
  return {
    trigger: { left: 300, right: 380, top: 600, bottom: 630 },
    width: 280,
    height: 270,
    viewport: { width: 1280, height: 720 },
    ...over,
  };
}

describe("浮层视口定位（ISSUE #349 回归）", () => {
  it("下方空间不足时翻到触发器上方，底边不再越过窗口下沿", () => {
    // 触发器 bottom=630、窗口高 720：下方只剩 720-630-8-6=76px，装不下 270px
    // 的面板 —— 这正是截图上「只露出前三项」的场景。
    // 翻上去后上沿 = 600-6-270 = 324（上方还有 600-8-6=586px 可用）。
    const pos = placeFloating(input());

    expect(pos.placement).toBe("up");
    expect(pos.top).toBe(324);
    // 上沿 + 实测高度必须留在视口内（这是本 ISSUE 的核心断言）。
    expect(pos.top + 270).toBeLessThanOrEqual(720 - FLOAT_MARGIN);
    expect(pos.top).toBeGreaterThanOrEqual(FLOAT_MARGIN);
  });

  it("下方放得下就保持向下弹出，不无谓地翻转", () => {
    const pos = placeFloating(
      input({ trigger: { left: 300, right: 380, top: 100, bottom: 130 } }),
    );

    expect(pos.placement).toBe("down");
    expect(pos.top).toBe(136);
  });

  it("上下都放不下时偏向空间更大的一侧，而不是硬塞向下", () => {
    // 视口高 400、面板 270：下方 400-360-8-6=24px，上方 300-8-6=286px ——
    // 两侧都装不下 270px，但上方宽松得多，应翻上去而不是硬塞向下。
    // 上沿 = 300-6-270 = 24（仍在视口留白内，无需再夹）。
    const pos = placeFloating(
      input({
        viewport: { width: 1280, height: 400 },
        trigger: { left: 300, right: 380, top: 300, bottom: 360 },
      }),
    );

    expect(pos.placement).toBe("up");
    expect(pos.top).toBe(24);
    expect(pos.maxHeight).toBe(384);
  });

  it("面板比视口还高时给出高度上限，交由面板自身滚动", () => {
    const pos = placeFloating(
      input({ height: 900, viewport: { width: 1280, height: 600 } }),
    );

    expect(pos.maxHeight).toBe(584);
    // 底边仍在视口内：上沿被夹到留白处。
    expect(pos.top).toBeGreaterThanOrEqual(FLOAT_MARGIN);
  });

  it("默认右对齐（面板右沿贴触发器右沿）", () => {
    const pos = placeFloating(
      input({ trigger: { left: 300, right: 380, top: 100, bottom: 130 } }),
    );

    expect(pos.left).toBe(380 - 280);
  });

  it("右对齐越界时夹回视口，面板不溢出右沿", () => {
    // 触发器右沿贴到视口留白处（right=1272）：右对齐会把面板推到 992 之外。
    const pos = placeFloating(
      input({ trigger: { left: 1100, right: 1272, top: 100, bottom: 130 } }),
    );

    // 右沿夹到视口留白处：1280-8-280 = 992。
    expect(pos.left).toBe(992);
    expect(pos.left + pos.width).toBeLessThanOrEqual(1280 - FLOAT_MARGIN);
  });

  it("视口比面板还窄时收窄宽度，不再溢出", () => {
    const pos = placeFloating(
      input({ width: 280, viewport: { width: 200, height: 720 } }),
    );

    expect(pos.width).toBe(184);
    expect(pos.left).toBe(FLOAT_MARGIN);
  });

  it("align=left 时面板左沿贴触发器左沿", () => {
    const pos = placeFloating(
      input({
        trigger: { left: 300, right: 380, top: 100, bottom: 130 },
        align: "left",
      }),
    );

    expect(pos.left).toBe(300);
  });

  it("滞回阈值让贴中线浮层不来回跳", () => {
    /* 视口高 400、面板 270（上下留白各 8、间距 6）：
     *   - 触发器 top/bottom=322 → 下方 64px、上方 308px，明显偏上 → 翻上去；
     *   - 触发器 top/bottom=178 → 下方 208px、上方 164px，只差 44px → 默认即
     *     倾向向下（下方略宽），给 80px 滞回后更稳地保持向下。
     * 即「空间差距大就翻、差距小就别动」，避免画布微动时面板上下跳。 */
    const base = {
      viewport: { width: 1280, height: 400 },
      trigger: { left: 300, right: 380, top: 322, bottom: 322 },
      height: 270,
    };
    expect(placeFloating(input(base)).placement).toBe("up");

    const nearMiddle = {
      ...base,
      trigger: { left: 300, right: 380, top: 178, bottom: 178 },
    };
    expect(placeFloating(input(nearMiddle)).placement).toBe("down");
    expect(
      placeFloating(input({ ...nearMiddle, flipHysteresis: 80 })).placement,
    ).toBe("down");
  });
});
