import { describe, expect, it } from "vitest";

import { panelPlacement } from "./AgentOverlay";

/**
 * Agent 浮层展开后的纵向落点（`panelPlacement`）：上方放得下就在上方（与图标底边
 * 对齐），放不下就翻到下方 —— 入口被拖到屏幕中部时只向上展开会把面板压成一两百
 * 像素高。断言只锁**结构**（用了哪个边、高度落在哪一档），不锁 CSS 算式派生的像素值。
 */
describe("panelPlacement", () => {
  const VIEWPORT = 900;

  it("入口靠近底部（上方放得下）→ 在图标上方展开，底边与图标对齐", () => {
    const placement = panelPlacement(24, VIEWPORT);
    expect(placement.bottom).toBe("24px");
    expect(placement.top).toBeUndefined();
    expect(placement.maxHeight).toContain("24px");
  });

  it("入口落在屏幕中部（上方放不下）→ 翻到图标下方展开", () => {
    /* 距下沿 560px：上方只剩 900−560−48−16 = 276px < 320px，必须翻。 */
    const placement = panelPlacement(560, VIEWPORT);
    expect(placement.top).toBeDefined();
    expect(placement.bottom).toBeUndefined();
  });

  it("入口贴顶（偏移极大）→ 下方展开，且高度不塌成一条缝", () => {
    const placement = panelPlacement(700, VIEWPORT);
    expect(placement.top).toBeDefined();
    /* 高度只给自然高度，显示高由 `max-height` 收口 —— 两者分开才能让
     * `dvh` 在运行时算，而不是把 JS 那一刻的视口高焊死进样式。 */
    expect(Number.parseInt(placement.height, 10)).toBe(560);
  });

  it("两种落点都给出 maxHeight：面板永不超过视口", () => {
    for (const anchorBottom of [24, 200, 560, 700, 880]) {
      const placement = panelPlacement(anchorBottom, VIEWPORT);
      expect(placement.maxHeight).toContain("100dvh");
    }
  });
});
