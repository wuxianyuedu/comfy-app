// @vitest-environment jsdom
/**
 * 「一张图当前该按多大显示」的数值侧契约（图片查看器的另一半，见
 * `image-viewer.tsx` 与 `~/components/ui/image-viewer` 的文件头）。
 *
 * 三个语义决定**只在边界上看得出来**，所以用例都压在边界上：
 *   ① 适应窗口不放大超过 100%（小图不该被拉伸）；
 *   ② 量不到尺寸 / 视口时按 100% 显示，而不是按 0；
 *   ③ 倍数一律夹取（滚轮连滚能算出 0.005 与 3761 倍）。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  clampZoomScale,
  MAX_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  useImageZoom,
  ZOOM_STEP,
} from "./use-image-zoom";

const LANDSCAPE = { width: 1600, height: 1200 };

interface ProbeProps {
  natural: { width: number; height: number } | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  padding?: number;
}

const INITIAL: ProbeProps = {
  natural: LANDSCAPE,
  viewportWidth: 800,
  viewportHeight: 600,
};

function renderZoom(initial: ProbeProps = INITIAL) {
  return renderHook(
    ({ natural, viewportWidth, viewportHeight, padding = 0 }: ProbeProps) =>
      useImageZoom({
        naturalSize: natural,
        viewportWidth,
        viewportHeight,
        padding,
      }),
    { initialProps: initial },
  );
}

describe("适应窗口", () => {
  it("按可视区与图片的较小比例折算（宽高都装得下）", () => {
    const { result } = renderZoom();
    expect(result.current.fitScale).toBeCloseTo(0.5);
    expect(result.current.scale).toBeCloseTo(0.5);
    expect(result.current.percent).toBe(50);
    expect(result.current.mode).toBe("fit");
  });

  it("**不放大超过 100%**：视口比图大时按原尺寸显示", () => {
    const { result } = renderZoom({
      natural: { width: 100, height: 80 },
      viewportWidth: 800,
      viewportHeight: 600,
    });
    expect(result.current.fitScale).toBe(1);
    expect(result.current.percent).toBe(100);
  });

  it("单边内边距从可视区里扣掉（图不贴边）", () => {
    const { result } = renderZoom({ ...INITIAL, padding: 50 });
    /* 可视区 800×600 扣掉两侧 50 → 700×500；高度那一侧更紧：500/1200。 */
    expect(result.current.fitScale).toBeCloseTo(500 / 1200);
  });

  it("视口变化后重新折算", () => {
    const { result, rerender } = renderZoom();
    rerender({ ...INITIAL, viewportWidth: 400, viewportHeight: 300 });
    expect(result.current.fitScale).toBeCloseTo(0.25);
  });

  it("量不到尺寸或视口时按 100% 显示（不是 0）", () => {
    const noSize = renderZoom({ ...INITIAL, natural: null });
    expect(noSize.result.current.fitScale).toBeNull();
    expect(noSize.result.current.scale).toBe(1);
    expect(noSize.result.current.percent).toBe(100);

    const noViewport = renderZoom({
      ...INITIAL,
      viewportWidth: null,
      viewportHeight: null,
    });
    expect(noViewport.result.current.fitScale).toBeNull();
    expect(noViewport.result.current.scale).toBe(1);
    expect(noViewport.result.current.percent).toBe(100);
  });

  it("视口被扣成 0 或负数时也给 100%（不产生负倍数）", () => {
    const zero = renderZoom({
      ...INITIAL,
      viewportWidth: 0,
      viewportHeight: 0,
    });
    expect(zero.result.current.fitScale).toBeNull();
    expect(zero.result.current.scale).toBe(1);

    const negative = renderZoom({ ...INITIAL, padding: 400 });
    expect(negative.result.current.fitScale).toBeNull();
  });
});

describe("缩放档位", () => {
  it("原始大小 = 1:1，适应窗口回到折算值", () => {
    const { result } = renderZoom();
    act(() => result.current.actualSize());
    expect(result.current.mode).toBe("actual");
    expect(result.current.scale).toBe(1);
    expect(result.current.percent).toBe(100);

    act(() => result.current.fit());
    expect(result.current.mode).toBe("fit");
    expect(result.current.scale).toBeCloseTo(0.5);
  });

  it("放大 / 缩小以当前倍数为基准，并按 1.25 倍走", () => {
    const { result } = renderZoom();
    act(() => result.current.zoomIn());
    expect(result.current.mode).toBe("manual");
    expect(result.current.scale).toBeCloseTo(0.5 * ZOOM_STEP);
    expect(result.current.percent).toBe(63);

    act(() => result.current.zoomOut());
    expect(result.current.scale).toBeCloseTo(0.5);
  });

  it("缩小到下限就不再变小", () => {
    const { result } = renderZoom();
    for (let i = 0; i < 20; i++) {
      act(() => result.current.zoomOut());
    }
    expect(result.current.scale).toBe(MIN_ZOOM_SCALE);
  });

  it("放大到上限就不再变大", () => {
    const { result } = renderZoom();
    for (let i = 0; i < 40; i++) {
      act(() => result.current.zoomIn());
    }
    expect(result.current.scale).toBe(MAX_ZOOM_SCALE);
  });

  it("双击档位：适应窗口 ↔ 原始大小；自定义缩放回到适应窗口", () => {
    const { result } = renderZoom();
    act(() => result.current.toggleFitActual());
    expect(result.current.mode).toBe("actual");
    act(() => result.current.toggleFitActual());
    expect(result.current.mode).toBe("fit");

    act(() => result.current.zoomIn());
    expect(result.current.mode).toBe("manual");
    act(() => result.current.toggleFitActual());
    expect(result.current.mode).toBe("fit");
  });

  it("scaleTo 直接给倍数并切到自定义档（滚轮按比例缩放用）", () => {
    const { result } = renderZoom();
    act(() => result.current.scaleTo(1.75));
    expect(result.current.mode).toBe("manual");
    expect(result.current.scale).toBeCloseTo(1.75);
  });
});

describe("clampZoomScale", () => {
  it("可用区间内的值原样返回", () => {
    expect(clampZoomScale(0.5)).toBe(0.5);
    expect(clampZoomScale(3)).toBe(3);
  });

  it("越过上下限就夹取", () => {
    expect(clampZoomScale(0.001)).toBe(MIN_ZOOM_SCALE);
    expect(clampZoomScale(1000)).toBe(MAX_ZOOM_SCALE);
  });

  it("0 / 负数 / NaN / Infinity 一律退回 100%", () => {
    expect(clampZoomScale(0)).toBe(1);
    expect(clampZoomScale(-2)).toBe(1);
    expect(clampZoomScale(Number.NaN)).toBe(1);
    expect(clampZoomScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
