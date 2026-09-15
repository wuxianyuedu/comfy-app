"use client";

/* 工作流库「画布节点」预览的 **React Flow 节点**（三列各一个，ISSUE #529）。
 *
 * 节点内部照旧是普通 DOM：左列是 `WorkflowParamCardColumn`、中间是宿主运行卡片
 * （`LibraryHostCard`）、右列是 `WorkflowOutputParamCardColumn` —— 卡片与表单的
 * 渲染结构一行没改。变的只是**端点**：卡片圆点从自绘 `<span>` 换成真正的
 * `<Handle>`，连线从量 rect 的 SVG 换成真正的 edge。
 *
 * 端点几何复用 `PortHandle`（项目画布同款：12px、半颗骑跨卡片外缘、同款投影）
 * —— 卡片列与画布节点两个 surfaces 的端点不会一边贴边一边内缩。
 */

import { createContext, useContext } from "react";
import type { NodeProps } from "@xyflow/react";

import type { ParamEntry } from "~/lib/workflow-param-mapping";
import { WorkflowParamCardColumn } from "./WorkflowParamCardColumn";
import { WorkflowOutputParamCardColumn } from "./WorkflowOutputParamCardColumn";
import type { LibraryNodeContent } from "./workflow-library-wire-graph";
import { PortHandle } from "../shared/WorkflowPortHandle";

/** 三列节点的渲染内容（类型收在纯 `.ts` 里，hooks 层也要引用它）。 */
export type { LibraryNodeContent };

export const LibraryNodeContentContext = createContext<LibraryNodeContent | null>(
  null,
);

/** 取三列的渲染内容；不在画布里（直接单测某个节点）时返回 null。 */
function useLibraryNodeContent(): LibraryNodeContent | null {
  return useContext(LibraryNodeContentContext);
}

/** 左列：对外参数卡片。
 *
 *  每张卡片的输出端口行挂一颗 **source** handle —— 拖它即「把这个对外参数连到
 *  宿主卡片的某一行」。handle id 取端口的 handle id（库里按端口名给圆点定位，
 *  一个候选一颗点），闸门据此反查契约条目。 */
export function LibraryParamsNode(_props: NodeProps) {
  const content = useLibraryNodeContent()?.params;
  if (!content) return null;
  const { cards, canWire, contractEntries, selectedEntryId, onSelect, onReset } =
    content;
  return (
    <div data-testid="wflib-canvas-node-params">
    <WorkflowParamCardColumn
      entries={cards.entries}
      contractEntries={contractEntries}
      resolved={cards.resolved}
      io={cards.io}
      canWire={canWire}
      selectedEntryId={selectedEntryId}
      onSelect={onSelect}
      isManual={cards.isManual}
      onReset={onReset}
      reachableKeys={cards.reachableKeys}
      endpoint={(port) => (
        <PortHandle
          id={port.handleId}
          dir="out"
          type={port.type}
          style={{
            right: -(12 + 6),
            top: "50%",
            transform: "translateY(-50%)",
            /* 已连接的圆点实心、未连接的淡一档（与旧口径一致）。 */
            opacity: port.active ? 1 : 0.55,
          }}
        />
      )}
    />
    </div>
  );
}

/** 右列：对外输出参数卡片。每张卡片左缘一颗 **target** handle —— 宿主输出行的
 *  连线收在这里（方向的合法性由 `isValidConnection` 判）。 */
export function LibraryOutputsNode(_props: NodeProps) {
  const content = useLibraryNodeContent()?.outputs;
  if (!content) return null;
  const { cards, canWire, selectedOutputId, onSelect, onReset } = content;
  return (
    <div data-testid="wflib-canvas-node-outputs">
    <WorkflowOutputParamCardColumn
      outputs={cards.outputs}
      resolved={cards.resolved}
      canWire={canWire}
      selectedOutputId={selectedOutputId}
      onSelect={onSelect}
      isManual={cards.isManual}
      onReset={onReset}
      endpoint={(port) => (
        <PortHandle
          id={port.handleId}
          dir="in"
          type={port.type}
          style={{
            left: -(12 + 6),
            top: "50%",
            transform: "translateY(-50%)",
          }}
        />
      )}
    />
    </div>
  );
}

/** 中间：宿主运行卡片（表单与输出行的端点由它自己渲染）。 */
export function LibraryHostNode(_props: NodeProps) {
  const content = useLibraryNodeContent()?.host;
  if (!content) return null;
  return <div data-testid="wflib-canvas-node-host">{content.host}</div>;
}

/** 契约条目类型（导出给编排层用，避免两处各写一套）。 */
export type { ParamEntry };
