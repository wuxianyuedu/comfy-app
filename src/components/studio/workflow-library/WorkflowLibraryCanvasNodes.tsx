"use client";

/* 工作流库「画布节点」预览的 React Flow 节点（三列各一个，ISSUE #529）。
 * 节点内部仍是普通 DOM：左列 `WorkflowParamCardColumn`、中间 `LibraryHostCard`、
 * 右列 `WorkflowOutputParamCardColumn`。端点从自绘圆点换成 `<Handle>`、连线换成
 * edge；端点几何复用 `PortHandle`，卡片列与画布节点的端点不会一侧贴边一侧内缩。 */

import { createContext, useContext, memo } from "react";
import type { NodeProps } from "@xyflow/react";

import type { ParamEntry } from "~/lib/workflow/workflow-param-mapping";
import { WorkflowParamCardColumn } from "./WorkflowParamCardColumn";
import { WorkflowOutputParamCardColumn } from "./WorkflowOutputParamCardColumn";
import type { LibraryNodeContent } from "./workflow-library-wire-graph";
import { PortHandle } from "~/components/studio/workflow-form/WorkflowPortHandle";

/** 三列节点的渲染内容（类型收在纯 `.ts` 里，hooks 层也要引用它）。 */
export type { LibraryNodeContent };

export const LibraryNodeContentContext = createContext<LibraryNodeContent | null>(null);

/** 取三列的渲染内容；不在画布里（直接单测某个节点）时返回 null。 */
function useLibraryNodeContent(): LibraryNodeContent | null {
  return useContext(LibraryNodeContentContext);
}

/** 左列：对外参数卡片。
 *
 *  每张卡片的输出端口行挂一颗 **source** handle —— 拖它即「把这个对外参数连到
 *  宿主卡片的某一行」。handle id 取端口的 handle id（库里按端口名给圆点定位，
 *  一个候选一颗点），闸门据此反查契约条目。 */
export const LibraryParamsNode = memo(function LibraryParamsNode(_props: NodeProps) {
  const content = useLibraryNodeContent()?.params;
  if (!content) {
    return null;
  }
  const { cards, canWire, contractEntries, selectedEntryId, onSelect, onReset } = content;
  return (
    <div data-testid="wflib-canvas-node-params">
      <WorkflowParamCardColumn
        canWire={canWire}
        contractEntries={contractEntries}
        endpoint={(port) => (
          <PortHandle
            dir="out"
            id={port.handleId}
            style={{
              right: -(12 + 6),
              top: "50%",
              transform: "translateY(-50%)",
              /* 已连接的圆点实心、未连接的淡一档（与旧口径一致）。 */
              opacity: port.active ? 1 : 0.55,
            }}
            type={port.type}
          />
        )}
        entries={cards.entries}
        io={cards.io}
        isManual={cards.isManual}
        onReset={onReset}
        onSelect={onSelect}
        resolved={cards.resolved}
        selectedEntryId={selectedEntryId}
      />
    </div>
  );
});

/** 右列：对外输出参数卡片。每张卡片左缘一颗 **target** handle —— 宿主输出行的
 *  连线收在这里（方向的合法性由 `isValidConnection` 判）。 */
export const LibraryOutputsNode = memo(function LibraryOutputsNode(_props: NodeProps) {
  const content = useLibraryNodeContent()?.outputs;
  if (!content) {
    return null;
  }
  const { cards, canWire, selectedOutputId, onSelect, onReset } = content;
  return (
    <div data-testid="wflib-canvas-node-outputs">
      <WorkflowOutputParamCardColumn
        canWire={canWire}
        endpoint={(port) => (
          <PortHandle
            dir="in"
            id={port.handleId}
            style={{
              left: -(12 + 6),
              top: "50%",
              transform: "translateY(-50%)",
            }}
            type={port.type}
          />
        )}
        isManual={cards.isManual}
        onReset={onReset}
        onSelect={onSelect}
        outputs={cards.outputs}
        resolved={cards.resolved}
        selectedOutputId={selectedOutputId}
      />
    </div>
  );
});

/** 中间：宿主运行卡片（表单与输出行的端点由它自己渲染）。 */
export const LibraryHostNode = memo(function LibraryHostNode(_props: NodeProps) {
  const content = useLibraryNodeContent()?.host;
  if (!content) {
    return null;
  }
  return <div data-testid="wflib-canvas-node-host">{content.host}</div>;
});

/** 垫在三列之下的**透明背景板**：把画布包围盒撑到面板可视高度。
 *  卡片比视口矮时 fitView 只放大到内容高度，画布底边以下落回面板底色
 *  （ISSUE #596）。这一层无内容、无端口，抬高它不影响端点几何。它不提供
 *  底色（底色由容器与 `bg-canvas` 给），只负责撑尺寸。
 */
export const LibraryBackdropNode = memo(function LibraryBackdropNode(_props: NodeProps) {
  return <div aria-hidden className="h-full w-full" data-testid="wflib-canvas-backdrop" />;
});

/** 契约条目类型（导出给编排层用，避免两处各写一套）。 */
export type { ParamEntry };
