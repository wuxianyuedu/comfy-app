"use client";
/* Extracted small presentational chips — originally inside WorkflowCanvasEditor.tsx. */
import React, { useMemo } from "react";
import type { WorkflowIOMap } from "@/components/studio/shared/workflow-io";
export function RequiredSummary({ io }: { io: WorkflowIOMap | null }) {
  const counts = useMemo(() => {
    let required = 0;
    let optional = 0;
    if (!io) return { required, optional };
    for (const e of Object.values(io)) {
      if (!e || e.direction !== "input") continue;
      if (e.kind !== "widget") continue;
      if (e.required) required++;
      else optional++;
    }
    return { required, optional };
  }, [io]);
  return (
    <span className="ml-2 inline-flex items-center gap-1.5">
      <span className="rounded border border-red-400/40 bg-red-500/15 px-1.5 py-px font-mono text-[10px] text-red-300">
        必填 {counts.required}
      </span>
      <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-px font-mono text-[10px] text-gray-400">
        可选 {counts.optional}
      </span>
    </span>
  );
}

/* ── rgthree Fast Groups Bypasser integration (2026-08-09) ──
 * rgthree's `Fast Groups Bypasser` is a utility node whose LiteGraph
 * definition carries ZERO inputs — its entire body is computed at
 * runtime by scanning the graph for groups matching the node's
 * `properties` (matchTitle, matchColors, sort, ...).  We replicate
 * that runtime here so the node renders the same way it does inside
 * ComfyUI + rgthree's frontend:
 *
 *   1. Read groups from the editor's detail (single source of truth).
 *   2. Filter by `matchTitle` (case-insensitive substring).  rgthree
 *      also supports a `matchColors` palette, but the property is a
 *      free-form string ("cyan", "#8AA", …) and the matching rule is
 *      perceptual; for v1 we keep the title filter (which is what
 *      the user actually configures 99% of the time) and skip colour.
 *   3. Sort alphanumerically by group title (rgthree default; the
 *      `sort` property is honoured when it parses to a known mode).
 *   4. Render one toggle row per match, label `Enable <matchTitle><idx>`
 *      (zero-padded to at least 2 digits), with a toggle bound to the
 *      group's bypass state.
 *   5. Toggle click → optimistic local override + PATCH
 *      `/api/workflows/{id}` with `{groups:[{id, bypass}]}`.  The
 *      route writes `rawJson.groups[i].flags.bypass` and invalidates
 *      the detail cache.
 */
export function Chip({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: "2px 7px",
        borderRadius: 999,
        background: `${color}1f`,
        border: `1px solid ${color}55`,
        color,
        letterSpacing: 0.2,
      }}
    >
      {label}
    </span>
  );
}

/** Body for rgthree's `Fast Groups Bypasser`.  Renders the matched
 *  groups as toggle rows that flip the group's `flags.bypass` on click.
 *  Matches the rgthree label convention: "Enable <matchTitle><idx>". */
export function FrontendOnlyBadge() {
  return (
    <div
      className="comfy-node__frontend-only"
      style={{
        display: "inline-block",
        alignSelf: "flex-start",
        marginTop: 4,
        marginLeft: 2,
        padding: "1px 5px",
        fontSize: 9,
        lineHeight: 1.2,
        fontFamily: '"SF Mono", ui-monospace, monospace',
        fontStyle: "italic",
        color: "rgba(255, 255, 255, 0.42)",
        letterSpacing: 0.2,
        border: "1px solid rgba(255, 255, 255, 0.16)",
        borderRadius: 4,
        pointerEvents: "none",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
      title="此节点仅在浏览器前端运行（无后端执行）"
    >
      frontend_only
    </div>
  );
}

/* NodeIdChip — right-aligned `#<nodeId>` badge inside a node's header
 *  (2026-08-10).  Tapping it opens the NodeJsonPopover pinned next to
 *  the chip, showing the literal `detail.graph[nodeId]` entry.  Two
 *  variants:
 *    • "node"     — plain grey/teal text (matches the previous WorkflowNode
 *                   appearance).
 *    • "subgraph" — uppercase violet tint, matching WorkflowSubgraphNode's
 *                   prior look.
 *  Implementation notes:
 *   • Native `<button>` (not `<div role="button">`) — semantically the
 *     right element, no extra a11y wiring needed.
 *   • `e.stopPropagation()` on BOTH onClick AND onMouseDown — React Flow
 *     attaches drag listeners on the node root, and double-click on the
 *     node would otherwise trigger drill-down.  Also need to swallow
 *     the onPointerDown so a press-and-drag never starts a pan from the
 *     chip's bounding box.
 *   • `type="button"` so the chip never accidentally submits an
 *     enclosing <form> (defensive — no forms today, but cheap to lock).
 *   • Visual feedback: chip becomes dotted-underline + brighter on
 *     hover/focus so the click affordance reads without a label. */
