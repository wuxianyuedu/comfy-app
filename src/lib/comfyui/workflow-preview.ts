/**
 * 客户端安全的工作流图预览助手。
 *
 * 这些函数**不**依赖任何仅服务端的模块（fs / ComfyUI 客户端），
 * 因此可以被浏览器包里的 React 组件导入。
 */

/**
 * ComfyUI 工作流图的紧凑预览摘要，用于在工作流库卡片上渲染缩略节点图。
 * 结构刻意做小，让 /api/workflows 的 GET 响应可以内联带上它。
 */
export type WorkflowPreviewNodeKind = "input" | "process" | "output";

export type WorkflowPreviewNode = {
  id: string;
  class_type: string;
  kind: WorkflowPreviewNodeKind;
  /** 从左到右的层级下标（0 = 最左，越大越靠右）。 */
  level: number;
  /** 层内的行号（0 = 最上），用于纵向定位。 */
  row: number;
};

export type WorkflowPreviewEdge = {
  from: string;
  to: string;
};

export type WorkflowPreview = {
  nodes: WorkflowPreviewNode[];
  edges: WorkflowPreviewEdge[];
  /** 节点总数（被截断时可能大于 nodes.length）。 */
  total: number;
  /** SVG viewBox 的宽 / 高（单位 px）。 */
  width: number;
  height: number;
  /** 为真时表示 nodes[] 只展示了全部节点里有代表性的一部分。 */
  truncated: boolean;
};

/**
 * ComfyUI API 格式图（「Export (API Format)」导出的 JSON：
 * `{ "nodeId": { class_type, inputs } }`）里单个节点的结构视图。
 * 这里只解读 `class_type` 与 `inputs`，其余字段原样透传。
 */
export type WorkflowGraphNode = {
  class_type: string;
  /** 具名输入；连线值是 `[nodeId, outputIndex]` 二元组。 */
  inputs?: Record<string, unknown>;
};

/**
 * {@link WorkflowGraphNode} 的运行时守卫。ComfyUI 的节点对象带额外的动态字段，
 * 因此只要对象有字符串类型的 `class_type` 就接受；
 * `inputs` 只在真正读取它的地方做结构校验。
 */
export function isWorkflowGraphNode(
  value: unknown,
): value is WorkflowGraphNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "class_type" in value &&
    typeof value.class_type === "string"
  );
}

/**
 * 从 ComfyUI 的连线里取出上游节点 id —— 连线就是形如
 * `[nodeId, outputIndex]` 的输入值。非连线值（字符串、数字 …）返回
 * undefined.
 */
export function linkTargetId(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length < 1) return undefined;
  return typeof value[0] === "string" ? value[0] : undefined;
}

/** 充当数据源的节点类型（没有别的节点喂它）。 */
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

/** 充当数据汇的节点类型（没有别的节点消费它的输出）。 */
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
 * 为工作流图构建紧凑预览。这里做一个轻量的最长路径分层：没有入边的节点排在最左，
 * 纯数据汇排在最右。随后按拓扑序裁剪到前约 14 个节点，让卡片保持可读；
 * 被裁剪时 `truncated` 会被置上。
 */
export function buildWorkflowPreview(
  graph: Record<string, unknown>,
): WorkflowPreview {
  const entries = Object.entries(graph).filter(
    (entry): entry is [string, WorkflowGraphNode] =>
      isWorkflowGraphNode(entry[1]),
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

  // 从所有形如 [nodeId, outputIndex] 二元组的输入里收集连线。
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
      const src = linkTargetId(v);
      if (src && outAdj[src]) {
        incoming[id]!.add(src);
        outAdj[src].add(id);
      }
    }
  }

  // 最长路径分层（Kahn 风格 BFS，深度 = 父节点最大深度 + 1）。
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
  // 仍未分到层的节点（成环）—— 一律放到第 0 层。
  for (const id of Object.keys(incoming)) if (!(id in level)) level[id] = 0;

  // 节点太多时挑一个有代表性的子集：最多保留 14 个，
  // 偏向数据源与数据汇，以及靠前的层。
  const nodeById = new Map(entries);
  let visible = entries.map(([id]) => id);
  let truncated = false;
  if (visible.length > 14) {
    truncated = true;
    const kindOf = (id: string) => classifyNode(nodeById.get(id)!.class_type);
    const sinks = visible.filter((id) => kindOf(id) === "output");
    const sources = visible.filter((id) => kindOf(id) === "input");
    const mid = visible.filter(
      (id) => !sinks.includes(id) && !sources.includes(id),
    );
    mid.sort((left, right) => (level[left] ?? 0) - (level[right] ?? 0));
    const midKeep = Math.max(0, 14 - sources.length - sinks.length);
    visible = [...sources, ...mid.slice(0, midKeep), ...sinks];
  }

  // 给每个层内的节点分配行号，用于纵向定位。
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

    const node = nodeById.get(id)!;

    return {
      id,

      class_type: node.class_type,

      kind: classifyNode(node.class_type),

      level: lv,

      row,
    };
  });

  // 连线：只在可见节点之间保留。
  const visibleSet = new Set(visible);
  const edges: WorkflowPreviewEdge[] = [];
  for (const id of visible) {
    for (const nxt of outAdj[id]!) {
      if (visibleSet.has(nxt)) edges.push({ from: id, to: nxt });
    }
  }

  return { nodes, edges, total, width, height, truncated };
}

/** 完整（不裁剪）详情预览的布局常量。 */
export const FULL_PREVIEW_NODE_W = 140;
export const FULL_PREVIEW_NODE_H = 44;
export const FULL_PREVIEW_LEVEL_GAP = 180;
export const FULL_PREVIEW_ROW_GAP = 64;
export const FULL_PREVIEW_MARGIN = 32;

/**
 * 为工作流图构建完整预览，供详情视图使用。
 * 与 `buildWorkflowPreview` 不同：这里保留所有节点，
 * 并按更宽、更易读的网格排布，让用户能审视完整的画布拓扑。
 */
export function buildWorkflowPreviewFull(
  graph: Record<string, unknown>,
): WorkflowPreview {
  const entries = Object.entries(graph).filter(
    (entry): entry is [string, WorkflowGraphNode] =>
      isWorkflowGraphNode(entry[1]),
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
      const src = linkTargetId(v);
      if (src && outAdj[src]) {
        incoming[id]!.add(src);
        outAdj[src].add(id);
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

  const nodes: WorkflowPreviewNode[] = entries.map(([id, node]) => {
    const lv = level[id] ?? 0;
    const arr = byLevel[lv] ?? [];
    const row = arr.indexOf(id);
    return {
      id,
      class_type: node.class_type,
      kind: classifyNode(node.class_type),
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
