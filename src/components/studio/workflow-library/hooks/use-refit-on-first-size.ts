"use client";

// 首帧 fitView 的「量不到尺寸」修复（ISSUE #4579）：画布挂载时所在视图可能整棵
// display:none（页签保活栈），容器读数是 0×0 —— 首帧定向 fitView 会按 0×0 视口
// 算出退化变换（zoom 被钳在 minZoom、三列被平移出可视区），而 `fitted` 照常置真，
// 切回视图后用户看到的就是「只剩网格的空画布」。这里在容器**首次**量到真实尺寸
// 时补一次同口径的定向 fitView；只补 0 → 非 0 的首跳，用户此后主动做的平移 /
// 缩放（以及窗口缩放）都不抢。

import { useEffect, useRef } from "react";
import type { ReactFlowInstance } from "@xyflow/react";

import type { ElementBox } from "~/lib/dom-rect";

import { libraryFitViewOptions } from "./use-library-wire-flow";

/** 量到的是否为「可用于 fitView 的真实尺寸」（隐藏态 / 首帧量测前都不算）。 */
export function hasRealSize(box: ElementBox | null): boolean {
  return box !== null && box.width > 0 && box.height > 0;
}

/**
 * 容器**首次**量到真实尺寸时补一次定向 fitView。`rf` 取 `useReactFlow()` 的
 * 实例（引用稳定）；`onFitted` 与首帧路径共用（fitView 落定后画布才显形）。
 */
export function useRefitOnFirstRealSize(
  rf: Pick<ReactFlowInstance, "fitView">,
  box: ElementBox | null,
  onFitted: () => void,
): void {
  const seenRealSize = useRef(false);
  useEffect(() => {
    if (seenRealSize.current || !hasRealSize(box)) {
      return;
    }
    seenRealSize.current = true;
    void rf.fitView(libraryFitViewOptions()).then(onFitted, onFitted);
  }, [box, rf, onFitted]);
}
