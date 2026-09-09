/**
 * `raw-overrides.ts` — raw UI-format 工作流的 canvas 覆盖注入（纯函数）
 * ===========================================================================
 *
 * 从 executor-cli.ts 抽出的「把 canvas `workflowInputs` 注入 raw UI json」
 * 纯逻辑模块。不依赖数据库 / 网络，可独立单测。
 *
 * 供 executor-cli 的 comfy-cli 提交路径在写临时工作流文件前调用
 * {@link applyRawOverrides}，把前端下发的 `(nodeId, name, value)` 覆盖项写进
 * raw 节点的 `widgets_values`。
 *
 * @module comfyui/raw-overrides
 */

/** 任意 JSON 对象的宽松视图（外部输入的中间层窄化用）。 */
export type JsonRecord = Record<string, unknown>;

/** 前端下发的工作流覆盖项（nodeId / name / value）。 */
export type RawWorkflowOverride = {
  nodeId: string;
  name: string;
  value?: unknown;
};

/**
 * Raw UI-format（LiteGraph）节点输入槽的最小结构视图 —— 字段随节点类型
 * 漂移，只取本模块读写（`name` / `widget`）的部分，其余原样保留。
 */
export type RawUiNodeInput = {
  name?: unknown;
  widget?: unknown;
};

/**
 * Raw UI-format（LiteGraph）节点的最小结构视图 —— 只取注入
 * `widgets_values` 所需的字段（`id` / `inputs` / `widgets_values`）。
 */
export type RawUiNode = {
  id?: unknown;
  inputs?: RawUiNodeInput[];
  widgets_values?: unknown[];
};

/** Map an API-format node id (e.g. "76:67") or top-level id to the raw UI node. */
function resolveRawNode(raw: JsonRecord, nodeId: string): RawUiNode | null {
  const defs = raw.definitions;
  const subs =
    defs != null && typeof defs === "object"
      ? (defs as JsonRecord).subgraphs
      : undefined;
  const subList: unknown[] = Array.isArray(subs)
    ? subs
    : subs != null && typeof subs === "object"
      ? Object.values(subs)
      : [];
  const findInNodes = (nodes: unknown, id: string): RawUiNode | null => {
    if (!Array.isArray(nodes)) return null;
    for (const x of nodes) {
      if (
        x != null &&
        typeof x === "object" &&
        String((x as JsonRecord).id) === id
      ) {
        return x as RawUiNode;
      }
    }
    return null;
  };
  if (nodeId.includes(":")) {
    const internalId = nodeId.split(":").pop()!;
    for (const sg of subList) {
      const nodes =
        sg != null && typeof sg === "object"
          ? (sg as JsonRecord).nodes
          : undefined;
      const n = findInNodes(nodes, internalId);
      if (n) return n;
    }
    return null;
  }
  const top = findInNodes(raw.nodes, nodeId);
  if (top) return top;
  for (const sg of subList) {
    const nodes =
      sg != null && typeof sg === "object"
        ? (sg as JsonRecord).nodes
        : undefined;
    const n = findInNodes(nodes, nodeId);
    if (n) return n;
  }
  return null;
}

/** Index of a named widget input within a UI node's `widgets_values` array. */
function widgetSlot(node: RawUiNode, name: string): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (inp?.widget) {
      if (inp.name === name) return slot;
      slot++;
    }
  }
  return -1;
}

/** Index of the seed-type widget within a UI node's `widgets_values` array.
 *  Returns -1 when the node has no seed-like widget. */
function seedWidgetSlot(node: RawUiNode): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const w = inp.widget;
    const wname =
      typeof w === "string"
        ? w
        : w != null && typeof w === "object"
          ? ((w as JsonRecord).name ?? inp.name)
          : inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname))
      return slot;
    slot++;
  }
  return -1;
}

/** Number of widget-bearing inputs (each occupies exactly one slot in
 *  `widgets_values` unless a seed's `control_after_generate` sentinel adds
 *  an extra slot — see {@link hasSeedControlSlot}). */
function widgetInputCount(node: RawUiNode): number {
  const inputs = node?.inputs ?? [];
  let count = 0;
  for (const inp of inputs) {
    if (inp?.widget) count++;
  }
  return count;
}

/** Whether this UI node serializes a `control_after_generate` sentinel slot
 *  after its seed widget.  ComfyUI only emits that slot when the seed is a
 *  *real* INT widget on a node that carries randomization (KSampler etc.).
 *  Subgraph wrapper nodes that merely *expose* an inner seed do NOT keep a
 *  control slot in their own `widgets_values` — the slot right after the seed
 *  there belongs to the next exposed widget (e.g. a model COMBO), so writing
 *  `seedSlot + 1` would clobber it.  When the exposed seed's randomization was
 *  quarantined out (ComfyUI `proxyWidgetErrorQuarantine`), we must not write. */
function hasSeedControlSlot(node: RawUiNode): boolean {
  if (!Array.isArray(node?.widgets_values)) return false;
  // A sentinel slot only exists when `widgets_values` holds one more entry than
  // the widget-bearing inputs (older ComfyUI didn't serialize the sentinel, so
  // equal length means seed+1 is a real widget too).
  return node.widgets_values.length > widgetInputCount(node);
}

/** Mint a fresh non-negative ComfyUI-style seed (within JS safe-integer
 *  range) for the no-control-slot randomize fallback. */
function randomSeed(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/** Best-effort injection of canvas `workflowInputs` into the raw UI json. */
export function applyRawOverrides(
  rawJson: unknown,
  overrides?: RawWorkflowOverride[],
): JsonRecord {
  if (!overrides?.length) return rawJson as JsonRecord;
  const raw = JSON.parse(JSON.stringify(rawJson)) as JsonRecord;
  for (const ov of overrides) {
    if (!ov?.nodeId || ov.value === undefined) continue;
    const node = resolveRawNode(raw, ov.nodeId);
    if (!node) continue;

    // Seed "control after generate" is NOT a named widget in raw UI format — it
    // is serialized as the widgets_values slot immediately after the seed widget.
    // Resolve the seed widget slot and target slot+1. (API-format graphs instead
    // carry a real `control_after_generate` input, handled by the name branch.)
    if (ov.name === "control_after_generate") {
      const seedSlot = seedWidgetSlot(node);
      if (seedSlot < 0) continue;
      if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
      // Only write the seed's control mode when this node actually keeps a
      // `control_after_generate` sentinel slot right after the seed.  A
      // subgraph wrapper that exposes an inner seed without exposing its
      // randomization (ComfyUI quarantines it when the subgraph has no input
      // pin for it) has no such slot — `seedSlot + 1` would otherwise
      // overwrite the following real widget (e.g. the diffusion model name).
      if (hasSeedControlSlot(node)) {
        node.widgets_values[seedSlot + 1] = ov.value;
      } else if (ov.value === "randomize") {
        // No sentinel slot (exposed subgraph seed with no randomization pin,
        // or a node whose randomization was quarantined) means ComfyUI keeps
        // the seed fixed — the requested randomize mode would be dropped.
        // Fall back to minting a fresh random seed here so the exposed seed
        // still varies per run.
        node.widgets_values[seedSlot] = randomSeed();
      }
      continue;
    }

    const slot = widgetSlot(node, ov.name);
    if (slot < 0) continue;
    if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
    node.widgets_values[slot] = ov.value;
  }
  return raw;
}
