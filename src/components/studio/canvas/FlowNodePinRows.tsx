"use client";
/* TOP PINS section — pure-connection inputs paired with outputs on shared
 * rows (redesign). Extracted from workflow-node.tsx.
 * Inputs (left target Handle) and outputs (right source Handle) are zipped
 * positionally so one 22px row holds both; the longer side's leftover keeps
 * filling trailing rows alone.  Handles are ALWAYS rendered regardless of
 * wire state ("dot stays on permanently" rule). */
import { Handle, Position } from "@xyflow/react";
import { portColor } from "@/lib/comfyui/types";
import { friendlyInputName } from "@/lib/comfyui/node-titles";
import { sanitizeComboLabel } from "../workflow-utils";
import { IoCheckbox, type IOEditContextValue } from "./IOEditContext";
import type { WorkflowNodeData, RawInputMeta } from "../workflow-types";

interface FlowNodePinRowsProps {
  data: WorkflowNodeData;
  io: IOEditContextValue | null;
  rawMeta: Record<string, RawInputMeta>;
  uniqueConnEntries: [string, unknown][];
  outputs: [string, string][];
}

export function FlowNodePinRows({
  data,
  io,
  rawMeta,
  uniqueConnEntries,
  outputs,
}: FlowNodePinRowsProps) {
  return (
    <div
      className="border-b border-white/5 py-0.5"
      style={{ background: "rgba(255,255,255,0.015)" }}
    >
      {Array.from({ length: Math.max(uniqueConnEntries.length, outputs.length) }).map(
        (_, rowIdx) => {
          const inEntry = uniqueConnEntries[rowIdx];
          const outEntry = outputs[rowIdx];
          const inName = inEntry?.[0];
          const outName = outEntry?.[0];
          const outType = outEntry?.[1];

          // Input side — colour by declared slot type, label via the same
          // label / zh-CN / friendly chain the widget rows use（作者 label 优先）。
          const inMeta = inName ? rawMeta[inName] : undefined;
          const inType = inMeta?.type ?? "*";
          const inCol = portColor(inType);
          const inLabel = inName
            ? sanitizeComboLabel(inMeta?.label) ||
              sanitizeComboLabel(inMeta?.localized) ||
              friendlyInputName(inName)
            : "";

          // Output side — colour by `outputs[i][1]`, label via rawOutputs
          // `localized` (zh), else the raw key.
          const outCol = outType ? portColor(outType) : undefined;
          const outRaw = outName
            ? data.rawOutputs?.find((output) => output.name === outName)
            : undefined;
          const outDisplay = outRaw?.localized ?? outName;

          return (
            <div
              // Key includes both names so number-slot ports ("1", "2", …)
              // don't collide inside the array.
              key={`pinrow-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
              className="relative flex h-[22px] items-center pl-5 pr-5 text-[11px]"
              data-pin-input={inName}
              data-pin-output={outName}
            >
              {inEntry && (
                <>
                  <Handle
                    type="target"
                    position={Position.Left}
                    id={inName}
                    /* 可连接：编辑器里「对外参数节点」的线要落到这一行（端口）。
                     * 连上 / 断开都由映射层负责，工作流图本身不因此改动。 */
                    isConnectable
                    className="!h-2.5 !w-2.5 !rounded-full !border !border-(--color-canvas)"
                    style={{
                      left: 5,
                      background: inCol,
                      boxShadow: `0 0 6px ${inCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                    }}
                    title={`${inName} (${inType})`}
                  />
                  {/* IO checkbox for TOP PINS inputs that are UNCONNECTED —
                   * a wired slot gets its value from upstream, so exposing
                   * it as a workflow input is meaningless. */}
                  {io?.ioEditMode && inMeta && !inMeta.isConnection && !inMeta.isBoundary && (
                    <IoCheckbox
                      io={io}
                      ioRef={{
                        nodeId: data.nodeId,
                        hostNodeId: data.hostNodeId,
                        name: inName ?? "",
                        kind: "param",
                        direction: "input",
                        // Prefer the raw port's display label / zh
                        // localized_name so the IO preview resolves to the
                        // meaningful name.
                        label: inMeta?.label ?? inMeta?.localized ?? inName,
                      }}
                    />
                  )}
                  <span
                    className="min-w-0 flex-1 truncate text-left text-[11px] text-zinc-200"
                    title={String(inName)}
                  >
                    {inLabel}
                  </span>
                </>
              )}
              {outEntry && (
                <>
                  <span
                    className="min-w-0 flex-1 truncate text-right text-[11px] text-gray-200"
                    title={`${outName} (${outType})`}
                  >
                    {outDisplay}
                  </span>
                  {/* Output source Handle hidden while in IO-edit mode —
                   * workflow outputs are identified by node, so the
                   * header checkbox is the only handle the author needs. */}
                  {!io?.ioEditMode && (
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={`out:${outName}`}
                      isConnectable={false}
                      className="!h-2.5 !w-2.5 !rounded-full !border !border-(--color-canvas)"
                      style={{
                        right: 5,
                        background: outCol,
                        boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                      }}
                      title={`${outDisplay} (${outType})`}
                    />
                  )}
                </>
              )}
            </div>
          );
        }
      )}
    </div>
  );
}
