"use client";

/* ProjectEdge — 项目画布的连线渲染
 *
 * 在 React Flow 默认 `smoothstep` 之上补一层「选中节点相关连线」的视觉：
 * 上游 / 下游加粗并提亮渐变端点的亮度，无关连线在选中态下压暗，让用户一眼看出
 * 选中节点连到了哪里。
 *
 * 为什么不能继续用 `defaultEdgeOptions.style`：那套样式是**静态**的，每帧都
 * 一样，没法按边的关注级别切换；而关注级别是 `useRelatedEdgesHighlight` 逐条写在
 * `edge.data` 上的动态值。React Flow 只对「自定义类型的边」才把渲染权交给组件，
 * 所以这里包一层把 data 读出来算样式。
 *
 * 渐变（`url(#canvas-edge-gradient)`）原样保留：它承载的是项目画布的品牌观感，
 * 提亮通过 `filter` 实现（对渐变同样生效），而不是换一种平面描边。
 */

import React from "react";
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import {
  shouldDimEdge,
  type EdgeFocusRole,
} from "../canvas/flow-focus-endpoints";
import { readEdgeFocusRole } from "../canvas/hooks/use-related-edges-highlight";

export const ProjectEdge = React.memo(function ProjectEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    data,
  } = props;

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
