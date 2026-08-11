"use client";

import { BaseEdge, EdgeProps, Position } from "@xyflow/react";

/**
 * WfEdge — ComfyUI-style bezier connection.
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

export function WfEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
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

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ ...style, strokeWidth: 2, opacity: 0.92 }}
      />
      {/* ComfyUI-style hub dot at the curve midpoint. */}
      <circle
        cx={labelX}
        cy={labelY}
        r={3.5}
        fill="rgba(255,255,255,0.55)"
        stroke="none"
        pointerEvents="none"
      />
    </>
  );
}
