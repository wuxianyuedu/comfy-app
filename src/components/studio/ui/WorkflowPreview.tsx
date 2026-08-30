"use client";

import type {
  WorkflowPreview,
  WorkflowPreviewNode,
} from "@/lib/comfyui/workflow-preview";

/**
 * Compact SVG preview of a ComfyUI workflow graph for use on workflow
 * library cards. Input nodes sit on the left, outputs on the right, and
 * processors fill the middle, with edges drawn between them.
 *
 * The visual language mirrors the canvas's port colors so users get an
 * immediate sense of what the workflow looks like without opening it.
 */
export function WorkflowPreview({ preview }: { preview: WorkflowPreview }) {
  if (!preview || preview.nodes.length === 0) return null;

  const { nodes, edges, width, height, total, truncated } = preview;

  // Build a quick id → {x,y} lookup. We compute positions here (not in
  // the lib) so the lib stays free of layout magic numbers and the SVG
  // is the single source of visual truth.
  const padX = 16;
  const padY = 12;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const levelCount = Math.max(1, ...nodes.map((node) => node.level)) + 1;
  const colStep = levelCount > 1 ? innerW / (levelCount - 1) : 0;

  // Group by level to find row positions.
  const byLevel: Record<number, WorkflowPreviewNode[]> = {};
  for (const n of nodes) (byLevel[n.level] ||= []).push(n);
  for (const arr of Object.values(byLevel))
    arr.sort((left, right) => left.row - right.row);
  const maxRows = Math.max(
    1,
    ...Object.values(byLevel).map((arr) => arr.length),
  );

  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const arr = byLevel[n.level];
    const row = arr!.indexOf(n);
    pos[n.id] = {
      x: padX + (levelCount > 1 ? n.level * colStep : innerW / 2),
      y: padY + (maxRows > 1 ? (row / (maxRows - 1)) * innerH : innerH / 2),
    };
  }

  const kindColor: Record<
    WorkflowPreviewNode["kind"],
    { fill: string; stroke: string; glow: string }
  > = {
    input: {
      fill: "url(#g-input)",
      stroke: "#7DD3FC",
      glow: "rgba(125,211,252,0.55)",
    },
    process: {
      fill: "url(#g-process)",
      stroke: "#C4B5FD",
      glow: "rgba(196,181,253,0.55)",
    },
    output: {
      fill: "url(#g-output)",
      stroke: "#6EE7B7",
      glow: "rgba(110,231,183,0.55)",
    },
  };

  const nodeR = 5.5;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none"
      role="img"
      aria-label={`工作流拓扑预览，共 ${total} 个节点${truncated ? "（已简化显示）" : ""}`}
    >
      <defs>
        <radialGradient id="g-input" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#BAE6FD" />
          <stop offset="100%" stopColor="#38BDF8" />
        </radialGradient>
        <radialGradient id="g-process" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#DDD6FE" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </radialGradient>
        <radialGradient id="g-output" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#A7F3D0" />
          <stop offset="100%" stopColor="#10B981" />
        </radialGradient>
        <linearGradient id="g-edge" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(196,181,253,0.45)" />
          <stop offset="100%" stopColor="rgba(110,231,183,0.45)" />
        </linearGradient>
      </defs>

      {/* Subtle grid hint for "this is a node graph" */}
      <g opacity="0.18">
        {[0.25, 0.5, 0.75].map((percent) => (
          <line
            key={`gh-${percent}`}
            x1={padX + percent * innerW}
            y1={padY}
            x2={padX + percent * innerW}
            y2={height - padY}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ))}
      </g>

      {/* Edges first so circles sit on top */}
      <g>
        {edges.map((edge, index) => {
          const a = pos[edge.from];
          const b = pos[edge.to];
          if (!a || !b) return null;
          // Cubic Bezier curve for a nice flow look.
          const dx = Math.max(8, (b.x - a.x) * 0.45);
          return (
            <path
              key={`edge-${index}`}
              d={`M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x - nodeR} ${b.y}`}
              fill="none"
              stroke="url(#g-edge)"
              strokeWidth={1.1}
              strokeLinecap="round"
              opacity={0.85}
            />
          );
        })}
      </g>

      {/* Nodes */}
      <g>
        {nodes.map((node) => {
          const p = pos[node.id];
          const c = kindColor[node.kind];
          return (
            <g key={node.id}>
              <title>{`${node.class_type} · ${node.kind}`}</title>
              <circle
                cx={p!.x}
                cy={p!.y}
                r={nodeR + 1.4}
                fill={c.glow}
                opacity={0.45}
              />
              <circle
                cx={p!.x}
                cy={p!.y}
                r={nodeR}
                fill={c.fill}
                stroke={c.stroke}
                strokeWidth={1.2}
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
