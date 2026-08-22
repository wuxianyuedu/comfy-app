"use client";

/**
 * GraphPreview — 只读 mini 节点画布，用于 SourceModal 的「节点画布」tab。
 *
 * 2026-08-12 R78: 用户升级工作流后，希望同时能可视化查看 API graph
 * 与 RAW (LiteGraph) 两种形态的节点图，并能来回切换。
 *
 * 数据形态：
 *   • RAW (LiteGraph JSON)：{ nodes: [{id, type, pos:[x,y], size:[w,h], ...}],
 *                            links: [[id, originId, originSlot, targetId, targetSlot, type]] }
 *   • API (ComfyUI /prompt)：{ "<nodeId>": { class_type, inputs, widgets_values, ... } }
 *
 * 实现要点：
 *   • RAW 直接用 nodes[].pos 作为布局；links 转 RF edges。
 *   • API 没有 pos — 用最长路径层布局（Kahn BFS + level，借鉴
 *     lib/comfyui/workflow.ts:buildWorkflowPreview 的算法，但不限 14 节点）。
 *   • 节点盒子用极简 MiniWfNode：标题 + 类型 + 端口圆点（无 widget 交互）。
 *   • 边直接复用 src/components/updream/WfEdge.tsx 项目的自写贝塞尔。
 *   • 端口颜色用 lib/comfyui/types.ts 的 portColor(type)。
 */

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { WfEdge } from "./WfEdge";
import { portColor } from "@/lib/comfyui/types";

// ──────────────────────────────────────────────────────────────────────────
// 类型与常量
// ──────────────────────────────────────────────────────────────────────────

/** 输入角色节点（CheckpointLoader / VAELoader / LoadImage …） */
const INPUT_CLASSES = new Set([
  "CheckpointLoaderSimple",
  "CheckpointLoader",
  "VAELoader",
  "LoraLoader",
  "CLIPLoader",
  "ControlNetLoader",
  "UpscaleModelLoader",
  "LoadImage",
  "LoadImageMask",
  "CLIPTextEncode",
  "CLIPTextEncodeSDXL",
  "CLIPTextEncodeSDXLRefiner",
  "EmptyLatentImage",
  "EmptySD3LatentImage",
  "LatentFromImage",
  "ImageInput",
  "VHS_VideoCombine",
  "ImageBatch",
  "ImageScale",
  "ImagePadForOutpaint",
]);
/** 输出角色节点（SaveImage / PreviewImage / …） */
const OUTPUT_CLASSES = new Set([
  "SaveImage",
  "PreviewImage",
  "SaveLatentImage",
  "SaveAnimatedWEBP",
  "SaveAnimatedPNG",
  "VHS_VideoSave",
  "SaveVideo",
  "SaveAudio",
]);

function classifyNode(classType: string): "input" | "output" | "process" {
  if (INPUT_CLASSES.has(classType)) return "input";
  if (OUTPUT_CLASSES.has(classType)) return "output";
  return "process";
}

// ComfyUI-style mini node box
const NODE_W = 180;
const NODE_H = 56;
const COL_STEP = 240;
const ROW_STEP = 90;
const PAD_X = 40;
const PAD_Y = 40;

// ──────────────────────────────────────────────────────────────────────────
// RawJsonNode data: title/classType/role/inputs/outputs
// ──────────────────────────────────────────────────────────────────────────

interface MiniNodeData {
  title: string;
  classType: string;
  role: "input" | "output" | "process";
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  /** Index signature satisfies @xyflow/react's `Node<Record<string, unknown>>` constraint. */
  [key: string]: unknown;
}

// ──────────────────────────────────────────────────────────────────────────
// MiniWfNode — 极简只读节点盒子
// ──────────────────────────────────────────────────────────────────────────

function MiniWfNode({ data }: NodeProps<Node<MiniNodeData>>) {
  const roleColor =
    data.role === "input"
      ? { border: "border-emerald-500/60", accent: "bg-emerald-500/15", label: "text-emerald-300" }
      : data.role === "output"
      ? { border: "border-orange-500/60", accent: "bg-orange-500/15", label: "text-orange-300" }
      : { border: "border-violet-500/60", accent: "bg-violet-500/15", label: "text-violet-300" };
  return (
    <div
      className={`overflow-hidden rounded-lg border ${roleColor.border} bg-[#1A1A22] shadow-[0_4px_14px_rgba(0,0,0,0.45)]`}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <div className={`flex h-7 items-center gap-2 px-2 ${roleColor.accent}`}>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-300">
          {data.title}
        </span>
        <span className={`ml-auto text-[9px] ${roleColor.label}`}>{data.role}</span>
      </div>
      <div className="relative flex h-[calc(56px-28px)] px-2 py-1.5">
        <div className="flex flex-1 flex-col justify-around">
          {data.inputs.map((p) => (
            <div key={`in-${p.name}`} className="relative flex items-center gap-1.5">
              <Handle
                id={`in-${p.name}`}
                type="target"
                position={Position.Left}
                style={{ background: portColor(p.type), width: 8, height: 8, left: -4 }}
              />
              <span className="truncate text-[10px] text-gray-400">{p.name}</span>
            </div>
          ))}
        </div>
        <div className="flex w-px bg-white/[0.06]" />
        <div className="flex flex-1 flex-col justify-around">
          {data.outputs.map((p) => (
            <div key={`out-${p.name}`} className="relative flex items-center justify-end gap-1.5">
              <span className="truncate text-[10px] text-gray-400">{p.name}</span>
              <Handle
                id={`out-${p.name}`}
                type="source"
                position={Position.Right}
                style={{ background: portColor(p.type), width: 8, height: 8, right: -4 }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { mini: MiniWfNode };
const edgeTypes: EdgeTypes = { wf: WfEdge };

// ──────────────────────────────────────────────────────────────────────────
// 转换：rawJson → { nodes, edges }
// ──────────────────────────────────────────────────────────────────────────

interface RawLink {
  id: number;
  origin_id: number;
  origin_slot: number;
  target_id: number;
  target_slot: number;
  type: string;
}

interface RawNode {
  id: number;
  type: string;
  pos?: [number, number];
  size?: [number, number];
  inputs?: { name: string; type: string; link?: number | null }[];
  outputs?: { name: string; type: string; links?: number[] }[];
  title?: string;
  mode?: number;
  flags?: Record<string, unknown>;
}

function buildFromRawJson(raw: unknown): { nodes: Node<MiniNodeData>[]; edges: Edge[] } {
  const root = raw as { nodes?: RawNode[]; links?: RawLink[] } | null;
  if (!root || !Array.isArray(root.nodes)) return { nodes: [], edges: [] };
  const nodes: Node<MiniNodeData>[] = root.nodes.map((n) => {
    const inputs = (n.inputs ?? []).map((i) => ({ name: i.name, type: i.type }));
    const outputs = (n.outputs ?? []).map((o) => ({ name: o.name, type: o.type }));
    return {
      id: String(n.id),
      type: "mini",
      position: { x: n.pos?.[0] ?? 0, y: n.pos?.[1] ?? 0 },
      data: {
        title: n.title ?? n.type,
        classType: n.type,
        role: classifyNode(n.type),
        inputs,
        outputs,
      },
    };
  });
  // Build link index: linkId → { source, target, sourceSlot, targetSlot }
  const links = Array.isArray(root.links) ? root.links : [];
  const edges: Edge[] = links.map((l) => {
    // Try to find the source-side slot name from the origin node's outputs[origin_slot]
    const originNode = root.nodes?.find((nn) => nn.id === l.origin_id);
    const targetNode = root.nodes?.find((nn) => nn.id === l.target_id);
    const sourceName = originNode?.outputs?.[l.origin_slot]?.name ?? String(l.origin_slot);
    const targetName = targetNode?.inputs?.[l.target_slot]?.name ?? String(l.target_slot);
    return {
      id: `e${l.id}`,
      type: "wf",
      source: String(l.origin_id),
      target: String(l.target_id),
      sourceHandle: `out-${sourceName}`,
      targetHandle: `in-${targetName}`,
      data: { linkType: l.type },
    };
  });
  return { nodes, edges };
}

// ──────────────────────────────────────────────────────────────────────────
// 转换：apiGraph → { nodes, edges }
// (API 没有 pos，用最长路径层布局 — 基于 lib/comfyui/workflow.ts:buildWorkflowPreview 的算法)
// ──────────────────────────────────────────────────────────────────────────

interface ApiEntry {
  class_type: string;
  inputs?: Record<string, unknown>;
  widgets_values?: unknown[];
  _meta?: { title?: string };
  mode?: number;
}

function buildFromApiGraph(graph: unknown): { nodes: Node<MiniNodeData>[]; edges: Edge[] } {
  if (!graph || typeof graph !== "object") return { nodes: [], edges: [] };
  const entries = Object.entries(graph as Record<string, ApiEntry>).filter(
    ([, n]) => n && typeof n === "object" && typeof (n as { class_type?: string }).class_type === "string",
  );
  if (entries.length === 0) return { nodes: [], edges: [] };

  const ids = entries.map(([id]) => id);
  const incoming: Record<string, Set<string>> = {};
  const outAdj: Record<string, Set<string>> = {};
  for (const id of ids) {
    incoming[id] = new Set();
    outAdj[id] = new Set();
  }
  // For each node, walk inputs and collect [srcId, slot] tuples as edges
  const edges: Edge[] = [];
  let eId = 0;
  for (const [id, node] of entries) {
    const inputs = (node as ApiEntry).inputs ?? {};
    for (const [inputName, v] of Object.entries(inputs)) {
      if (Array.isArray(v) && v.length >= 2 && typeof v[0] === "string" && ids.includes(v[0])) {
        const srcId = v[0];
        const slot = v[1];
        incoming[id]!.add(srcId);
        outAdj[srcId]!.add(id);
        edges.push({
          id: `e${eId++}`,
          type: "wf",
          source: srcId,
          target: id,
          sourceHandle: `out-${slot}`,
          targetHandle: `in-${inputName}`,
        });
      }
    }
  }

  // Longest-path layering (Kahn BFS)
  const level: Record<string, number> = {};
  const remaining = new Map<string, number>(ids.map((id) => [id, incoming[id]!.size]));
  const queue: string[] = [];
  for (const [id, deg] of remaining) {
    if (deg === 0) {
      level[id] = 0;
      queue.push(id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const nxt of outAdj[id]!) {
      level[nxt] = Math.max(level[nxt] ?? 0, level[id]! + 1);
      remaining.set(nxt, (remaining.get(nxt) ?? 0) - 1);
      if ((remaining.get(nxt) ?? 0) === 0) queue.push(nxt);
    }
  }
  for (const id of ids) if (!(id in level)) level[id] = 0;

  // Group by level for row assignment
  const byLevel: Record<number, string[]> = {};
  for (const id of ids) {
    const lv = level[id] ?? 0;
    (byLevel[lv] ||= []).push(id);
  }
  for (const arr of Object.values(byLevel)) arr.sort();

  const levelCount = Math.max(1, ...Object.keys(byLevel).map(Number).map((n) => n + 1));

  const nodes: Node<MiniNodeData>[] = ids.map((id) => {
    const lv = level[id] ?? 0;
    const arr = byLevel[lv] ?? [id];
    const row = arr.indexOf(id);
    const x = PAD_X + lv * COL_STEP;
    const y = PAD_Y + row * ROW_STEP;
    const node = entries.find(([k]) => k === id)?.[1];
    return {
      id,
      type: "mini",
      position: { x, y },
      data: {
        title: node?._meta?.title ?? node?.class_type ?? id,
        classType: node?.class_type ?? "?",
        role: classifyNode(node?.class_type ?? ""),
        inputs: Object.keys(node?.inputs ?? {}).map((name) => ({ name, type: "*" })),
        outputs: [],
      },
    };
  });

  // Dedupe edges (a node may reference same input twice in pathological cases)
  const seen = new Set<string>();
  const dedupEdges = edges.filter((e) => {
    const k = `${e.source}|${e.sourceHandle}|${e.target}|${e.targetHandle}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Compute viewport so React Flow fits all nodes on first paint
  void levelCount;
  return { nodes, edges: dedupEdges };
}

// ──────────────────────────────────────────────────────────────────────────
// GraphPreview 主体
// ──────────────────────────────────────────────────────────────────────────

export interface GraphPreviewProps {
  apiGraph: unknown;
  rawJson: unknown;
  /** 数据形态来源 — RAW (rawJson.nodes[].pos 原始布局) 或 API (最长路径层布局)。 */
  variant: "raw" | "api";
}

function GraphPreviewInner({ apiGraph, rawJson, variant }: GraphPreviewProps) {
  const built = useMemo(() => {
    if (variant === "raw") return buildFromRawJson(rawJson);
    return buildFromApiGraph(apiGraph);
  }, [apiGraph, rawJson, variant]);

  const emptyHint =
    variant === "raw"
      ? "rawJson 缺少 nodes 数组或为空。"
      : "graph 为空或不可解析。";

  if (built.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-5 py-10 text-sm text-gray-400">
        <div>
          <p className="font-medium text-gray-300">该工作流无可视化节点数据</p>
          <p className="mt-1 text-xs text-gray-500">{emptyHint}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={built.nodes}
        edges={built.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.15}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#26262E" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const role = (n.data as MiniNodeData | undefined)?.role ?? "process";
            return role === "input" ? "#10b981" : role === "output" ? "#f97316" : "#7c5cfc";
          }}
          maskColor="rgba(10,10,15,0.78)"
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}

export function GraphPreview(props: GraphPreviewProps) {
  return (
    <ReactFlowProvider>
      <GraphPreviewInner {...props} />
    </ReactFlowProvider>
  );
}