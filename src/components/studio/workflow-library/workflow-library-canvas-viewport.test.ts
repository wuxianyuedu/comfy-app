/* 工作流库画布预览的只读视口算式 —— ISSUE #355
 *
 * 用户诉求：「这里需要可以拖动整个画布查看其他超出边框的内容」。这里钉住四条
 * 契约：拖动改平移、滚轮围绕光标缩放、适应/复位给出可预期的视口、以及
 * 「夹在上下限内」不让画面缩没或放大到离谱。 */

import { describe, expect, it } from "vitest";

import {
  IDENTITY_VIEWPORT,
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
  clampZoom,
  fitViewport,
  isIdentityViewport,
  panBy,
  viewportTransform,
  zoomAt,
  zoomLabel,
  zoomStepFromWheel,
} from "./workflow-library-canvas-viewport";

describe("拖动 = 改平移", () => {
  it("按指针位移平移，缩放不变", () => {
    const next = panBy(IDENTITY_VIEWPORT, { dx: 40, dy: -25 });
    expect(next).toEqual({ tx: 40, ty: -25, zoom: 1 });
  });

  it("放大后位移按缩放折算 —— 手指与画面同速", () => {
    /* 内容放到 200% 时，手指走 20px 只该让内容走 10px。 */
    const next = panBy({ tx: 0, ty: 0, zoom: 2 }, { dx: 20, dy: 0 });
    expect(next.tx).toBe(10);
  });
});

describe("滚轮 = 围绕光标缩放", () => {
  it("向上滚放大、向下滚缩小，一步一档", () => {
    expect(zoomStepFromWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomStepFromWheel(1, 100)).toBeLessThan(1);
    /* 零位移（横向滚轮 / 惯性尖峰）不改缩放。 */
    expect(zoomStepFromWheel(1.4, 0)).toBe(1.4);
  });

  it("缩放围绕锚点进行 —— 锚点处的内容停在原地", () => {
    const anchor = { x: 300, y: 120 };
    const before = { tx: 20, ty: 10, zoom: 1 };
    /* 锚点在内容坐标系里的位置：缩放前后必须一致。 */
    const contentX = (anchor.x - before.tx) / before.zoom;
    const next = zoomAt(before, anchor, 1.5);
    expect((anchor.x - next.tx) / next.zoom).toBeCloseTo(contentX, 6);
  });

  it("缩放被夹在上下限内", () => {
    expect(clampZoom(99)).toBe(MAX_VIEWPORT_ZOOM);
    expect(clampZoom(0.01)).toBe(MIN_VIEWPORT_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(zoomAt(IDENTITY_VIEWPORT, { x: 0, y: 0 }, 99).zoom).toBe(
      MAX_VIEWPORT_ZOOM,
    );
  });
});

describe("适应 / 复位", () => {
  it("适应：缩到刚好放得下（不放大超过 100%）并居中", () => {
    const viewport = fitViewport(
      { width: 1600, height: 400 },
      { width: 800, height: 400 },
    );
    expect(viewport.zoom).toBeLessThan(1);
    /* 内容缩放后水平居中：左右留白相等。 */
    const contentW = 1600 * viewport.zoom;
    expect(viewport.tx).toBeCloseTo((800 - contentW) / 2, 6);
  });

  it("内容比容器小 → 不放大，按 100% 居中", () => {
    const viewport = fitViewport(
      { width: 200, height: 100 },
      { width: 800, height: 400 },
    );
    expect(viewport.zoom).toBe(1);
    expect(viewport.tx).toBe(300);
  });

  it("量不到尺寸（0 / NaN）时退回初始视口，不产出 NaN 坐标", () => {
    expect(
      fitViewport({ width: 0, height: 0 }, { width: 800, height: 400 }),
    ).toEqual(IDENTITY_VIEWPORT);
    expect(
      fitViewport(
        { width: Number.NaN, height: 100 },
        { width: 800, height: 400 },
      ),
    ).toEqual(IDENTITY_VIEWPORT);
  });

  it("初始视口判定（决定「复位」是否可用）", () => {
    expect(isIdentityViewport(IDENTITY_VIEWPORT)).toBe(true);
    expect(isIdentityViewport({ tx: 12, ty: 0, zoom: 1 })).toBe(false);
    expect(isIdentityViewport({ tx: 0, ty: 0, zoom: 1.4 })).toBe(false);
  });
});

describe("展示", () => {
  it("transform 文本与缩放百分比", () => {
    expect(viewportTransform({ tx: 10, ty: -4, zoom: 1 })).toBe(
      "translate3d(10px, -4px, 0) scale(1)",
    );
    expect(zoomLabel(1.25)).toBe("125%");
  });
});
