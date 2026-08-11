/**
 * Graph Utilities — ComfyUI graph JSON ↔ ReactFlow nodes/edges conversion
 *
 * Core bidirectional converter:
 *   comfyGraphToFlow(graph, meta?) → { nodes, edges }
 *   flowToComfyGraph(nodes, edges) → ComfyGraph
 *
 * Also provides layout computation (layered DAG) for initial positioning.
 */

import type {
  ComfyGraph,
  ComfyGraphNode,
  WfNode,
  WfEdge,
  NodeData,
  NodeMeta,
  ParamMap,
} from "./types";
import { getNodeConfig } from "./node-registry";
import { specToField } from "@/config/customNodes";
import type { Node, Edge } from "@xyflow/react";

/* ── Constants ── */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;
const H_GAP = 180;        // horizontal gap between layers
const V_GAP = 60;         // vertical gap within a layer
const LAYER_X_BASE = 40;  // left margin
const LAYER_Y_BASE = 40;  // top margin

/* ── Simple layered layout (topological sort + BFS layers) ── */

interface LayoutNode {
  id: string;
  node: ComfyGraphNode;
  layer: number;
  indexInLayer: number;
}

function computeLayout(graph: ComfyGraph): Map<string, { x: number; y: number }> {
  const entries = Object.entries(graph);
  if (!entries.length) return new Map();

  // Build adjacency: nodeId → set of upstream dependency ids
  const deps = new Map<string, Set<string>>();
  for (const [id, node] of entries) {
    const upstream = new Set<string>();
    if (node?.inputs) {
      for (const v of Object.values(node.inputs)) {
        if (Array.isArray(v) && typeof v[0] === "string" && graph[v[0]]) {
          upstream.add(v[0]);
        }
      }
    }
    deps.set(id, upstream);
  }

  // Topological sort via Kahn's algorithm with layer assignment
  const inDegree = new Map<string, number>();
  const reverseDeps = new Map<string, string[]>(); // downstream children

  for (const [id] of entries) {
    inDegree.set(id, (deps.get(id)?.size ?? 0));
    reverseDeps.set(id, []);
  }
  for (const [id, ups] of deps) {
    for (const u of ups) {
      reverseDeps.get(u)?.push(id);
    }
  }

  // Assign layers via BFS from roots (in-degree = 0)
  const layers: string[][] = [];
  const visited = new Set<string>();
  let queue = [...entries.filter(([id, n]) => !deps.get(id)?.size).map(([id]) => id)];

  while (queue.length || visited.size < entries.length) {
    if (!queue.length) {
      // Break cycles — pick any unvisited node as a new root
      const remaining = entries.find(([id]) => !visited.has(id));
      if (remaining) queue = [remaining[0]];
      else break;
    }

    layers.push([...queue]);
    const nextQueue: string[] = [];

    for (const id of queue) {
      if (visited.has(id)) continue;
      visited.add(id);

      for (const child of reverseDeps.get(id) ?? []) {
        if (!visited.has(child)) {
          nextQueue.push(child);
        }
      }
    }

    // Dedupe next layer
    queue = [...new Set(nextQueue)];
  }

  // Compute positions
  const positions = new Map<string, { x: number; y: number }>();
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    for (let ni = 0; ni < layer.length; ni++) {
      const id = layer[ni];
      const config = getNodeConfig(graph[id]?.class_type ?? "");
      positions.set(id, {
        x: LAYER_X_BASE + li * H_GAP,
        y: LAYER_Y_BASE + ni * (config.height ?? NODE_HEIGHT + V_GAP),
      });
    }
  }

  return positions;
}

/* ── Convert ComfyUI graph → ReactFlow nodes + edges ── */

export interface FlowData {
  nodes: WfNode[];
  edges: WfEdge[];
}

export function comfyGraphToFlow(
  graph: ComfyGraph,
  paramMap?: ParamMap | null,
  existingPositions?: Map<string, { x: number; y: number }>
): FlowData {
  const pos = existingPositions ?? computeLayout(graph);
  const inverseParamMap: Record<string, string> = {};
  if (paramMap) {
    for (const [role, nodeId] of Object.entries(paramMap)) {
      if (nodeId) inverseParamMap[nodeId as string] = role;
    }
  }

  const nodes: WfNode[] = [];
  const edges: WfEdge[] = [];

  for (const [id, node] of Object.entries(graph)) {
    if (!node) continue;

    const config = getNodeConfig(node.class_type);
    const position = pos.get(id) ?? { x: 0, y: 0 };
    const role = inverseParamMap[id] as NodeData["role"];

    const data: NodeData = {
      comfyId: id,
      classType: node.class_type,
      label: node._meta?.title ?? config.label,
      role,
      inputs: { ...(node.inputs ?? {}) },
      fields: buildFields(node.class_type, node.inputs),
    };

    nodes.push({
      id,
      type: "comfyNode",
      position,
      data,
      style: { width: config.width },
    });

    // Create edges from input wiring
    if (node.inputs) {
      for (const [inputKey, value] of Object.entries(node.inputs)) {
        if (Array.isArray(value) && typeof value[0] === "string") {
          const sourceId = value[0];
          const sourceHandle = String(value[1] ?? 0);
          edges.push({
            id: `${sourceId}-${inputKey}-${id}`,
            source: sourceId,
            target: id,
            sourceHandle: `out-${sourceHandle}`,
            targetHandle: `in-${inputKey}`,
            type: "bezierEdge",
            animated: true,
          });
        }
      }
    }
  }

  return { nodes, edges };
}

/* ── Convert ReactFlow nodes/edges back to ComfyUI graph JSON ── */

export function flowToComfyGraph(
  nodes: Node[],
  _edges: Edge[]
): ComfyGraph {
  const graph: ComfyGraph = {};

  for (const node of nodes) {
    const d = node.data as unknown as NodeData;
    const inputs: Record<string, any> = {};
    // 先剥离所有连线引用（数组型 [nodeId, slot]），只保留字面量值。
    // 否则删除边后，data.inputs 里残留的旧连线引用会让导出图仍带着已删除的连接。
    for (const [k, v] of Object.entries(d.inputs ?? {})) {
      if (Array.isArray(v) && typeof v[0] === "string") continue;
      inputs[k] = v;
    }
    graph[d.comfyId] = {
      class_type: d.classType,
      inputs,
    };
  }

  // Re-wire edges into input references（连线以 edges 为唯一真相源重建）
  for (const edge of _edges) {
    const targetNode = graph[edge.target];
    if (!targetNode) continue;

    // Extract handle numbers
    const targetMatch = edge.targetHandle?.match(/in-(.+)/);
    const sourceMatch = edge.sourceHandle?.match(/out-(.+)/);
    if (targetMatch) {
      const inputKey = targetMatch[1];
      targetNode.inputs[inputKey] = [
        edge.source,
        sourceMatch ? parseInt(sourceMatch[1], 10) : 0,
      ];
    }
  }

  return graph;
}

/* ── Build field definitions for a node's current inputs ── */

function buildFields(classType: string, inputs: Record<string, any>) {
  const config = getNodeConfig(classType);

  // Custom nodes: drive field list from the manifest spec (names + types +
  // defaults), then include any graph inputs not described by the spec.
  if (config.custom && config.inputsSpec) {
    const fields = config.inputsSpec.map(specToField);
    for (const key of Object.keys(inputs)) {
      if (Array.isArray(inputs[key])) continue; // wired connection
      if (!config.inputsSpec.find((s) => s.name === key)) {
        fields.push(inferField(key, inputs[key]));
      }
    }
    return fields;
  }

  // Start with registry defaults, then overlay actual input keys
  const fieldMap = new Map(config.defaultFields.map((f) => [f.key, f]));

  for (const key of Object.keys(inputs)) {
    // Skip wired connections (array values)
    if (Array.isArray(inputs[key])) continue;
    if (!fieldMap.has(key)) {
      // Infer type from value
      const inferred = inferField(key, inputs[key]);
      fieldMap.set(key, inferred);
    }
  }

  return Array.from(fieldMap.values());
}

function inferField(key: string, value: any): import("./types").FieldDef {
  if (typeof value === "number")
    return { key, label: key, type: "number", group: "参数" };
  if (typeof value === "boolean")
    return { key, label: key, type: "toggle", group: "选项" };
  if (typeof value === "string" && value.length > 60)
    return { key, label: key, type: "text", multiline: true, group: "提示词" };
  return { key, label: key, type: "string", group: "参数" };
}

/* ── Export layout util for external use ── */
export { computeLayout };
