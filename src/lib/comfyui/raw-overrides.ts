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
 * 子图（subgraph）wrapper 的覆盖项会额外同步到内层节点：wrapper 只是把内层
 * 控件「提升」出来的宿主，真正参与 UI→API 转换的是内层节点的
 * `widgets_values`（comfy-cli 展开子图后读的是内层值），只改 wrapper 不改内层
 * 会让覆盖在转换阶段被内层默认值覆盖回去。
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
 * `widgets_values` 所需的字段（`id` / `inputs` / `widgets_values`）；
 * `type` 用于判断该节点是否为子图 wrapper（`class_type` 为子图 UUID）。
 */
export type RawUiNode = {
  id?: unknown;
  type?: unknown;
  inputs?: RawUiNodeInput[];
  widgets_values?: unknown[];
};

/** Map an API-format node id (e.g. "4:1670") or top-level id to the raw UI node.
 *
 *  子图内部的覆盖项落库时会把「宿主 id 链」与「内部节点 id」都记下来，运行期
 *  拼成 comfy-cli 展开后的 `4:1670`（嵌套时 `4:5:1670`）。本函数按这条链**逐层
 *  下钻**：每一段在前一层的节点表里找到 wrapper，取它的 `type`（子图 UUID）定位
 *  子图定义，再用下一段在该定义里继续找 —— 而不是「拿最后一段的裸 id 去所有
 *  子图定义里扫一遍」。后者在同名内部 id、或定义缺失时会撞上错的节点 / 静默
 *  落空（`slot < 0 → continue`，用户看到「改了没生效」），逐层下钻才是确定性的。 */
function resolveRawNode(raw: JsonRecord, nodeId: string): RawUiNode | null {
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

  if (!nodeId.includes(":")) {
    const top = findInNodes(raw.nodes, nodeId);
    if (top) return top;
    /* 存量兜底：入库时还不知道「宿主 id」的旧数据，内部节点只存了裸 id
     *  （`1670`）。新数据一律带宿主 id 走上方确定性下钻；这里仅为已在库的
     *  旧行保留「在子图定义里找同名内部节点」的最后兜底，找不到就是找不到
     *  —— 顶层确实没有这个 id 时返回 null 好过误写到别处。 */
    for (const sub of subgraphDefs(raw).values()) {
      const found = findInNodes(sub.nodes, nodeId);
      if (found) return found;
    }
    return null;
  }

  const segments = nodeId.split(":").filter((seg) => seg !== "");
  if (segments.length < 2) return null;

  const defsByUid = subgraphDefs(raw);
  let currentNodes: unknown = raw.nodes;
  let node: RawUiNode | null = null;
  for (let i = 0; i < segments.length; i++) {
    node = findInNodes(currentNodes, segments[i]!);
    if (!node) return null;
    if (i === segments.length - 1) return node;
    /* 还有下一段 ⇒ 本节点必须是子图 wrapper：用它的 `type`（子图 UUID）定位
     *  子图定义，下一段在该定义的 nodes 里继续找。 */
    const classType = typeof node.type === "string" ? node.type : undefined;
    const sub = classType ? defsByUid.get(classType) : undefined;
    if (!sub || !Array.isArray(sub.nodes)) return null;
    currentNodes = sub.nodes;
  }
  return node;
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

/** Name of the seed-type widget input on a UI node (null when it has none). */
function seedWidgetName(node: RawUiNode): string | null {
  const inputs = node?.inputs ?? [];
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const w = inp.widget;
    const wname =
      typeof w === "string"
        ? w
        : w != null && typeof w === "object"
          ? ((w as JsonRecord).name ?? inp.name)
          : inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) {
      return typeof inp.name === "string" ? inp.name : String(wname);
    }
  }
  return null;
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

/** Sentinel ids ComfyUI uses inside a subgraph definition for the synthetic
 *  boundary nodes: `-10` is the input rail, `-20` the output rail.  A link whose
 *  origin is `-10` means "this inner input is fed by an exposed subgraph pin",
 *  which is exactly how ComfyUI marks a promoted (host-owned) widget. */
const SUBGRAPH_INPUT_NODE_ID = -10;

/** Minimal view of one entry of a subgraph definition's `inputs[]` pin list. */
type SubgraphPin = {
  name?: unknown;
  linkIds?: unknown;
};

/** Minimal view of one interior link object of a subgraph definition
 *  (`{ id, origin_id, origin_slot, target_id, target_slot, type }`). */
type SubgraphLink = {
  id?: unknown;
  origin_id?: unknown;
  target_id?: unknown;
  target_slot?: unknown;
};

/** Minimal view of a subgraph definition (`definitions.subgraphs[uid]`). */
type RawSubgraph = {
  id?: unknown;
  nodes?: unknown;
  links?: unknown;
  inputs?: unknown;
};

/** Collect every subgraph definition, keyed by its UUID (`sub.id`). */
function subgraphDefs(raw: JsonRecord): Map<string, RawSubgraph> {
  const out = new Map<string, RawSubgraph>();
  const defs = raw.definitions;
  const subs =
    defs != null && typeof defs === "object"
      ? (defs as JsonRecord).subgraphs
      : undefined;
  const list: unknown[] = Array.isArray(subs)
    ? subs
    : subs != null && typeof subs === "object"
      ? Object.values(subs)
      : [];
  for (const sg of list) {
    if (sg == null || typeof sg !== "object") continue;
    const sub = sg as RawSubgraph;
    const uid = typeof sub.id === "string" ? sub.id : undefined;
    if (uid) out.set(uid, sub);
  }
  return out;
}

/**
 * 把落在子图 wrapper 上的覆盖项同步到内层节点。
 *
 * 背景：ComfyUI 的子图 wrapper 只保存**宿主值**（`widgets_values` 按「第 i 个
 * 提升到控件的子图输入」位置排列），内层节点保存的是**默认/上游值**。comfy-cli
 * 做 UI→API 转换时会把子图展开成 `wrapperId:innerId`，而展开过程中内层节点的
 * `widgets_values` 才是节点入参的来源；wrapper 的宿主值只在转换器的
 * promoted-widget 回写阶段（comfy-cli ≥ 1.20）被应用。只改 wrapper 不改内层，
 * 在老版本 comfy-cli 上覆盖会被内层默认值整段盖掉。
 *
 * 映射规则与 ComfyUI 前端一致（`SubgraphNode._resolveInputWidget`）：子图定义
 * 的 `inputs[i]` 取其 `linkIds` 中第一条「起点是 `-10`（输入轨）」的边界连线，
 * 该连线的 `target_id` / `target_slot` 即内层节点与其入参槽位；外层 wrapper 的
 * `inputs[]` 与定义 `inputs[]` 按**名字**对齐（顺序可能不同）。
 */
function applySubgraphInteriorOverrides(
  raw: JsonRecord,
  wrapper: RawUiNode,
  wrapperId: string,
  entries: { name: string; value: unknown }[],
): void {
  const classType = typeof wrapper.type === "string" ? wrapper.type : undefined;
  if (!classType) return;
  const sub = subgraphDefs(raw).get(classType);
  if (!sub) return;

  const innerNodes = Array.isArray(sub.nodes) ? sub.nodes : [];
  const innerById = new Map<string, RawUiNode>();
  for (const n of innerNodes) {
    if (n == null || typeof n !== "object") continue;
    const node = n as RawUiNode;
    if (node.id == null) continue;
    if (typeof node.id !== "string" && typeof node.id !== "number") continue;
    innerById.set(String(node.id), node);
  }

  const linksById = new Map<string, SubgraphLink>();
  for (const l of Array.isArray(sub.links) ? sub.links : []) {
    if (l == null || typeof l !== "object") continue;
    const link = l as SubgraphLink;
    if (typeof link.id !== "string" && typeof link.id !== "number") continue;
    linksById.set(String(link.id), link);
  }

  /* 外层 wrapper 输入槽 → 子图定义输入名（按 wrapper.inputs[] 的名字查） */
  const defInputNameByWrapperName = new Map<string, string>();
  const defInputs = Array.isArray(sub.inputs) ? sub.inputs : [];
  const defNames = new Set<string>();
  for (const i of defInputs) {
    if (i == null || typeof i !== "object") continue;
    const pin = i as SubgraphPin;
    if (typeof pin.name === "string") defNames.add(pin.name);
  }
  for (const inp of wrapper.inputs ?? []) {
    if (typeof inp?.name !== "string") continue;
    if (defNames.has(inp.name))
      defInputNameByWrapperName.set(inp.name, inp.name);
  }

  /* 子图定义输入名 → 内层 (nodeId, slot) */
  const targetByName = new Map<string, { nodeId: string; slot: number }>();
  for (const i of defInputs) {
    if (i == null || typeof i !== "object") continue;
    const pin = i as SubgraphPin;
    if (typeof pin.name !== "string") continue;
    for (const lid of Array.isArray(pin.linkIds) ? pin.linkIds : []) {
      if (typeof lid !== "string" && typeof lid !== "number") continue;
      const link = linksById.get(String(lid));
      if (!link) continue;
      if (Number(link.origin_id) !== SUBGRAPH_INPUT_NODE_ID) continue;
      if (
        typeof link.target_id !== "string" &&
        typeof link.target_id !== "number"
      )
        continue;
      const tid = String(link.target_id);
      const slot = Number(link.target_slot);
      if (!innerById.has(tid) || !Number.isFinite(slot)) continue;
      targetByName.set(pin.name, { nodeId: tid, slot: Math.trunc(slot) });
      break;
    }
  }

  for (const { name, value } of entries) {
    const defName = defInputNameByWrapperName.get(name);
    if (defName === undefined) continue;
    const target = targetByName.get(defName);
    if (!target) continue;
    const inner = innerById.get(target.nodeId);
    if (!inner) continue;
    const slot = mapInputSlotToWidgetSlot(inner, target.slot);
    if (slot < 0) continue;
    if (!Array.isArray(inner.widgets_values)) continue;
    inner.widgets_values[slot] = value;
  }
  void wrapperId;
}

/**
 * 把内层节点的**输入槽位下标**换算成 `widgets_values` 下标。
 * 只有带 `widget` 标记的入参才占 `widgets_values` 的格子，且 seed / noise_seed
 * 会多占一格（`control_after_generate` 哨兵），与
 * {@link seedWidgetSlot} / {@link widgetSlot} 的计数规则一致。
 */
function mapInputSlotToWidgetSlot(node: RawUiNode, inputIndex: number): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    if (!inp?.widget) continue;
    // 目标槽位的值格就是当前游标；seed 的 control 哨兵只把它**之后**的
    // 控件整体推后一格，所以哨兵的额外 +1 必须在返回游标之后才累加。
    if (i === inputIndex) return slot;
    slot++;
    const wname =
      typeof inp.widget === "string"
        ? inp.widget
        : inp.widget != null && typeof inp.widget === "object"
          ? ((inp.widget as JsonRecord).name ?? inp.name)
          : inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) slot++;
  }
  return -1;
}

/** Best-effort injection of canvas `workflowInputs` into the raw UI json. */
export function applyRawOverrides(
  rawJson: unknown,
  overrides?: RawWorkflowOverride[],
): JsonRecord {
  if (!overrides?.length) return rawJson as JsonRecord;
  const raw = JSON.parse(JSON.stringify(rawJson)) as JsonRecord;
  /* 已落到节点上的覆盖项，循环结束后统一同步子图内层（见文件末尾）。 */
  const pendingByNode = new Map<string, { name: string; value: unknown }[]>();
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
        const minted = randomSeed();
        node.widgets_values[seedSlot] = minted;
        // 同步写进内层节点：comfy-cli 展开子图后真正被采样器读到的是内层
        // widgets_values，只改 wrapper 的话这次随机种子同样会被内层默认值盖掉。
        pendingByNode.set(ov.nodeId, [
          ...(pendingByNode.get(ov.nodeId) ?? []),
          { name: seedWidgetName(node) ?? "seed", value: minted },
        ]);
      }
      continue;
    }

    const slot = widgetSlot(node, ov.name);
    if (slot < 0) continue;
    if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
    node.widgets_values[slot] = ov.value;
    pendingByNode.set(ov.nodeId, [
      ...(pendingByNode.get(ov.nodeId) ?? []),
      { name: ov.name, value: ov.value },
    ]);
  }

  /* 子图 wrapper：把覆盖同步到内层节点。wrapper 存的是宿主值，而 comfy-cli
   * 展开子图后读的是内层节点的 widgets_values —— 只改 wrapper，在
   * 「转换器不回写宿主值」的 comfy-cli 版本上覆盖会被内层默认值整段盖掉
   * （提示词/种子等入参全部失效，每次都跑工作流里存的那张图）。 */
  for (const [nodeId, entries] of pendingByNode) {
    const node = resolveRawNode(raw, nodeId);
    if (!node) continue;
    applySubgraphInteriorOverrides(raw, node, nodeId, entries);
  }
  return raw;
}
