"use client";
/* 子图封装节点的顶部针脚区 —— FlowNodePinRows 的同型件：
 * 纯连接型输入端口（左圆点）与暴露出的输出端口（右圆点）
 * 拉在一行，与普通 WorkflowNode 完全一致。每个声明过的针脚
 * 都常显圆点（always-on），未连线的端口也看得见。
 * 与 FlowNodePinRows 的差异：行不带端口聚焦提亮（子图卡片
 * 不接 useRelatedEdgesHighlight 的级别账），行标签换行不截断
 * （长边界端口标签换多行，完整文本从原生 title 看）。 */
import { Handle, Position } from "@xyflow/react";
import { portColor } from "~/lib/comfyui/types";
import { IoCheckbox, type IOEditContextValue } from "./IOEditContext";
import type { RawInputMeta, RawOutputMeta } from "../workflow-types";

interface SubgraphPinRowsProps {
  connInputs: { inp: RawInputMeta; label: string }[];
  outputs: { out: RawOutputMeta; display: string }[];
  io: IOEditContextValue | null;
  nodeId: string;
  hostNodeId?: string;
}

export function SubgraphPinRows({
  connInputs,
  outputs,
  io,
  nodeId,
  hostNodeId,
}: SubgraphPinRowsProps) {
  /* 顶部 PINS 行：每个声明的输入端口与每个输出端口各占一行，
   *  左右拉链式成对、行高 22px（与普通 WorkflowNode 相同）。 */
  const pinRows = Math.max(connInputs.length, outputs.length);
  if (pinRows === 0) return null;

  return (
    <div
      className="border-border-strong border-b py-0.5"
      style={{ background: "var(--color-subtle)" }}
    >
      {Array.from({ length: pinRows }).map((_, rowIdx) => {
        const inEntry = connInputs[rowIdx];
        const outEntry = outputs[rowIdx];
        const inInp = inEntry?.inp;
        const outMeta = outEntry?.out;
        const inName = inInp?.name;
        const outName = outMeta?.name;
        const inType = inInp?.type ?? "*";
        const outType = outMeta?.type ?? "*";
        const inCol = portColor(inType);
        const outCol = portColor(outType);
        const inLabel = inEntry?.label ?? "";
        const outDisplay = outEntry?.display ?? "";
        return (
          <div
            key={`subpin-${rowIdx}-${inName ?? "_"}-${outName ?? "_"}`}
            /* 长的边界端口标签换行到
             *                    *  多行换行，而不是被裁到 22px。完整理由见 WorkflowNode 内联分支
             *                    *  的注释。 */
            className="relative flex h-auto min-h-5.5 items-center py-0.5 pr-5 pl-5 text-[11px]"
            data-sub-pin-input={inName}
            data-sub-pin-output={outName}
          >
            {inEntry && (
              <>
                <Handle
                  type="target"
                  position={Position.Left}
                  id={inName}
                  isConnectable={false}
                  className="border-port-surface! size-2.5! rounded-full! border!"
                  style={{
                    left: 5,
                    background: inCol,
                    boxShadow: `0 0 6px ${inCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                  }}
                  title={`${inLabel} (${inType})`}
                />
                {/* 已经从父工作流接进线来的子图边界输入（或本身
                 *  就是哨兵边界连线）取值来自上游 —— 它们
                 *  不能被暴露成工作流输入。已连线的槽位
                 *  跳过复选框。 */}
                {io?.ioEditMode &&
                  inName &&
                  !inInp?.isConnection &&
                  !inInp?.isBoundary && (
                    <IoCheckbox
                      io={io}
                      ioRef={{
                        nodeId: String(nodeId),
                        hostNodeId,
                        name: inName,
                        kind: "param",
                        direction: "input",
                      }}
                    />
                  )}
                <span
                  /* 去掉 `truncate`：让长的边界端口标签
                   *  （例如 Settings 封装节点的 `Model: True = 🟡 Safetensors
                   *  | False = 🟣 GGUF` BOOLEAN widget）换成多行，
                   *  而不是被裁掉。完整文本仍能从原生 `title` tooltip 看到。 */
                  className="text-ink-bright min-w-0 flex-1 text-left text-[11px] wrap-break-word whitespace-normal"
                  title={`${inLabel} (${inType})`}
                >
                  {inLabel}
                </span>
              </>
            )}
            {outEntry && (
              <>
                <span
                  /* 与上面边界输入分支同款换行修正。 */
                  className="text-ink-bright min-w-0 flex-1 text-right text-[11px] wrap-break-word whitespace-normal"
                  title={`${outDisplay} (${outType})`}
                >
                  {outDisplay}
                </span>
                {/* 每端口输出复选框已移除；
                 *  工作流输出按节点标识。按节点的输出
                 *  复选框现在住在子图节点的头部。 */}
                {/* 输出端点**任何视图模式下都必须挂载** —— 同
                 *  FlowNodePinRows：它同时是下游 `out:<name>` 边的锚点，
                 *  条件不渲染会让 React Flow 解析不到 handle 而丢掉整条边
                 *  （error#008），画布上表现为「输出没有连线」。
                 *  IO 编辑模式下改用「缩到几乎不可见」代替「不渲染」。 */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`out:${outName}`}
                  isConnectable={false}
                  className="border-port-surface! rounded-full! border!"
                  style={{
                    background: outCol,
                    boxShadow: `0 0 6px ${outCol}AA, inset 0 0 0 1px var(--color-port-surface)`,
                    /* 默认右偏 5px，与左端口那颗的 `left: 5` 对称；IO 编辑模式缩到 4px
                     *  并贴住右边缘（`right: 0`）。**别把 `right` 提到 spread 之前**：
                     *  同一属性会被指定两次，TS 报 2783「此扩张将始终覆盖此属性」。 */
                    ...(io?.ioEditMode
                      ? { width: 4, height: 4, opacity: 0.35, right: 0 }
                      : { width: 10, height: 10, right: 5 }),
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
