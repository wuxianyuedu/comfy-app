"use client";

/**
 * BezierEdge — Custom animated edge for workflow connections
 *
 * Renders a smooth bezier curve with:
 *  - Gradient stroke (source color → target color)
 *  - Animated flow dots
 *  - Label on hover (shows connection type)
 */

import { memo } from "react";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";

function BezierEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });

  const label = data?.label as string | undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: "url(#edge-gradient)",
          strokeWidth: 2,
          strokeLinecap: "round",
          opacity: 0.7,
        }}
      />
      {/* Animated flow dot */}
      <circle r="3" fill="#8B5CF6" opacity="0.8">
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>

      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)`,
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 4,
              background: "#1A1030",
              color: "#A99BC7",
              border: "1px solid rgba(139,92,246,0.25)",
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const BezierEdge = memo(BezierEdgeInner);

/** SVG gradient definition — must be included in the canvas wrapper */
export function EdgeGradientDefs() {
  return (
    <defs>
      <linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.9} />
        <stop offset="50%" stopColor="#06B6D4" stopOpacity={0.7} />
        <stop offset="100%" stopColor="#10B981" stopOpacity={0.9} />
      </linearGradient>
    </defs>
  );
}
