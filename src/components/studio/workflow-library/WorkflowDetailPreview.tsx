"use client";

import { useMemo } from "react";
import {
  buildWorkflowPreviewFull,
  FULL_PREVIEW_LEVEL_GAP,
  FULL_PREVIEW_MARGIN,
  FULL_PREVIEW_NODE_H,
  FULL_PREVIEW_NODE_W,
  FULL_PREVIEW_ROW_GAP,
  type WorkflowPreviewNode,
} from "@/lib/comfyui/workflow-preview";

interface WorkflowDetailPreviewProps {
  /** Raw ComfyUI graph object (API or workflow format). */
  graph: Record<string, unknown> | null | undefined;
  className?: string;
}

/**
 * Full-size SVG preview of a ComfyUI workflow graph for the library detail view.
 * Unlike the card thumbnail, this renders every node as a labelled box laid out
 * by longest-path layering, so the user can inspect the complete canvas topology.
 */
export function WorkflowDetailPreview({
  graph,
  className,
}: WorkflowDetailPreviewProps) {
  const preview = useMemo(() => buildWorkflowPreviewFull(graph ?? {}), [graph]);

  if (preview.nodes.length === 0) {
    return (
      <div
        className={
          "flex h-full min-h-[180px] items-center justify-center rounded-xl border border-white/6 bg-white/[0.02] text-xs text-white/40" +
          (className ? ` ${className}` : "")
        }
      >
        暂无节点预览
      </div>
    );
  }

  const byLevel: Record<number, WorkflowPreviewNode[]> = {};
  for (const n of preview.nodes) (byLevel[n.level] ||= []).push(n);
  for (const arr of Object.values(byLevel))
    arr.sort((left, right) => left.row - right.row);

  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of preview.nodes) {
    const arr = byLevel[n.level];
    const row = arr!.indexOf(n);
    pos[n.id] = {
      x:
        FULL_PREVIEW_MARGIN +
        n.level * FULL_PREVIEW_LEVEL_GAP +
        FULL_PREVIEW_NODE_W / 2,
      y:
        FULL_PREVIEW_MARGIN +
        row * FULL_PREVIEW_ROW_GAP +
        FULL_PREVIEW_NODE_H / 2,
    };
  }

  const kindColor: Record<
    WorkflowPreviewNode["kind"],
    { fill: string; stroke: string; text: string; glow: string }
  > = {
    input: {
      fill: "url(#gd-input)",
      stroke: "#38BDF8",
      text: "#E0F2FE",
      glow: "rgba(56,189,248,0.35)",
    },
    process: {
      fill: "url(#gd-process)",
      stroke: "#8B5CF6",
      text: "#EDE9FE",
      glow: "rgba(139,92,246,0.35)",
    },
    output: {
      fill: "url(#gd-output)",
      stroke: "#10B981",
      text: "#D1FAE5",
      glow: "rgba(16,185,129,0.35)",
    },
  };

  return (
    <svg
      viewBox={`0 0 ${preview.width} ${preview.height}`}
      className={"h-full w-full" + (className ? ` ${className}` : "")}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`工作流节点拓扑，共 ${preview.total} 个节点`}
    >
      <defs>
        <linearGradient id="gd-input" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0EA5E9" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
        <linearGradient id="gd-process" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient id="gd-output" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="gd-edge" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(139,92,246,0.5)" />
          <stop offset="100%" stopColor="rgba(16,185,129,0.5)" />
        </linearGradient>
      </defs>

      {/* Edges behind nodes */}
      <g>
        {preview.edges.map((edge, index) => {
          const a = pos[edge.from];
          const b = pos[edge.to];
          if (!a || !b) return null;
          const dx = Math.max(24, (b.x - a.x) * 0.45);
          return (
            <path
              key={`edge-${index}`}
              d={`M ${a.x + FULL_PREVIEW_NODE_W / 2} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x - FULL_PREVIEW_NODE_W / 2} ${b.y}`}
              fill="none"
              stroke="url(#gd-edge)"
              strokeWidth={1.5}
              strokeLinecap="round"
              opacity={0.85}
            />
          );
        })}
      </g>

      {/* Nodes as labelled boxes */}
      <g>
        {preview.nodes.map((node) => {
          const p = pos[node.id];
          const c = kindColor[node.kind];
          const x = p!.x - FULL_PREVIEW_NODE_W / 2;
          const y = p!.y - FULL_PREVIEW_NODE_H / 2;
          return (
            <g key={node.id}>
              <title>{`${node.class_type} · ${node.kind}`}</title>
              <rect
                x={x}
                y={y}
                width={FULL_PREVIEW_NODE_W}
                height={FULL_PREVIEW_NODE_H}
                rx={8}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={1}
                style={{ filter: `drop-shadow(0 0 6px ${c.glow})` }}
              />
              <text
                x={p!.x}
                y={p!.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={c.text}
                fontSize={10}
                fontWeight={500}
                style={{
                  fontFamily: "var(--font-sans), ui-sans-serif, system-ui",
                }}
              >
                {truncateNodeLabel(node.class_type)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function truncateNodeLabel(label: string): string {
  if (label.length <= 16) return label;
  return `${label.slice(0, 14)}…`;
}
