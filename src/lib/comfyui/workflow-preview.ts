/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */

/**
 * Client-safe workflow graph preview helpers.
 *
 * These functions do NOT depend on any server-only modules (fs / ComfyUI client),
 * so they can be imported by React components in the browser bundle.
 */

/**
 * Compact preview summary of a ComfyUI workflow graph, used to render
 * a thumbnail node-graph on workflow library cards. The shape is
 * deliberately small so a /api/workflows GET can include it inline.
 */
export type WorkflowPreviewNodeKind = "input" | "process" | "output";

export type WorkflowPreviewNode = {
  id: string;
  class_type: string;
  kind: WorkflowPreviewNodeKind;
  /** Left-to-right layer index (0 = leftmost, larger = further right). */
  level: number;
  /** Row inside the level (0 = top). Used to position vertically. */
  row: number;
};

export type WorkflowPreviewEdge = {
  from: string;
  to: string;
};

export type WorkflowPreview = {
  nodes: WorkflowPreviewNode[];
  edges: WorkflowPreviewEdge[];
  /** Total node count (may be larger than nodes.length when truncated). */
  total: number;
  /** SVG viewBox width / height, in px. */
  width: number;
  height: number;
  /** True when nodes[] only shows a representative subset of total nodes. */
  truncated: boolean;
};

/** Class types that act as data sources (no other node feeds them). */
const INPUT_CLASSES = new Set([
  "LoadImage",
  "CLIPTextEncode",
  "CheckpointLoaderSimple",
  "CheckpointLoader",
  "LoraLoader",
  "LoraLoaderModelOnly",
  "VAELoader",
  "ControlNetLoader",
  "UpscaleModelLoader",
  "CLIPVisionLoader",
  "DualCLIPLoader",
  "UNETLoader",
  "WanVideoModelLoader",
  "WanVideoVAELoader",
  "WanVideoTextEncoderLoader",
  "WanVideoClipVisionLoader",
  "LoadVideo",
  "VHS_LoadVideo",
  "ImageOnlyCheckpointLoader",
]);

/** Class types that act as sinks (no other node consumes their output). */
const OUTPUT_CLASSES = new Set([
  "SaveImage",
  "SaveImageAdvanced",
  "PreviewImage",
  "VHS_VideoCombine",
  "SaveVideo",
  "VHS_VideoInfo",
  "VHS_SaveVideo",
  "WanVideoDecode",
  "ImageUpscaleWithModel",
  "ImageBlend",
  "ImageCompositeMasked",
]);

function classifyNode(classType: string): WorkflowPreviewNodeKind {
  if (INPUT_CLASSES.has(classType)) return "input";
  if (OUTPUT_CLASSES.has(classType)) return "output";
  return "process";
}

/**
 * Build a compact preview for a workflow graph. We do a lightweight
 * longest-path layering so nodes with no incoming edges sit on the left
 * and pure sinks sit on the right. We then trim to the first ~14 nodes
 * by topological order so the card stays readable; `truncated` is set.
 */
export function buildWorkflowPreview(
  graph: Record<string, any>,
): WorkflowPreview {
  const entries = Object.entries(graph).filter(
    ([, n]) => n && typeof n === "object" && typeof n.class_type === "string",
  );
  const total = entries.length;
  if (total === 0) {
    return {
      nodes: [],
      edges: [],
      total: 0,
      width: 280,
      height: 80,
      truncated: false,
    };
  }

  // Collect edges from any input that is a [nodeId, outputIndex] tuple.
  const incoming: Record<string, Set<string>> = {};
  const outAdj: Record<string, Set<string>> = {};
  for (const [id] of entries) {
    incoming[id] = new Set();
    outAdj[id] = new Set();
  }
  for (const [id, node] of entries) {
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const v of Object.values(inputs)) {
      if (
        Array.isArray(v) &&
        v.length >= 1 &&
        typeof v[0] === "string" &&
        outAdj[v[0]]
      ) {
        incoming[id]!.add(v[0]);
        outAdj[v[0]]!.add(id);
      }
    }
  }

  // Longest-path layer (Kahn-style BFS with depth = max parent depth + 1).
  const level: Record<string, number> = {};
  const remaining = new Map<string, number>(
    Object.entries(incoming).map(([k, v]) => [k, v.size]),
  );
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
  // Any node still missing a level (cycle) — put it at level 0.
  for (const id of Object.keys(incoming)) if (!(id in level)) level[id] = 0;

  // Pick a representative subset if too many nodes. Keep at most 14, biased
  // toward sources and sinks, and to early layers.
  let visible = entries.map(([id]) => id);
  let truncated = false;
  if (visible.length > 14) {
    truncated = true;
    const sinks = visible.filter(
      (id) => classifyNode(graph[id].class_type) === "output",
    );
    const sources = visible.filter(
      (id) => classifyNode(graph[id].class_type) === "input",
    );
    const mid = visible.filter(
      (id) => !sinks.includes(id) && !sources.includes(id),
    );
    mid.sort((left, right) => (level[left] ?? 0) - (level[right] ?? 0));
    const midKeep = Math.max(0, 14 - sources.length - sinks.length);
    visible = [...sources, ...mid.slice(0, midKeep), ...sinks];
  }

  // Assign row within each level for vertical positioning.
  const byLevel: Record<number, string[]> = {};
  for (const id of visible) {
    const lv = level[id] ?? 0;
    (byLevel[lv] ||= []).push(id);
  }
  for (const arr of Object.values(byLevel)) arr.sort();

  // Layout constants.
  const width = 280;
  const height = 80;

  const nodes: WorkflowPreviewNode[] = visible.map((id) => {
    const lv = level[id] ?? 0;

    const arr = byLevel[lv] ?? [];

    const row = arr.indexOf(id);

    return {
      id,

      class_type: graph[id].class_type,

      kind: classifyNode(graph[id].class_type),

      level: lv,

      row,
    };
  });

  // Edges: only between visible nodes.
  const visibleSet = new Set(visible);
  const edges: WorkflowPreviewEdge[] = [];
  for (const id of visible) {
    for (const nxt of outAdj[id]!) {
      if (visibleSet.has(nxt)) edges.push({ from: id, to: nxt });
    }
  }

  return { nodes, edges, total, width, height, truncated };
}

/** Layout constants for the full (non-truncated) detail preview. */
export const FULL_PREVIEW_NODE_W = 140;
export const FULL_PREVIEW_NODE_H = 44;
export const FULL_PREVIEW_LEVEL_GAP = 180;
export const FULL_PREVIEW_ROW_GAP = 64;
export const FULL_PREVIEW_MARGIN = 32;

/**
 * Build a complete preview for a workflow graph, suitable for the detail view.
 * Unlike `buildWorkflowPreview`, this keeps every node and lays them out in a
 * wider, more readable grid so the user can inspect the full canvas topology.
 */
export function buildWorkflowPreviewFull(
  graph: Record<string, any>,
): WorkflowPreview {
  const entries = Object.entries(graph).filter(
    ([, n]) => n && typeof n === "object" && typeof n.class_type === "string",
  );
  const total = entries.length;
  if (total === 0) {
    return {
      nodes: [],
      edges: [],
      total: 0,
      width: 0,
      height: 0,
      truncated: false,
    };
  }

  const incoming: Record<string, Set<string>> = {};
  const outAdj: Record<string, Set<string>> = {};
  for (const [id] of entries) {
    incoming[id] = new Set();
    outAdj[id] = new Set();
  }
  for (const [id, node] of entries) {
    const inputs = node.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const v of Object.values(inputs)) {
      if (
        Array.isArray(v) &&
        v.length >= 1 &&
        typeof v[0] === "string" &&
        outAdj[v[0]]
      ) {
        incoming[id]!.add(v[0]);
        outAdj[v[0]]!.add(id);
      }
    }
  }

  const level: Record<string, number> = {};
  const remaining = new Map<string, number>(
    Object.entries(incoming).map(([k, v]) => [k, v.size]),
  );
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
  for (const id of Object.keys(incoming)) if (!(id in level)) level[id] = 0;

  const byLevel: Record<number, string[]> = {};
  for (const [id] of entries) {
    const lv = level[id] ?? 0;
    (byLevel[lv] ||= []).push(id);
  }
  for (const arr of Object.values(byLevel)) arr.sort();

  const nodes: WorkflowPreviewNode[] = entries.map(([id]) => {
    const lv = level[id] ?? 0;
    const arr = byLevel[lv] ?? [];
    const row = arr.indexOf(id);
    return {
      id,
      class_type: graph[id].class_type,
      kind: classifyNode(graph[id].class_type),
      level: lv,
      row,
    };
  });

  const edges: WorkflowPreviewEdge[] = [];
  for (const [id] of entries) {
    for (const nxt of outAdj[id]!) {
      edges.push({ from: id, to: nxt });
    }
  }

  const maxLevel = Math.max(0, ...nodes.map((n) => n.level));
  const maxRowPerLevel = Object.values(byLevel).map((arr) => arr.length - 1);
  const maxRow = Math.max(0, ...maxRowPerLevel);

  const width =
    (maxLevel + 1) * FULL_PREVIEW_LEVEL_GAP + FULL_PREVIEW_MARGIN * 2;
  const height = (maxRow + 1) * FULL_PREVIEW_ROW_GAP + FULL_PREVIEW_MARGIN * 2;

  return { nodes, edges, total, width, height, truncated: false };
}
