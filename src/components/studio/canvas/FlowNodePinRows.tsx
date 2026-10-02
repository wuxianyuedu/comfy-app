"use client";
/* 顶部针脚区 —— 纯连接型输入与输出配对在同一
 * 行上（改版）。从 workflow-node.tsx 抽出。
 * 输入（左侧目标 Handle）与输出（右侧源 Handle）按位置拉在一起
 * 让一行 22px 同时装下两者；较长一侧多出的部分继续
 * 独占后续行。句柄**始终**渲染，无论
 * 连线状态如何（「圆点常显」规则）。 */
import { Handle, Position } from "@xyflow/react";
import { portColor } from "~/lib/comfyui/types";
import { friendlyInputName } from "~/lib/comfyui/node-titles";
import { sanitizeComboLabel } from "../workflow-utils";
import { IoCheckbox, type IOEditContextValue } from "./IOEditContext";
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
      className="border-border-strong border-b py-0.5"
      style={{ background: "var(--color-subtle)" }}
    >
      {Array.from({
        length: Math.max(uniqueConnEntries.length, outputs.length),
      }).map((_, rowIdx) => {
        const inEntry = uniqueConnEntries[rowIdx];
        const outEntry = outputs[rowIdx];
        const inName = inEntry?.[0];
        const outName = outEntry?.[0];
        const outType = outEntry?.[1];

        // 输入侧 —— 按声明的槽位类型着色，标签走与 widget 行
        // 相同的 label / zh-CN / 友好名链（作者 label 优先）。
        const inMeta = inName ? rawMeta[inName] : undefined;
        const inType = inMeta?.type ?? "*";
        const inCol = portColor(inType);
        const inLabel = inName
          ? sanitizeComboLabel(inMeta?.label) ||
            sanitizeComboLabel(inMeta?.localized) ||
            friendlyInputName(inName)
          : "";

        // 输出侧 —— 按 `outputs[i][1]` 着色，标签优先取 rawOutputs 的
        // `localized`（中文），否则用原始 key。
        const outCol = outType ? portColor(outType) : undefined;
        const outRaw = outName
          ? data.rawOutputs?.find((output) => output.name === outName)
          : undefined;
        const outDisplay = outRaw?.localized ?? outName;

        /* 端口行的观感：两端取一致的一档（见 toneOf）。 */
        const tone =
          PORT_ROW_TONES[
            toneOf(
              inName,
              outName ? `${OUTPUT_PORT_HANDLE_PREFIX}${outName}` : undefined,
            )
          ];

        return (
          <div
            // key 同时含两个名字，好让数字槽端口（"1"、"2" …）
            // 不在数组里撞车。
            key={`pinrow-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
            className="relative flex h-5.5 items-center pr-5 pl-5 text-[11px]"
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
                  className="border-port-surface! size-2.5! rounded-full! border!"
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
                {/* 顶部针脚区**未连线**输入的 IO 复选框 ——
                 * 已连线的槽位取值来自上游，把它
                 * 暴露成工作流输入没有意义。 */}
                {io?.ioEditMode &&
                  inMeta &&
                  !inMeta.isConnection &&
                  !inMeta.isBoundary && (
                    <IoCheckbox
                      io={io}
                      ioRef={{
                        nodeId: data.nodeId,
                        hostNodeId: data.hostNodeId,
                        name: inName ?? "",
                        kind: "param",
                        direction: "input",
                      }}
                    />
                  )}
                <span
                  className="min-w-0 flex-1 truncate text-left text-[11px]"
                  style={{
                    color: tone.labelColor,
                    fontWeight: tone.labelWeight,
                  }}
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
                  style={{
                    color: tone.labelColor,
                    fontWeight: tone.labelWeight,
                  }}
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
                  className="border-port-surface! rounded-full! border!"
                  style={{
                    right: 5,
                    background: outCol,
                    boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
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
      })}
    </div>
  );
}
