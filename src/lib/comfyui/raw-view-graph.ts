/**
 * `raw-view-graph.ts` — RAW 工作流 → **画布视图图**（纯离线派生，不发网络）
 * ===========================================================================
 *
 * 唯一用途：给「RAW 视图」的画布提供一份**保留 subgraph wrapper** 的节点 + 连线
 * 视图。存库的 `graph`（即 `detail.nodes` 的来源）在某些工作流里被「拆平」成了
 * `N:xx` 节点，RAW 布局若只用它会显示十几个被炸开的节点，而用户期望的是原始
 * ComfyUI 节点（含 wrapper 整卡）。这里直接从 `rawJson` 现派生一份。
 *
 * **这不是「格式转换」，更不是 API 图的来源**（别把它接回导入或执行链）：
 *   - 入库存图由导入件自己决定（API 原件落 `graph`、RAW 原件落 `rawJson`）；
 *   - 执行由 comfy-cli 按节点类定义做权威转换（`resolveExecutionPayload`
 *     在两种格式里优先送 RAW）。
 *   历史上「导入时把 raw 转成 API 图存库」已被证明有害（ISSUE #632）：无
 *   ComfyUI 可达时按类名猜控件顺序，猜错就是一份能打开、跑起来结果不对的图。
 *
 * `_meta` 为什么保留：画布的节点 JSON 面板要显示 `title` / `mode`，而画布导出
 * 的图在提交前要经 `execution-graph.prepareGraphForExecution` 做旁路穿透 ——
 * 那一步读的正是 `_meta.mode / virtual / value / inputOrder / inputTypes /
 * outputTypes`。丢掉它们会让「画布上旁路一个节点再运行」失效。
 *
 * @module comfyui/raw-view-graph
 */

import { toStringValue } from "./raw";
import type { ApiNodeMeta, ApiWorkflowNode, RawNode, RawWorkflow } from "./raw";
import {
  isVirtualNodeType,
  NODE_MODE_ALWAYS,
  NODE_MODE_BYPASS,
  NODE_MODE_NEVER,
} from "./execution-graph";

/** Fallback FULL input order (widgets + connections) for slot→name mapping.
 *  Raw 节点没有 `inputs[]` 时（老导出 / 被裁过的节点）只能按槽位序号查这张表
 *  拿名字；有 `inputs[]` 时一律以节点自带的名字为准。 */
const FALLBACK_FULL: Record<string, string[]> = {
  KSampler: [
    "model",
    "positive",
    "negative",
    "latent_image",
    "seed",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "denoise",
  ],
  KSamplerAdvanced: [
    "model",
    "positive",
    "negative",
    "latent_image",
    "add_noise",
    "noise_seed",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "start_at_step",
    "end_at_step",
    "return_with_leftover_noise",
  ],
  CLIPTextEncode: ["clip", "text"],
  CheckpointLoaderSimple: ["ckpt_name"],
  LoraLoader: ["model", "clip", "lora_name", "strength_model", "strength_clip"],
  LoraLoaderModelOnly: ["model", "lora_name", "strength_model"],
  EmptyLatentImage: ["width", "height", "batch_size"],
  VAEEncode: ["pixels", "vae"],
  VAEDecode: ["samples", "vae"],
  SaveImage: ["images", "filename_prefix"],
  LoadImage: ["image"],
  VAELoader: ["vae_name"],
  UNETLoader: ["unet_name", "weight_dtype"],
  DualCLIPLoader: ["clip_name1", "clip_name2", "type", "device"],
};

interface NodeInputSlot {
  name: string;
  type?: string;
  link: number | null;
}

interface IndexedNode {
  id: string;
  type: string;
  mode: number;
  virtual: boolean;
  raw: RawNode;
  /** 按槽位顺序排列，索引即 slot index */
  inputs: NodeInputSlot[];
  outputTypes: string[];
}

interface LinkRef {
  originId: string;
  originSlot: number;
}

/** link id → 起点。每条 link 是 [link_id, src_id, src_slot, dst_id, dst_slot, type]。 */
function buildLinkIndex(raw: RawWorkflow): Map<number, LinkRef> {
  const map = new Map<number, LinkRef>();
  for (const l of raw.links ?? []) {
    if (!Array.isArray(l) || l.length < 5) continue;
    map.set(Number(l[0]), {
      originId: String(l[1]),
      originSlot: Number(l[2]),
    });
  }
  return map;
}

/**
 * 建立节点索引。
 *
 * 入参槽位**优先取节点自带的 `inputs[]`**（含 name/type/link，与 ComfyUI 前端
 * 读的字段完全一致）；只有节点没有 `inputs[]` 时，才退回「按 slot 序号查
 * input_order」的猜测路径 —— 后者在「widget 转 input」的工作流里必然错位，
 * 所以能不用就不用。
 */
function indexRawNodes(raw: RawWorkflow): Map<string, IndexedNode> {
  const byId = new Map<string, IndexedNode>();
  for (const n of raw.nodes) {
    const id = String(n.id);
    const type = String(n.type);
    const slots: NodeInputSlot[] = [];

    if (Array.isArray(n.inputs) && n.inputs.length) {
      for (const inp of n.inputs) {
        if (!inp || typeof inp.name !== "string") continue;
        slots.push({
          name: inp.name,
          type: typeof inp.type === "string" ? inp.type : undefined,
          link: inp.link == null ? null : Number(inp.link),
        });
      }
    } else {
      const order = FALLBACK_FULL[type] ?? [];
      for (const name of order) slots.push({ name, link: null });
      for (const l of raw.links ?? []) {
        if (!Array.isArray(l) || l.length < 5) continue;
        if (String(l[3]) !== id) continue;
        const slot = slots[Number(l[4])];
        if (!slot) continue;
        slot.link = Number(l[0]);
        if (typeof l[5] === "string") slot.type = l[5];
      }
    }

    byId.set(id, {
      id,
      type,
      mode: Number(n.mode ?? NODE_MODE_ALWAYS),
      virtual: isVirtualNodeType(type),
      raw: n,
      inputs: slots,
      outputTypes: Array.isArray(n.outputs)
        ? n.outputs.map((output) =>
            output && typeof output.type === "string" ? output.type : "",
          )
        : [],
    });
  }
  return byId;
}

/**
 * 从 raw UI 格式派生一份**画布视图图**：节点 id → `{ class_type, inputs }`，
 * 其中连线入参是 `[上游节点 id, 上游输出槽位]` 元组（画布据它画边与自动布局）。
 *
 * 不含任何「转成 API 提交」的语义：控件值不由这里映射（画布的参数值走
 * `rawInputsById` / `rawNodes[].widgets_values`）。
 */
export function buildRawViewGraph(
  raw: RawWorkflow,
): Record<string, ApiWorkflowNode> {
  const graph: Record<string, ApiWorkflowNode> = {};
  if (!Array.isArray(raw.nodes)) return graph;

  const linkIndex = buildLinkIndex(raw);
  const index = indexRawNodes(raw);

  for (const idx of index.values()) {
    const inputs: Record<string, unknown> = {};
    for (const slot of idx.inputs) {
      if (slot.link == null) continue;
      const ref = linkIndex.get(slot.link);
      if (!ref) continue;
      inputs[slot.name] = [ref.originId, ref.originSlot];
    }

    /* `_meta` 是**展示 + 提交前穿透**两份用途的共同载体（见文件头）：
     * title/mode 供节点面板与 JSON 面板显示，virtual/value/inputOrder/
     * inputTypes/outputTypes 供 `execution-graph` 在提交前穿透旁路节点。 */
    const meta: ApiNodeMeta = {};
    const title = idx.raw.title ?? idx.raw.properties?.title;
    if (title) meta.title = toStringValue(title);
    if (idx.mode !== NODE_MODE_ALWAYS) meta.mode = idx.mode;
    if (idx.virtual) meta.virtual = true;

    const inactive =
      idx.virtual ||
      idx.mode === NODE_MODE_NEVER ||
      idx.mode === NODE_MODE_BYPASS;
    if (inactive) {
      meta.inputOrder = idx.inputs.map((input) => input.name);
      const types: Record<string, string> = {};
      for (const s of idx.inputs) if (s.type) types[s.name] = s.type;
      if (Object.keys(types).length) meta.inputTypes = types;
      if (idx.outputTypes.length) meta.outputTypes = idx.outputTypes;
      if (idx.type === "PrimitiveNode") {
        const value = Array.isArray(idx.raw.widgets_values)
          ? idx.raw.widgets_values[0]
          : undefined;
        if (value !== undefined) meta.value = value;
      }
    }

    graph[idx.id] = {
      class_type: idx.type,
      inputs,
      ...(Object.keys(meta).length ? { _meta: meta } : {}),
    };
  }

  return graph;
}
