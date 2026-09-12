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
  paramOutputPorts,
  placeParamNodes,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import { inputRowsForEntry } from "~/lib/workflow-param-input-rows";
import { paramClassStyle } from "../workflow-library/workflow-param-mapping-ui";
import type { WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import type { WorkflowParamNodeData } from "./workflow-param-node-data";

export interface BuildParamNodesCtx {
  entries: readonly ParamEntry[];
  /** 宿主节点（对外参数所属节点）当前的画布坐标。 */
  hostPosById: Record<string, { x: number; y: number } | undefined>;
  /** 当前模式下生效的「条目 id → 目标 ioKey」—— 卡片上那个**带类型的输出
   *  端口**的类型由它决定（同一个「尺寸」口落到 `width` 是 INT、落到
   *  `resolution_preset` 是 COMBO）。缺省时按未连线处理（退到候选端口）。 */
  resolved?: Record<string, string | null>;
  /** workflowIO：反查落点端口的类型用（不切分 ioKey）。 */
  io?: WorkflowIOMap | null;
  /** 宿主表单把哪些端口交给了组合控件（卡片不再重复列它们；连线仍可落到
   *  那一块控件上）。缺省 = 没有组合控件。 */
  groupedKeys?: ReadonlySet<string>;
  /** 当前模式；为空 = 禁止连线。 */
  mode: string | null;
  /** 某个条目在当前模式下是否画过线（决定「恢复默认」可用性）。 */
  isManual: (entryId: string) => boolean;
  onReset: (entryId: string) => void;
}

export function buildParamNodes(ctx: BuildParamNodesCtx): Node[] {
  const { entries, hostPosById, mode, isManual, onReset, resolved, io, groupedKeys } =
    ctx;
  if (entries.length === 0) return [];
  const positions = placeParamNodes(entries, hostPosById);
  const out: Node[] = [];
  for (const entry of entries) {
    const position = positions[paramNodeId(entry.id)];
    /* 宿主节点不在当前视图里（下钻到子图内部、顶层画布没有这个 id）→ 不渲染
     * 卡片，也就不可能有指向不存在节点的连线。 */
    if (!position) continue;
    /* 输出端口：一个候选一颗圆点（类型取自**真正落到的那个端口**，未连线时逐个
     * 列出候选）。卡片高度与它同口径 —— 视图多画一行而几何没跟上，卡片就会互
     * 相压住。 */
    const outputPorts = paramOutputPorts(entry, io, resolved?.[entry.id]);
    /* 输入端口行：被组合控件接管的端口不重复列（那一块控件本身就是它们的入口）。
     * 行数同样进几何 —— 少了行还按老高度算，卡片会互相压住。 */
    const inputRows = inputRowsForEntry(entry, { groupedKeys });
    const data: WorkflowParamNodeData = {
      entryId: entry.id,
      hostNodeId: entry.nodeId,
      hostNodeTitle: entry.nodeTitle,
      cls: entry.cls,
      label: entry.label,
      classLabel: paramClassStyle(entry.cls).label,
      pins: entry.pins,
      inputRows,
      width: PARAM_NODE_WIDTH,
      canWire: !!mode,
      noModeHint: !mode,
      canReset: !!mode && isManual(entry.id),
      onReset: () => onReset(entry.id),
      outputPorts,
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
      style: {
        width: PARAM_NODE_WIDTH,
        height: paramNodeHeight(entry, outputPorts.length, inputRows.length),
      },
      data,
    });
  }
  return out;
}
