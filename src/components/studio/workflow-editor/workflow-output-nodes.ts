// 把「对外输出」变成 React Flow 节点与连线（纯函数，无 React、无 IO，§17.2 第①层）。
//
// 与左侧的对外**输入**参数卡片对称：输入说「这个对外参数喂给哪一行」，输出说
// 「这个对外产出从哪一行读」。卡片排在宿主节点**右侧**一列、位置派生自宿主坐标
// （作者拖不动，要挪就挪宿主节点）；端点就是 React Flow 的 <Handle>，拖一条线
// 即完成绑定 —— 绑定写在 `paramMap.output.mode:<模式>`（见
// `~/lib/workflow-output-binding`），与输入侧的 `source` 是两张不同的表。
//
// 线指向的**宿主端**是「当前取值的那一行」（作者没改过时就是该输出自己那一行）。

import type { Edge, Node } from "@xyflow/react";

import { outputNodeId, placeOutputNodes } from "~/lib/workflow-param-mapping";
import {
  hasManualOutputBinding,
  isDefaultOutputBinding,
  resolveOutputSource,
} from "~/lib/workflow-output-binding";
import type { WorkflowIOEntry, WorkflowIOMap } from "~/components/studio/shared/workflow-io";
import type { WorkflowOutputNodeData } from "./workflow-param-node-data";

/** 自动（默认）取值行的描边色 —— 与输入侧的默认线同一套语义。 */
const AUTO_STROKE = "#64748b";
/** 作者改过的取值行的描边色。 */
const MANUAL_STROKE = "#a78bfa";

export interface BuildOutputCardsCtx {
  io: WorkflowIOMap | null | undefined;
  /** 工作流的输出行（`splitWorkflowIO` 的结果，顺序即卡片顺序）。 */
  outputs: readonly (WorkflowIOEntry & { ioKey: string })[];
  /** 模板 paramMap（输出落点覆盖在 `output.mode:<模式>`）。 */
  paramMap: Record<string, unknown>;
  mode: string | null;
  hostPosById: Record<string, { x: number; y: number } | undefined>;
  hostWidthById?: Record<string, number | undefined>;
  /** 画布此刻真的画得出来的落点行（ioKey 集合）；缺省 = 不收窄。 */
  reachableKeys?: ReadonlySet<string>;
  onReset: (outputIoKey: string) => void;
}

export interface OutputWiring {
  nodes: Node[];
  edges: Edge[];
  /** 输出口 ioKey → 当前取值的那一行（`null` = 悬空 / 断开）。 */
  resolved: Record<string, string | null>;
}

/** 每个输出口一张卡片 + 一条「取值行 → 卡片」的连线。 */
export function buildOutputWiring(ctx: BuildOutputCardsCtx): OutputWiring {
  const {
    io,
    outputs,
    paramMap,
    mode,
    hostPosById,
    hostWidthById,
    reachableKeys,
    onReset,
  } = ctx;
  if (outputs.length === 0) return { nodes: [], edges: [], resolved: {} };
  const positions = placeOutputNodes(outputs, hostPosById, hostWidthById);
  const resolved: Record<string, string | null> = {};
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  /* 可落点必须是工作流里真实存在、且当前画得出来的**输出**行：宿主端拿一个不存在
   * 的 handle 会让 React Flow 丢弃整条边（用户看到「线画不出来」）。 */
  const outputKeys = new Set(outputs.map((item) => item.ioKey));

  for (const output of outputs) {
    const position = positions[output.ioKey];
    /* 宿主节点不在当前视图里（下钻到子图内部、顶层画布没有这个 id）→ 不渲染卡片，
     * 也就不可能有指向不存在节点的连线。 */
    if (!position) continue;
    const target = resolveOutputSource(paramMap, output, outputs, mode, io);
    resolved[output.ioKey] =
      target && outputKeys.has(target) && (!reachableKeys || reachableKeys.has(target))
        ? target
        : null;
    const manual = !isDefaultOutputBinding(output, outputs);
    const hasOverride =
      manual || resolveOutputSource(paramMap, output, outputs, mode, io) === null;
    nodes.push({
      id: outputNodeId(output.ioKey),
      type: "wfOutput",
      position,
      zIndex: 20,
      draggable: false,
      selectable: true,
      /* 端点必须可连：React Flow 把「这一端能不能拉线」算作
       *  `handle.connectable && handle.connectableend`，节点上写 false 会让圆点
       *  变成点不动的装饰。 */
      connectable: true,
      style: { width: 200, height: 26 + 22 + 8 },
      data: {
        outputIoKey: output.ioKey,
        hostNodeId: output.nodeId,
        label: outputCardLabel(output),
        portName: (output.name ?? "").trim() || outputCardLabel(output),
        portType: output.type ?? "*",
        width: 200,
        /* 没有模式也能查看（卡片照画），但写入无归属 —— 端点只在有模式时渲染，
         *  与连线闸门同一口径。 */
        canWire: !!mode,
        wireManual: hasOverride,
        wired: !!resolved[output.ioKey],
        canReset: !!mode && hasOverride,
        onReset: () => onReset(output.ioKey),
      } satisfies WorkflowOutputNodeData,
    });
    const source = resolved[output.ioKey];
    if (!source) continue;
    edges.push({
      /* 边 id 含两端：同一个输出口改到别处时是一条新边，不会与旧的共用 key。 */
      id: `oe-${output.ioKey}-${source}`,
      /* 方向与输入侧相反：宿主输出行是起点，卡片是终点（线从节点右侧出来收在
       *  卡片左缘的圆点上）。 */
      source: nodeIdForOutputRow(source, io),
      sourceHandle: source,
      target: outputNodeId(output.ioKey),
      targetHandle: output.ioKey,
      type: "default",
      selectable: true,
      deletable: true,
      animated: false,
      style: {
        stroke: manual ? MANUAL_STROKE : AUTO_STROKE,
        strokeWidth: manual ? 2.5 : 2,
        strokeDasharray: manual ? undefined : "6 4",
        opacity: manual ? 1 : 0.75,
      },
      data: { outputIoKey: output.ioKey, manual, paramMap: true },
    });
  }
  return { nodes, edges, resolved };
}

/** 一个输出口是否被作者在这个模式下改过（含显式断开）。 */
export function outputBindingOverridden(
  paramMap: Record<string, unknown>,
  outputIoKey: string,
  mode: string | null,
): boolean {
  if (!mode) return false;
  return hasManualOutputBinding(paramMap, mode)
    ? manualKeys(paramMap, mode).has(outputIoKey)
    : false;
}

/** 该模式下被改过的输出口集合（内部用；避免逐口重算整表）。 */
function manualKeys(
  paramMap: Record<string, unknown>,
  mode: string,
): Set<string> {
  const ns = paramMap.output;
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) return new Set();
  const table = (ns as Record<string, unknown>)[`mode:${mode}`];
  if (!table || typeof table !== "object" || Array.isArray(table))
    return new Set();
  return new Set(Object.keys(table));
}

/** 取值行所属的宿主节点 id（ioKey 形如 `<nodeId>::output::<name>`）。 */
function nodeIdForOutputRow(
  ioKey: string,
  io: WorkflowIOMap | null | undefined,
): string {
  return io?.[ioKey]?.nodeId ?? ioKey.split("::")[0] ?? ioKey;
}

/** 卡片标题：作者改了名就用作者的名字，否则「输出」（与库内那一列同口径）。 */
function outputCardLabel(output: WorkflowIOEntry & { ioKey: string }): string {
  const label = (output.label ?? "").trim();
  const name = (output.name ?? "").trim();
  return label && label !== name ? label : "输出";
}
