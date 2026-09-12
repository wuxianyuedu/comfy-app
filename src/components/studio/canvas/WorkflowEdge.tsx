"use client";

import React from "react";
import { BaseEdge, type EdgeProps, Position } from "@xyflow/react";
import { shouldDimEdge, type EdgeFocusRole } from "./flow-focus-endpoints";
import { readEdgeFocusRole } from "./hooks/use-related-edges-highlight";

/**
 * WorkflowEdge — ComfyUI-style bezier connection.
 *
 * Why we *don't* use React Flow's built-in `getBezierPath`:
 *
 *   The built-in algorithm hard-codes the control-point offset based on
 *   the *distance* between source and target.  For short L→R or T→B
 *   links the offset collapses to a few pixels, so the curve reads as a
 *   straight line — visually identical to no edge-style at all.
 *
 *   ComfyUI's lit-renderer instead always pulls the control points by a
 *   fixed-ish offset in the **direction the handle faces**, regardless of
 *   distance.  We do the same here.
 *
 *   Result:
 *     • L→R / R→L edges get a clean S-curve anchored 100 px off each end.
 *     • T→B / B→T (vertical) edges ALSO curve because the offset is in
 *       the *handle* direction (vertical), not the source→target axis.
 *     • Diagonal edges split the offset between x and y.
 *
 * The data model (id / source / target / handles / style) is untouched
 * — this component only controls how the curve is rendered.
 */
const HANDLE_OUT: Record<Position, [number, number]> = {
  [Position.Left]: [-1, 0],
  [Position.Right]: [1, 0],
  [Position.Top]: [0, -1],
  [Position.Bottom]: [0, 1],
};

/** Tunable: how far each control point is pulled along the handle axis. */
const MIN_OFFSET = 80;
const MAX_OFFSET = 240;
const OFFSET_RATIO = 0.55;

function pickOffset(sx: number, sy: number, tx: number, ty: number) {
  // Use Manhattan-ish distance along the longer axis so very short
  // wires still get a visible bend, but very long wires don't whip
  // around into giant C-shapes.
  const dx = Math.abs(tx - sx);
  const dy = Math.abs(ty - sy);
  const longAxis = Math.max(dx, dy);
  const mag = Math.max(MIN_OFFSET, Math.min(MAX_OFFSET, longAxis * OFFSET_RATIO));
  return mag;
}

/** Cubic-bezier midpoint at t = 0.5. */
function bezierMidpoint(
  p0x: number, p0y: number,
  p1x: number, p1y: number,
  p2x: number, p2y: number,
  p3x: number, p3y: number,
): [number, number] {
  const x = (p0x + 3 * p1x + 3 * p2x + p3x) / 8;
  const y = (p0y + 3 * p1y + 3 * p2y + p3y) / 8;
  return [x, y];
}

/** 选中态下的提亮公式：把线色朝白色插值 45%。
 *
 *  为什么是「提亮」而不是「换色」：连线的颜色承载着数据类型的语义
 *  （IMAGE / MODEL / LATENT…，见 portColor），换成品牌色会把这个语义抹掉，
 *  用户反而更难判断「选中节点连过去的到底是什么」。提亮只改明度，保留色相。 */
const FOCUS_LIGHTEN_RATIO = 0.45;

function focusColor(color: string): string {
  const rgb = parseHexColor(color);
  if (!rgb) return "#ffffff";
  const mix = (channel: number) =>
    Math.round(channel + (255 - channel) * FOCUS_LIGHTEN_RATIO);
  return `rgb(${mix(rgb[0])}, ${mix(rgb[1])}, ${mix(rgb[2])})`;
}

/** 解析 `#rgb` / `#rrggbb`；其它写法（`url(#grad)`、`rgb(...)`）返回 null。 */
function parseHexColor(color: string): [number, number, number] | null {
  const hex = color.trim();
  if (!hex.startsWith("#")) return null;
  const body = hex.slice(1);
  if (body.length === 3) {
    const [r, g, b] = body.split("");
    if (!r || !g || !b) return null;
    return [
      Number.parseInt(r + r, 16),
      Number.parseInt(g + g, 16),
      Number.parseInt(b + b, 16),
    ];
  }
  if (body.length === 6) {
    const value = Number.parseInt(body, 16);
    if (Number.isNaN(value)) return null;
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  }
  return null;
}

export const WorkflowEdge = React.memo(function WorkflowEdge(props: EdgeProps) {
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

  const sPos = sourcePosition ?? Position.Right;
  const tPos = targetPosition ?? Position.Left;

  const sOut = HANDLE_OUT[sPos] ?? [1, 0];
  const tOut = HANDLE_OUT[tPos] ?? [-1, 0];

  const offset = pickOffset(sourceX, sourceY, targetX, targetY);

  const c1x = sourceX + sOut[0] * offset;
  const c1y = sourceY + sOut[1] * offset;
  const c2x = targetX + tOut[0] * offset;
  const c2y = targetY + tOut[1] * offset;

  const edgePath = `M ${sourceX},${sourceY} C ${c1x},${c1y} ${c2x},${c2y} ${targetX},${targetY}`;
  const [labelX, labelY] = bezierMidpoint(
    sourceX, sourceY,
    c1x, c1y,
    c2x, c2y,
    targetX, targetY,
  );

  /* 选中节点的相关连线：加粗 + 提亮，其余连线在选中态下降噪，让「这个节点连到
   * 哪里」一眼可读。关注级别由 `useRelatedEdgesHighlight` 写在 edge.data 上；
   * 没有选中任何节点时全图都是 "none"，观感与改动前完全一致。 */
  const edgeData = data;
  const focusRole: EdgeFocusRole = readEdgeFocusRole({ data: edgeData });
  const focused = focusRole === "upstream" || focusRole === "downstream";
  /* 画布是否有选中项由 hook 写在边数据上（每条边都读同一份全局值）——边渲染层
   * 拿不到「选中了什么」，只有这个开关能告诉它「现在该给无关连线降噪了」。 */
  const hasSelection = edgeData?.focusActive === true;
  const dimmed = shouldDimEdge({ focus: focusRole, hasSelection });
  const wireStroke = style?.stroke ?? "rgba(167,139,250,1)";
  /* 提亮：把线的颜色往白里推，而不是换一种颜色 —— 换色会让「这是 IMAGE 线还是
   *  MODEL 线」的类型语义丢失，而类型颜色正是用户读图的依据。 */
  const focusStroke = focusColor(wireStroke);

  return (
    <>
      {/* outer "glow" layer so a thin 2.5px stroke still reads
       *  as a visible wire on the dark canvas (especially for the small set of
       *  top-level edges that survive when subgraph inner nodes aren't
       *  stitched into the rendered graph).  Painted first so the crisp
       *  foreground stroke sits on top of its blurred halo. */}
      <BaseEdge
        id={`${id}-glow`}
        path={edgePath}
        style={{
          ...style,
          stroke: focused ? focusStroke : wireStroke,
          strokeWidth: focused ? 9 : 6,
          opacity: focused ? 0.55 : dimmed ? 0.16 : 0.35,
          filter: focused ? "blur(3px)" : "blur(2.5px)",
        }}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: focused ? focusStroke : wireStroke,
          strokeWidth: focused ? 4 : dimmed ? 2 : 2.5,
          opacity: focused ? 1 : dimmed ? 0.45 : 1,
        }}
      />
      {/* ComfyUI-style hub dot at the curve midpoint.  Slightly larger
       *  (r=4) and brighter than 's r=3.5 / 0.55 so it survives at low
       *  zoom levels when the wire itself is just a couple of screen pixels.
       *  相关连线上的圆点同步放大 —— 线被加粗后原尺寸的点会「缩」进去。 */}
      <circle
        cx={labelX}
        cy={labelY}
        r={focused ? 5 : 4}
        fill={focused ? "#ffffff" : "rgba(255,255,255,0.85)"}
        stroke={focused ? focusStroke : "rgba(167,139,250,0.9)"}
        strokeWidth={focused ? 2 : 1}
        opacity={focused ? 1 : dimmed ? 0.5 : 1}
        pointerEvents="none"
      />
    </>
  );
});
