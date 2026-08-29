"use client";
/* Collapsed-mode handle anchors — extracted from workflow-node.tsx (T12).
 * When a node is collapsed the body is hidden but wires still need an
 * anchor.  Each side collapses to a decorative "cylinder" (a tall pill);
 * underneath it we keep the per-port <Handle> stack as tiny invisible
 * anchors so every wire's id ties to its own anchor and edges never detach
 * when toggling. */
import { Handle, Position } from "@xyflow/react";
import { portColor } from "@/lib/comfyui/types";
import type { WorkflowNodeData } from "../workflow-types";

interface FlowNodeCollapsedAnchorsProps {
  data: WorkflowNodeData;
  orderedEntries: [string, unknown][];
  outputs: [string, string][];
}

export function FlowNodeCollapsedAnchors({
  data,
  orderedEntries,
  outputs,
}: FlowNodeCollapsedAnchorsProps) {
  // Connected inputs (wire tuple `[]`) and connected outputs stay anchored.
  const connectedInputs = orderedEntries.filter(([, v]) => Array.isArray(v));
  const connectedOutputs = outputs.filter(([n]) => data.connectedOutputs?.has(n));
  // Cylinder visual height scales with port count, clamped 16px..64px so
  // it never bleeds past the icon/title bar.
  const cylH = (count: number) => Math.min(64, Math.max(16, 12 + count * 4));

  return (
    <>
      {/* LEFT cylinder — only when there are connected inputs.  Opaque
       *  gray gradient sits on top of the wires (zIndex:10) so the user
       *  can see "my ports are here" on a busy canvas. */}
      {connectedInputs.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: -3,
            top: "50%",
            transform: "translateY(-50%)",
            width: 6,
            height: cylH(connectedInputs.length),
            borderRadius: 999,
            background:
              "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
            border: "1px solid rgba(255,255,255,0.45)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
            zIndex: 10,
          }}
        />
      )}
      {/* RIGHT cylinder — whenever the node declares an output (ComfyUI's
       *  "outputs always visible" rule). */}
      {outputs.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            right: -3,
            top: "50%",
            transform: "translateY(-50%)",
            width: 6,
            height: cylH(outputs.length),
            borderRadius: 999,
            background:
              "linear-gradient(180deg, #d4d4d8 0%, #52525b 50%, #18181b 100%)",
            border: "1px solid rgba(255,255,255,0.45)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.6)",
            zIndex: 10,
          }}
        />
      )}

      {/* Invisible per-port Handles — wires anchor here so live edge
       *  geometry never breaks when toggling collapse.  Hidden via
       *  opacity:0 but `isConnectable:false` to avoid accidental wires. */}
      {connectedInputs.map(([k], idx) => {
        const inputType = (data.rawInputs?.find((raw) => raw.name === k)?.type) ?? "*";
        const col = portColor(inputType);
        const total = connectedInputs.length;
        const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
        return (
          <Handle
            key={`collapsed-in-${k}-${idx}`}
            type="target"
            position={Position.Left}
            id={String(k)}
            isConnectable={false}
            className="!h-2 !w-2 !rounded-full"
            style={{
              left: 0,
              top: `calc(50% + ${offset}px)`,
              background: col,
              opacity: 0,
            }}
            title={`${String(k)} (${inputType})`}
          />
        );
      })}
      {connectedOutputs.map(([name, type], idx) => {
        const col = portColor(type);
        const total = connectedOutputs.length;
        const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
        return (
          <Handle
            key={`collapsed-out-${name}-${idx}`}
            type="source"
            position={Position.Right}
            id={`out:${name}`}
            isConnectable={false}
            className="!h-2 !w-2 !rounded-full"
            style={{
              right: 0,
              top: `calc(50% + ${offset}px)`,
              background: col,
              opacity: 0,
            }}
            title={`Output: ${name} (${type})`}
          />
        );
      })}
    </>
  );
}
