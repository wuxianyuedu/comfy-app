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
import {
  IoCheckbox,
  useWiredPinKeysRegistry,
  type IOEditContextValue,
} from "./IOEditContext";
import type { WorkflowNodeData, RawInputMeta } from "../workflow-types";
import {
  OUTPUT_PORT_HANDLE_PREFIX,
  PORT_ROW_TONES,
  portDotGlow,
  resolvePortRowTone,
  type PortRowTone,
} from "./flow-focus-endpoints";
import {
  NODE_PORT_FOCUS_ACTIVE_KEY,
  readPortFocusRole,
} from "./hooks/use-related-edges-highlight";

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
  /* 选中节点时端口行跟着连线一起变：有连线落到的那一行提亮、端口圆点放大，
   *  没有连线落到的行压暗。级别由 `useRelatedEdgesHighlight` 写在本节点 data 上
   *  （与连线标记同一帧算出），行渲染层只读。 */
  const nodeData = data as unknown as Record<string, unknown>;
  const portFocusActive = nodeData[NODE_PORT_FOCUS_ACTIVE_KEY] === true;
  /* 纯连接输入行同样是合法落点（对外参数落到 `positive_prompt` 这类口上），
   *  一并上报给 IOEdit store（见 useWiredPinKeysRegistry）。 */
  useWiredPinKeysRegistry(
    data.nodeId,
    uniqueConnEntries.map(([key]) => key),
  );
  /* 一行两端的 Handle id 不同（输入名 / `out:<输出名>`），但观感要一致：两端的
   * 级别合成一档 —— focused > related > 「都无关」压暗。 */
  const toneOf = (...handles: (string | undefined)[]): PortRowTone => {
    const roles = handles.map((handle) => readPortFocusRole(nodeData, handle));
    for (const role of roles) {
      const tone = resolvePortRowTone({ role, hasSelection: true });
      if (tone === "focused" || tone === "related") return tone;
    }
    return resolvePortRowTone({ role: "none", hasSelection: portFocusActive });
  };
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

          /* 端口行的观感：两端取一致的一档（见 toneOf）。 */
          const tone = PORT_ROW_TONES[
            toneOf(inName, outName ? `${OUTPUT_PORT_HANDLE_PREFIX}${outName}` : undefined)
          ];

          return (
            <div
              // Key includes both names so number-slot ports ("1", "2", …)
              // don't collide inside the array.
              key={`pinrow-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
              className="relative flex h-[22px] items-center pl-5 pr-5 text-[11px]"
              data-pin-input={inName}
              data-pin-output={outName}
              /* 相关行提亮背景：线加粗了、落到的那一行也跟着亮，视线从线落到行上。
                 无关行压暗是**整行**的（含标签与端口），由 style.opacity 统一施加。 */
              style={{ background: tone.background, opacity: tone.opacity }}
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
                      /* 相关行的端口放大 + 光晕增强：线是接到这一颗点上的。 */
                      width: tone.dotSize,
                      height: tone.dotSize,
                      boxShadow: portDotGlow(inCol, tone.dotGlowStrong),
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
                    className="min-w-0 flex-1 truncate text-left text-[11px]"
                    style={{ color: tone.labelColor, fontWeight: tone.labelWeight }}
                    title={String(inName)}
                  >
                    {inLabel}
                  </span>
                </>
              )}
              {outEntry && (
                <>
                  <span
                    className="min-w-0 flex-1 truncate text-right text-[11px]"
                    style={{ color: tone.labelColor, fontWeight: tone.labelWeight }}
                    title={`${outName} (${outType})`}
                  >
                    {outDisplay}
                  </span>
                  {/* Output source Handle —— **任何视图模式下都必须挂载**。
                   *
                   * 它不只是「拖线的入口」，更是下游那些 `out:<name>` 边的
                   * 锚点：React Flow 在 handleBounds 里找不到边引用的 handle id 时，
                   * 会丢弃整条边并打 error#008 —— 用户看到的就是「这条输出没有
                   * 连线」。IO 编辑模式下曾整个不渲染它（理由：输出按节点勾选，
                   * 端口圆点是多余的视觉噪声），结果切进 IO 编辑那一刻，该节点
                   * 所有下游连线集体消失。
                   *
                   * 保留「不误导作者去连输出口」的原意改为**视觉降级**：IO 编辑
                   * 模式下圆点缩到几乎不可见（只留一点色晕锚点），作者看不到可
                   * 拖的端口，线却照样画得出来。 */}
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`out:${outName}`}
                    isConnectable={false}
                    className="!rounded-full !border !border-(--color-canvas)"
                    style={{
                      right: 5,
                      background: outCol,
                      boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px rgba(255,255,255,0.25)`,
                      ...(io?.ioEditMode
                        ? {
                            /* IO 编辑模式下端点整体缩到几乎不可见（不误导作者去连
                             * 输出口），提亮档只放大 1px 保持「这是同一个锚点」。 */
                            width: tone.dotSize === 12 ? 5 : 4,
                            height: tone.dotSize === 12 ? 5 : 4,
                            opacity: 0.35,
                            right: 0,
                          }
                        : { width: tone.dotSize, height: tone.dotSize }),
                    }}
                    title={`${outDisplay} (${outType})`}
                  />
                </>
              )}
            </div>
          );
        }
      )}
    </div>
  );
}
