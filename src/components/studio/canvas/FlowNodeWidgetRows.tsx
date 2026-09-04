"use client";
/* Widget inputs section — knobs only (every entry carries a widgets_values
 * slot). Extracted from workflow-node.tsx. Pure-connection ports
 * live in FlowNodePinRows; this section renders the scalar/object inputs
 * with their values, including STRING multiline textareas. */
import { Handle, Position } from "@xyflow/react";
import { portColor, inferInputType, inferIsMultiline } from "@/lib/comfyui/types";
import { friendlyInputName } from "@/lib/comfyui/node-titles";
import { renderWidgetValue, valueCellColor, withAlpha, sanitizeComboLabel } from "../workflow-utils";
import { IoCheckbox, type IOEditContextValue } from "./IOEditContext";
import { StringTextarea } from "../StringTextarea";
import type { WorkflowNodeData, RawInputMeta } from "../workflow-types";

interface FlowNodeWidgetRowsProps {
  data: WorkflowNodeData;
  io: IOEditContextValue | null;
  rawMeta: Record<string, RawInputMeta>;
  visibleWidgetEntries: [string, unknown][];
  hasSize: boolean;
}

export function FlowNodeWidgetRows({
  data,
  io,
  rawMeta,
  visibleWidgetEntries,
  hasSize,
}: FlowNodeWidgetRowsProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col py-0.5">
      {visibleWidgetEntries.map(([k, v], idx) => {
        // A row carries a wire only when rawInputs flags it as connected
        // (rare — chiefly subgraph wrapper inputs that double as defaults).
        const isConn = rawMeta[k]?.isConnection === true;
        // Boundary wire: wrapper-exposes-this-slot sentinel (origin_id -10).
        const isBoundary =
          rawMeta[k]?.isBoundary === true || data.boundaryInputs?.has(k) === true;
        // Type always inferred from the JS-typed scalar value (wire-tuple
        // edgeType paths live in the top pins section).
        const inputType = inferInputType(data.classType, k, v);
        const typeCol = portColor(inputType);
        // Display label: zh-CN localized_name → friendly map → raw key.
        // COMBO option lists are stripped by sanitizeComboLabel; boolean
        // toggle descriptors (rgthree Settings) stay intact.
        const meta = rawMeta[k];
        const friendlyLabel =
          sanitizeComboLabel(meta?.localized) ||
          sanitizeComboLabel(meta?.label) ||
          friendlyInputName(k);
        // STRING widgets render as a stacked block (label row + textarea)
        // only when genuinely long / multi-line; short scalars
        // ("auto", "fp16") keep the compact 22px inline row.
        const stringText = typeof v === "string" ? v : "";
        const isStringWidget =
          inputType === "STRING" &&
          (inferIsMultiline(data.classType, k, stringText) ||
            stringText.length >= 32 ||
            stringText.includes("\n"));

        return (
          <div
            // idx appended so ComfyUI number-slot inputs ("1", "2", …)
            // don't collide across rows.
            key={`${k}-${idx}`}
            data-input-key={k}
            data-input-type={inputType}
            className={
              isStringWidget
                ? "group relative flex min-h-0 flex-1 flex-col gap-1.5 pl-5 pr-2 py-1.5 text-[11px]"
                // min-h-[22px] h-auto lets long labels wrap.
                : "group relative flex min-h-[22px] h-auto items-center gap-1.5 pl-5 pr-2 py-0.5 text-[11px]"
            }
          >
            {isConn || isBoundary ? (
              // The Handle IS the dot.  left:5 compensates ReactFlow's
              // translate(50%,-50%) so the dot's centre lands on the node
              // edge.  Unconnected widget rows get NO dot.
              <Handle
                type="target"
                position={Position.Left}
                id={k}
                isConnectable={false}
                className="!h-2.5 !w-2.5 !rounded-full !border !border-(--color-canvas)"
                style={{
                  left: 5,
                  background: typeCol,
                  boxShadow: `0 0 6px ${typeCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                }}
                title={`${k} (${inputType})`}
              />
            ) : null}

            {isStringWidget ? (
              /* STRING stacked block — LABEL + IoCheckbox on top, textarea
               * below claiming the remaining vertical space. */
              <div className="flex shrink-0 items-center gap-1.5">
                {io?.ioEditMode && !isConn && !isBoundary && (
                  <IoCheckbox
                    io={io}
                    ioRef={{ nodeId: data.nodeId, name: k, kind: "widget", direction: "input" }}
                  />
                )}
                <span
                  className="shrink-0 whitespace-normal break-words text-left text-[11px]"
                  style={{ color: isConn ? "var(--color-ink-strong)" : "var(--color-ink-subtle)" }}
                  title={k}
                >
                  {friendlyLabel}
                </span>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {/* Workflow inputs must be UNCONNECTED — skip the checkbox
                 * for wired / boundary slots. */}
                {io?.ioEditMode && !isConn && !isBoundary && (
                  <IoCheckbox
                    io={io}
                    ioRef={{
                      nodeId: data.nodeId,
                      name: k,
                      kind: "widget",
                      direction: "input",
                      label: friendlyLabel,
                    }}
                  />
                )}
                <span
                  className="min-w-0 shrink whitespace-normal break-words text-left text-[11px]"
                  style={{ flex: "0 1 auto", color: isConn ? "var(--color-ink-strong)" : "var(--color-ink-subtle)" }}
                  title={k}
                >
                  {friendlyLabel}
                </span>

                {/* Soft 1px vertical divider between label and value. */}
                <>
                  <span
                    className={
                      isConn
                        ? "h-2 w-px shrink-0 bg-white/5 opacity-50"
                        : "h-2 w-px shrink-0 bg-white/5"
                    }
                    aria-hidden
                  />
                  {/* A widget input that ALSO carries a wire still shows its
                   * control value (ComfyUI never hides it) — only dimmed so
                   * the reader can tell the live value comes from the wire. */}
                  <span
                    className="min-w-0 truncate text-right text-[10.5px] tabular-nums"
                    style={{
                      flex: "1 1 0",
                      color: isConn ? withAlpha(valueCellColor(v)) : valueCellColor(v),
                    }}
                    title={String(v)}
                  >
                    {renderWidgetValue(v)}
                  </span>
                </>
              </div>
            )}
            {/* STRING-widget textbox — STACKED BELOW the LABEL row.
             * <textarea readOnly> beats <div> + Tailwind arbitrary classes
             * (they silently drop in this subtree).  Empty value falls back
             * to a faint （空） placeholder. */}
            {isStringWidget && (
              <div className="flex min-w-0 flex-1 flex-col">
                {stringText.length > 0 ? (
                  <StringTextarea value={stringText} hasSize={hasSize} />
                ) : (
                  <div
                    className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[10.5px] leading-snug text-gray-600"
                    style={{ minHeight: 28 }}
                    title={stringText}
                  >
                    （空）
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
