// 把「对外参数条目」变成 React Flow 节点（纯函数，无 React、无 IO，§17.2 第①层）。
//
// 每个对外参数一张卡片，位置由宿主节点的画布坐标派生（见 placeParamNodes）；
// 卡片本身不可拖动（位置派生自宿主节点），但**必须可发起连线** —— 端点就是
// 画布端点，拖一条线即完成映射。
//
// `connectable` 必须为真：React Flow 的 <Handle> 把「这一端能不能拉线 / 能不能
// 落线」算作 `handle.connectable && handle.connectableend`，而 `handle.connectable`
// 来自宿主节点的 `node.connectable || nodesConnectable`。此前这里写死
// `connectable: false`，于是卡片上每颗端点都是「不可连」的手不可点状态 ——
// 用户表现为「点击端点拉线会出现禁用标记 / 拉不出线」（ISSUE #355）。

import type { Node } from "@xyflow/react";

import {
  PARAM_NODE_WIDTH,
  paramNodeHeight,
  paramNodeId,
  paramOutputPorts,
  placeParamNodes,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
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
  /** 宿主卡片上**真的画得出来、连得上**的那一行（ioKey 集合）。
   *
   *  被组合控件折叠成逐行参数之后，露出来的行就是全部可连行；反过来，落到被
   *  折叠掉的端口上的候选端点连不上（拖过去只会被闸门判成非法）。视图把宿主
   *  表单实际渲染的行收集起来传进来，候选端点据此收窄。缺省 = 不做收窄。 */
  reachableKeys?: ReadonlySet<string>;
  /** 当前模式；为空 = 禁止连线。 */
  mode: string | null;
  /** 某个条目在当前模式下是否画过线（决定「恢复默认」可用性）。 */
  isManual: (entryId: string) => boolean;
  onReset: (entryId: string) => void;
}

export function buildParamNodes(ctx: BuildParamNodesCtx): Node[] {
  const {
    entries,
    hostPosById,
    mode,
    isManual,
    onReset,
    resolved,
    io,
    reachableKeys,
  } = ctx;
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
    const outputPorts = paramOutputPorts(
      entry,
      io,
      resolved?.[entry.id],
      reachableKeys,
    );
    /* 输入端口行：被组合控件接管的端口不重复列（那一块控件本身就是它们的入口）。
     * 行数同样进几何 —— 少了行还按老高度算，卡片会互相压住。 */
    const data: WorkflowParamNodeData = {
      entryId: entry.id,
      hostNodeId: entry.hostNodeId || entry.nodeId,
      hostNodeTitle: entry.nodeTitle,
      cls: entry.cls,
      label: entry.label,
      classLabel: paramClassStyle(entry.cls).label,
      pins: entry.pins,
      width: PARAM_NODE_WIDTH,
      /* 卡片就是接线面板：**没有模式也能连线**（模式只决定这条线归属哪个命名
       *  空间）。此前这里把 canWire 绑成「有没有模式」，于是未声明模式的工作流上
       *  端点整体不渲染、拖不动，用户看到的就是「点击端点拉线出现禁用标记」。 */
      canWire: true,
      wireManual: isManual(entry.id),
      /* 已落点 = 真的连到宿主卡片的某一行（不是「有没有候选端口」）。 */
      wired: outputPorts.some((port) => port.active && !!port.ioKey),
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
      connectable: true,
      style: {
        width: PARAM_NODE_WIDTH,
        height: paramNodeHeight(outputPorts.length),
      },
      data,
    });
  }
  return out;
}
