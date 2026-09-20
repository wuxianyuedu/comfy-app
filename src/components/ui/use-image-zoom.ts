"use client";

// ── 「一张图当前该按多大显示」的唯一出口（图片查看器的数值侧）─────────────
//
// 与 `~/components/ui/image-viewer` 的分工：那边是**形态**（弹窗、工具栏、
// 滚动与拖拽），这边是**数值**（缩放模式、倍数夹取、百分比）。分开的理由与
// `~/lib/progress` 对 `ui/progress-bar` 一样：倍数怎么算可以脱离 DOM 单测，
// 而「滚轮事件挂在哪」只能靠渲染测。
//
// 三个语义决定收在这里（散在调用处就会各自漂移）：
//
//   1. **「适应窗口」不放大超过 100%**：视口比图大时按原尺寸显示，而不是把
//      小图拉伸铺满 —— 后者看着像放大镜下的马赛克，用户以为是画质问题。
//      需要放大时用「放大」按钮或滚轮（那是显式的）。
//   2. **量不到尺寸时按 100% 显示**，而不是按 0 —— 图片解码完成前读不到
//      自然尺寸，按 0 显示会先塌成一个点再跳开（与 `~/lib/media/natural-size`
//      把「还不知道」与「尺寸是 0」分开是同一条口径）。
//   3. **倍数一律夹取**：滚轮连滚、极端视口下的适应倍数都可能算出 0.001 或
//      1000 倍，夹到 `[MIN, MAX]` 才不会把图缩成一个点或撑出一屏空白。

import { clamp } from "~/lib/clamp";
import { useCallback, useMemo, useState } from "react";
import type { NaturalSize } from "~/lib/media/natural-size";

/** 缩放档位：`fit` 适应窗口、`actual` 原始大小（1:1）、`manual` 用户指定。 */
export type ImageZoomMode = "fit" | "actual" | "manual";

/** 最小倍数：再小就只是一个点，没有可看的像素。 */
export const MIN_ZOOM_SCALE = 0.1;

/** 最大倍数：再大只是同一块像素被插值摊开，白占内存。 */
export const MAX_ZOOM_SCALE = 8;

/** 每次「放大 / 缩小」（按钮与滚轮）的倍率。 */
export const ZOOM_STEP = 1.25;

/** 「适应窗口」的倍数上限：不大于原始大小（见文件头第 1 条）。 */
export const FIT_SCALE_CAP = 1;

/**
 * 把一个倍数夹到可用区间；读不到（0 / 负数 / NaN / Infinity）时退回 100%。
 *
 * 导出它是为了**滚轮**这一侧：视图要先算出「下一个倍数」再交给 hook，
 * 而夹取口径必须与 hook 内部同一份（两处各夹一次必然漂移）。
 */
export function clampZoomScale(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return clamp(value, MIN_ZOOM_SCALE, MAX_ZOOM_SCALE);
}

export interface UseImageZoomOptions {
  /** 图片的自然尺寸；`null` = 还没读到（解码中 / 加载失败）。 */
  naturalSize: NaturalSize | null;
  /** 可视区布局宽度（px）；`null` = 还没量到。 */
  viewportWidth: number | null;
  /** 可视区布局高度（px）；`null` = 还没量到。 */
  viewportHeight: number | null;
  /** 可视区单边内边距（px）—— 算「适应窗口」时从可视区里扣掉，默认 0。 */
  padding?: number;
}

export interface ImageZoom {
  /** 当前缩放档位。 */
  mode: ImageZoomMode;
  /** 当前生效倍数（`fit` 档是算出来的适应倍数）。 */
  scale: number;
  /** 展示用百分比（整数）。 */
  percent: number;
  /** 算出来的「适应窗口」倍数；量不到尺寸或视口时为 `null`。 */
  fitScale: number | null;
  /* 下面几个一律声明成**属性箭头类型**（`(): void` 而不是方法签名）：
   * 调用处会直接把它们交给 `onClick`，方法签名会被 `unbound-method` 判为
   * 「脱离对象传递、this 语义不明」。 */
  zoomIn: () => void;
  zoomOut: () => void;
  /** 切到「适应窗口」。 */
  fit: () => void;
  /** 切到「原始大小」（1:1）。 */
  actualSize: () => void;
  /** 在「适应窗口」与「原始大小」之间切换（双击画布用）。 */
  toggleFitActual: () => void;
  /** 直接给一个倍数（滚轮按比例缩放时用），并切到 `manual` 档。 */
  scaleTo: (next: number) => void;
}

/**
 * 用法：把自然尺寸与可视区尺寸交给它，界面上只渲染它给出的 `percent`
 * 与 `scale`，并把按钮接到 `zoomIn` / `fit` / `actualSize` 上。
 */
export function useImageZoom({
  naturalSize,
  viewportWidth,
  viewportHeight,
  padding = 0,
}: UseImageZoomOptions): ImageZoom {
  const [mode, setMode] = useState<ImageZoomMode>("fit");
  const [manualScale, setManualScale] = useState(1);

  const fitScale = useMemo(() => {
    if (!naturalSize || viewportWidth === null || viewportHeight === null) {
      return null;
    }
    const usableWidth = viewportWidth - padding * 2;
    const usableHeight = viewportHeight - padding * 2;
    if (usableWidth <= 0 || usableHeight <= 0) return null;
    const ratio = Math.min(
      usableWidth / naturalSize.width,
      usableHeight / naturalSize.height,
    );
    return clampZoomScale(Math.min(ratio, FIT_SCALE_CAP));
  }, [naturalSize, viewportWidth, viewportHeight, padding]);

  const scale =
    mode === "manual" ? manualScale : mode === "actual" ? 1 : (fitScale ?? 1);

  const scaleTo = useCallback((next: number) => {
    setManualScale(clampZoomScale(next));
    setMode("manual");
  }, []);

  const zoomIn = useCallback(
    () => scaleTo(scale * ZOOM_STEP),
    [scale, scaleTo],
  );
  const zoomOut = useCallback(
    () => scaleTo(scale / ZOOM_STEP),
    [scale, scaleTo],
  );
  const fit = useCallback(() => setMode("fit"), []);
  const actualSize = useCallback(() => setMode("actual"), []);
  const toggleFitActual = useCallback(
    () => setMode((prev) => (prev === "fit" ? "actual" : "fit")),
    [],
  );

  return {
    mode,
    scale,
    percent: Math.round(scale * 100),
    fitScale,
    zoomIn,
    zoomOut,
    fit,
    actualSize,
    toggleFitActual,
    scaleTo,
  };
}
