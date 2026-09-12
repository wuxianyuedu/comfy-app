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
import {
  PORT_ROW_TONES,
  portDotGlow,
  resolvePortRowTone,
} from "./flow-focus-endpoints";
import {
  NODE_PORT_FOCUS_ACTIVE_KEY,
  readPortFocusRole,
} from "./hooks/use-related-edges-highlight";
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
  /* 选中节点时端口行跟着连线一起变（判据与连线同源，见 FlowNodePinRows）：
   *  有连线落到的那一行提亮、端点放大，没有落到的行压暗。级别由
   *  `useRelatedEdgesHighlight` 写在本节点 data 上，行渲染层只读。 */
  const nodeData = data as unknown as Record<string, unknown>;
  const portFocusActive = nodeData[NODE_PORT_FOCUS_ACTIVE_KEY] === true;
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
        // Display label: 工作流 JSON 里作者写的 label（英文业务名）优先于
        // ComfyUI 的 zh-CN localized_name —— 与该 pin 在 IO 列表 / 运行期
        // 表单里的取法保持一致（label → localized → name）。localized_name
        // 是通用词（"图像"），排前面会让同一节点上多个 pin 长得一模一样。
        // COMBO 候选串由 sanitizeComboLabel 剥掉；BOOLEAN 描述串（rgthree
        // Settings）保留。
        const meta = rawMeta[k];
        const friendlyLabel =
          sanitizeComboLabel(meta?.label) ||
          sanitizeComboLabel(meta?.localized) ||
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

        /* 这一行的观感：widget 行的 Handle id 就是输入名（无前缀）。档位映射收口
         * 在 `PORT_ROW_TONES`（与连接行共用同一张表，避免两处各写一套三元链）。 */
        const tone =
          PORT_ROW_TONES[
            resolvePortRowTone({
              role: readPortFocusRole(nodeData, k),
              hasSelection: portFocusActive,
            })
          ];

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
            /* 相关行提亮背景、无关行整行压暗（与 FlowNodePinRows 同一张表）。 */
            style={{ background: tone.background, opacity: tone.opacity }}
          >
            {/* 每行都挂一个 target Handle，映射线（对外参数 → 本行）才有锚点：
                React Flow 找不到 handle 会丢弃整条边并打 error#008。未连线的行
                端点保持**完全透明** —— 直接可见的紫点曾经被当成渲染 bug，所以
                这里沿用「没连线就不显示圆点」的观感，只保留连线能力。 */}
            <Handle
              type="target"
              position={Position.Left}
              id={k}
              isConnectable
              className="!h-2.5 !w-2.5 !rounded-full !border"
              style={{
                left: 5,
                background: typeCol,
                opacity: isConn || isBoundary ? 1 : 0,
                /* 相关行的端点放大 + 光晕增强（无连线的行端点仍完全透明）。 */
                width: tone.dotSize,
                height: tone.dotSize,
                boxShadow:
                  isConn || isBoundary
                    ? portDotGlow(typeCol, tone.dotGlowStrong)
                    : undefined,
                borderColor: isConn || isBoundary ? "var(--color-canvas)" : "transparent",
              }}
              title={`${k} (${inputType})`}
            />

            {isStringWidget ? (
              /* STRING stacked block — LABEL + IoCheckbox on top, textarea
               * below claiming the remaining vertical space. */
              <div className="flex shrink-0 items-center gap-1.5">
                {io?.ioEditMode && !isConn && !isBoundary && (
                  <IoCheckbox
                    io={io}
                    ioRef={{
                      nodeId: data.nodeId,
                      hostNodeId: data.hostNodeId,
                      name: k,
                      kind: "widget",
                      direction: "input",
                    }}
                  />
                )}
                <span
                  className="shrink-0 whitespace-normal break-words text-left text-[11px]"
                  style={{
                    /* 提亮档统一走表里的色；其余行沿用「连线行比普通行重一档」的
                     * 既有口径（`ink-strong` / `ink-subtle`）。 */
                    color: tone.background
                      ? tone.labelColor
                      : isConn
                        ? "var(--color-ink-strong)"
                        : "var(--color-ink-subtle)",
                    fontWeight: tone.labelWeight,
                  }}
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
                      hostNodeId: data.hostNodeId,
                      name: k,
                      kind: "widget",
                      direction: "input",
                      label: friendlyLabel,
                    }}
                  />
                )}
                <span
                  className="min-w-0 shrink whitespace-normal break-words text-left text-[11px]"
                  style={{
                    flex: "0 1 auto",
                    color: tone.background
                      ? tone.labelColor
                      : isConn
                        ? "var(--color-ink-strong)"
                        : "var(--color-ink-subtle)",
                    fontWeight: tone.labelWeight,
                  }}
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
