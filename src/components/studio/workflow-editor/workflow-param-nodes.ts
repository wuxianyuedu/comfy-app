// 把「对外参数条目」变成 React Flow 节点（纯函数，无 React、无 IO，§17.2 第①层）。
//
// 每个对外参数一张卡片，位置由宿主节点的画布坐标派生（见 placeParamNodes）；
// 卡片不可拖动、不发起连线（连线由卡片自己的输出端点发起），因此这里把
// `draggable` / `connectable` 关掉，只留 `selectable`。

import type { Node } from "@xyflow/react";

import {
  PARAM_NODE_WIDTH,
  paramNodeHeight,
  paramNodeId,
  placeParamNodes,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";
import type { WorkflowParamNodeData } from "./workflow-param-node-data";

export interface BuildParamNodesCtx {
  entries: readonly ParamEntry[];
  /** 宿主节点（对外参数所属节点）当前的画布坐标。 */
  hostPosById: Record<string, { x: number; y: number } | undefined>;
  /** 当前模式；为空 = 禁止连线。 */
  mode: string | null;
  /** 某个条目在当前模式下是否画过线（决定「恢复默认」可用性）。 */
  isManual: (entryId: string) => boolean;
  onReset: (entryId: string) => void;
}

export function buildParamNodes(ctx: BuildParamNodesCtx): Node[] {
  const { entries, hostPosById, mode, isManual, onReset } = ctx;
  if (entries.length === 0) return [];
  const positions = placeParamNodes(entries, hostPosById);
  const out: Node[] = [];
  for (const entry of entries) {
    const position = positions[paramNodeId(entry.id)];
    if (!position) continue;
    const data: WorkflowParamNodeData = {
      entryId: entry.id,
      hostNodeId: entry.nodeId,
      hostNodeTitle: entry.nodeTitle,
      cls: entry.cls,
      label: entry.label,
      classLabel: paramClassStyle(entry.cls).label,
      pins: entry.pins,
      width: PARAM_NODE_WIDTH,
      canWire: !!mode,
      canReset: !!mode && isManual(entry.id),
      onReset: () => onReset(entry.id),
    };
    out.push({
      id: paramNodeId(entry.id),
      type: "wfParam",
      position,
      /* 高于普通节点：卡片是「接线面板」，被别的节点压住就没法拖线了。 */
      zIndex: 20,
      draggable: false,
      selectable: true,
      connectable: false,
      style: { width: PARAM_NODE_WIDTH, height: paramNodeHeight(entry) },
      data,
    });
  }
  return out;
}
