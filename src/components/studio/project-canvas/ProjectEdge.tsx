"use client";

/* ProjectEdge — 项目画布的连线渲染
 * 在 React Flow 默认 `smoothstep` 之上补「选中节点相关连线」的视觉：上下游加粗提亮、
 * 无关连线压暗。不能用 `defaultEdgeOptions.style`：那套样式是静态的，而关注级别是
 * `useRelatedEdgesHighlight` 逐条写入 `edge.data` 的动态值，React Flow 只把渲染权交给
 * 自定义边组件。渐变 `url(#canvas-edge-gradient)` 原样保留（品牌观感），提亮靠 filter。 */

import React from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { shouldDimEdge, type EdgeFocusRole } from "../canvas/flow-focus-endpoints";
import { readEdgeFocusRole } from "../canvas/hooks/use-related-edges-highlight";

export const ProjectEdge = React.memo(function ProjectEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data } =
    props;

  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const edgeData = data;
  const focusRole: EdgeFocusRole = readEdgeFocusRole({ data: edgeData });
  const focused = focusRole === "upstream" || focusRole === "downstream";
  const dimmed = shouldDimEdge({
    focus: focusRole,
    hasSelection: edgeData?.focusActive === true,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        ...style,
        strokeWidth: focused ? 4 : dimmed ? 2 : 2.5,
        opacity: focused ? 1 : dimmed ? 0.3 : 1,
        /* 提亮而不是换色：连线的渐变是画布的品牌观感，也是「这条线在流动」的
         * 视觉语义，换色会把两者一起丢掉。 */
        filter: focused
          ? "brightness(1.45) drop-shadow(0 0 6px var(--color-edge-focus-halo))"
          : undefined,
      }}
    />
  );
});
