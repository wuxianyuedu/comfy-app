/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
/**
 * ComfyUI 工作流「原始 / API」双格式兼容层
 *
 * ComfyUI 提供两种 JSON 表达同一个工作流：
 *
 *   1) API 格式 (执行用)
 *      ─────────────────
 *      { "3": { class_type: "KSampler", inputs: { seed: 123, steps: 20, ... } }, ... }
 *      节点按 id 平铺，inputs 是结构化的命名参数，可直接 POST 到 /api/prompt。
 *
 *   2) 原始 UI 格式 (存档用)
 *      ─────────────────
 *      { last_node_id, last_link_id, nodes: [ { id, type, pos:[x,y], size:[w,h],
 *           widgets_values:[...] }, ... ], links: [ [id, src, srcSlot, dst, dstSlot, type] ] }
 *      这是 ComfyUI 前端保存在磁盘的格式，含节点坐标信息。
 *
 * 本模块负责：
 *   - detectFormat：自动识别 JSON 是哪种格式
 *   - convertRawToApi：将原始 → API（通过 ComfyUI /object_info 获取 widget→input 映射）
 *   - extractPositions：从原始格式抽取每个节点的 (x,y)
 *   - fallbackRawToApi：ComfyUI 不可达时的启发式映射（针对已知常用节点类）
 */

import { comfyBase } from "./client";

export type WorkflowFormat = "api" | "raw";

export interface RawNode {
  id: number | string;
  type: string;
  pos?: [number, number];
  size?: [number, number];
  /**
   * LiteGraph 执行模式：0=ALWAYS(正常) 1=ON_EVENT 2=NEVER(静音) 3=ON_TRIGGER 4=BYPASS。
   * ComfyUI 前端在导出 prompt 时会剔除 2/4 的节点，4 还要把连线「穿透」过去。
   */
  mode?: number;
  /** 节点控件值的有序数组，含义由 class_type 决定 */
  widgets_values?: any[];
  /** 部分工作流的 raw 节点也会显式包含 inputs/outputs（用于嵌套连接） */
  inputs?: any[];
  outputs?: any[];
  /** 节点属性，如 title */
  properties?: Record<string, any>;
  title?: string;
}

/* ── LiteGraph 节点模式 ── */
export const NODE_MODE_ALWAYS = 0;
export const NODE_MODE_NEVER = 2; // 静音 mute：不执行、不穿透
export const NODE_MODE_BYPASS = 4; // 旁路 bypass：不执行、连线按类型穿透

/**
 * 纯前端节点（isVirtualNode）：它们从不进入 /prompt，只负责搬运连线或数值。
 * ComfyUI 前端在 graphToPrompt 阶段就把它们解析掉了。
 */
const VIRTUAL_NODE_TYPES = new Set([
  "Reroute",
  "RerouteNode",
  "Reroute (rgthree)",
  "PrimitiveNode",
  "Note",
  "MarkdownNote",
]);

export function isVirtualNodeType(type: string): boolean {
  return VIRTUAL_NODE_TYPES.has(type);
}

export interface RawWorkflow {
  last_node_id?: number;
  last_link_id?: number;
  nodes: RawNode[];
  links?: any[];
  groups?: any[];
  config?: Record<string, any>;
  extra?: Record<string, any>;
  [k: string]: any;
}

/**
 * `_meta` 的官方用途只有 `title`。这里额外携带的字段**仅用于本地存储与画布展示**，
 * 在 `prepareGraphForExecution()` 里会被整体剥掉，绝不会发给 ComfyUI。
 */
export interface ApiNodeMeta {
  title?: string;
  /** LiteGraph mode，仅在 !== 0 时写入 */
  mode?: number;
  /** 纯前端节点标记（Reroute / PrimitiveNode / Note …） */
  virtual?: boolean;
  /** PrimitiveNode 的字面量取值，执行期直接内联给下游 */
  value?: unknown;
  /** 入参名的槽位顺序（bypass 穿透时按槽位匹配） */
  inputOrder?: string[];
  /** 入参名 → 类型（bypass 穿透时按类型匹配） */
  inputTypes?: Record<string, string>;
  /** 出参槽位 → 类型（bypass 穿透时确定目标类型） */
  outputTypes?: string[];
}

export interface ApiWorkflowNode {
  class_type: string;
  /** API inputs: 命名参数；数组 [nodeId, slotIdx] 表示连线 */
  inputs: Record<string, any>;
  _meta?: ApiNodeMeta;
}

export interface ConversionResult {
  graph: Record<string, ApiWorkflowNode>;
  positions: Record<string, [number, number]>;
  warnings: string[];
  /** True if we used the /object_info mapping; false if we fell back to heuristics. */
  usedObjectInfo: boolean;
}

/* ──────────────────────────────────────────────────────────────────────
 * 1) 格式识别
 * ────────────────────────────────────────────────────────────────────── */

/** Detect whether a JSON value is API format, raw format, or neither. */
export function detectFormat(json: unknown): WorkflowFormat | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as Record<string, any>;
  // API format: any top-level value has class_type + inputs
  const apiHit = Object.values(obj).some(
    (value) =>
      value &&
      typeof value === "object" &&
      typeof (value).class_type === "string" &&
      typeof (value).inputs === "object"
  );
  if (apiHit) return "api";
  // Raw format: has `nodes` array + each node has `type` (not class_type)
  if (
    Array.isArray(obj.nodes) &&
    obj.nodes.length > 0 &&
    obj.nodes.every(
      (n: any) => n && typeof n === "object" && typeof n.type === "string"
    )
  ) {
    return "raw";
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────────
 * 2) 从原始格式抽取节点坐标 (用于编辑器初始布局)
 * ────────────────────────────────────────────────────────────────────── */

export function extractPositions(raw: RawWorkflow): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  if (!Array.isArray(raw.nodes)) return out;
  for (const n of raw.nodes) {
    if (n && Array.isArray(n.pos) && n.pos.length >= 2) {
      const id = String(n.id);
      out[id] = [Number(n.pos[0]) || 0, Number(n.pos[1]) || 0];
    }
  }
  // 2026-08-13 R78.3: subgraph wrapper inner nodes (rawJson.definitions.subgraphs[uid].nodes)
  // are NOT in the top-level nodes[] — but they ARE part of `detail.nodes` /
  // `detail.graph` after the wrapper is expanded (the server stitches them under
  // `<wrapperId>:<internalId>` keys).  Without this loop, wrapper expansions
  // render with zero saved positions and the client falls back to Kahn
  // auto-layout even in RAW view, which never matches ComfyUI's look.
  // Inner-node `pos` is ALREADY an absolute canvas coord (LiteGraph stores
  // absolute positions for both top-level and sub-graph nodes), so we must
  // NOT add wrapper.pos to it.
  //
  // 2026-08-13 R78.3 (lookup fix): `definitions.subgraphs` is keyed by
  // numeric index "0", "1", ... — NOT by the wrapper UUID. The wrapper
  // UUID lives inside each sub def as `sub.id`. So we have to scan all
  // entries and match by `sub.id === wrapper.type` (the wrapper's `type`
  // IS the subgraph UUID in ComfyUI's format).
  const subs = (raw as unknown as { definitions?: { subgraphs?: Record<string, { id?: string; nodes?: any[] }> } })
    .definitions?.subgraphs;
  if (subs && typeof subs === "object") {
    for (const wrapper of raw.nodes) {
      if (!wrapper || typeof wrapper.type !== "string") continue;
      if (!Array.isArray(wrapper.pos)) continue;
      const wId = String(wrapper.id);
      let innerNodes: any[] | undefined;
      for (const k of Object.keys(subs)) {
        const def = subs[k];
        if (def?.id === wrapper.type && Array.isArray(def.nodes)) {
          innerNodes = def.nodes;
          break;
        }
      }
      if (!innerNodes) continue;
      for (const inner of innerNodes) {
        if (inner && Array.isArray(inner.pos) && inner.pos.length >= 2) {
          const iId = String(inner.id);
          out[`${wId}:${iId}`] = [Number(inner.pos[0]) || 0, Number(inner.pos[1]) || 0];
        }
      }
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────
 * 3) 把 raw 转换为 api (用于执行 /prompt)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * ComfyUI /object_info 的输入定义。
 *
 * ⚠️ 真实结构是 **元组** `[type, options?]`，不是带 `.type` 字段的对象：
 *   "seed":         ["INT",  { default: 0, min: 0, control_after_generate: true }]
 *   "model":        ["MODEL", {}]
 *   "sampler_name": [["euler", "euler_ancestral", …], {}]   ← COMBO：首项是候选数组
 * 少数新版（V3 schema）会给对象形式 `{ type: "INT", … }`，这里两种都兼容。
 */
type ObjectInfoInputSpec = [unknown, Record<string, any>?] | Record<string, any>;

interface ObjectInfoClassDef {
  input_order?: { required?: string[]; optional?: string[] };
  input?: {
    required?: Record<string, ObjectInfoInputSpec>;
    optional?: Record<string, ObjectInfoInputSpec>;
  };
  [k: string]: any;
}

/** 把 /object_info 的输入定义规范化为 { type, options }。 */
function readInputSpec(spec: ObjectInfoInputSpec | undefined): {
  type: string | null;
  options: Record<string, any>;
} {
  if (Array.isArray(spec)) {
    const head = spec[0];
    const options = (spec[1] ?? {}) as Record<string, any>;
    // COMBO：候选值以数组形式直接放在首项
    if (Array.isArray(head)) return { type: "COMBO", options };
    return { type: typeof head === "string" ? head : null, options };
  }
  if (spec && typeof spec === "object") {

    const type = (spec).type;

    if (Array.isArray(type)) return { type: "COMBO", options: spec };

    if (typeof type === "string") return { type: type, options: spec };

  }

  return { type: null, options: {} };
}

type ObjectInfo = Record<string, ObjectInfoClassDef>;

/** Fetch ComfyUI node-class definitions (cached for 5 minutes) */
let _objectInfoCache: { at: number; data: ObjectInfo } | null = null;
/** 失败负缓存时间戳：ComfyUI 不可达时每次 detail/subgraph 请求都会白等
 *  20s 超时（AbortSignal.timeout）才降级 null，而旧实现失败不写缓存，
 *  导致打开工作流 / 展开子工作流在 ComfyUI 未启动时反复拖慢 20s。
 *  失败后 30s 内直接返回 null，让慢请求只发生一次。 */
let _objectInfoFailedAt = 0;
export async function fetchObjectInfo(): Promise<ObjectInfo | null> {
  if (_objectInfoCache && Date.now() - _objectInfoCache.at < 5 * 60_000) {
    return _objectInfoCache.data;
  }
  if (_objectInfoFailedAt && Date.now() - _objectInfoFailedAt < 30_000) {
    return null;
  }
  try {
    const res = await fetch(`${comfyBase()}/api/object_info`, {
      /* 2026-08-16 R-ardot73-C: ComfyUI 序列化完整 object_info（~4.7MB）在
       * Node 的 undici fetch 下实测需 ~5.2s 才返回，旧值 2500ms 必然超时返
       * null，导致所有依赖 object_info 的 COMBO 选项解析静默失败（下拉退化
       * 成文本框）。放宽到 20s；object_info 有 5 分钟缓存，慢请求仅 5 分钟
       * 发生一次，放宽不影响常态响应。 */
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ObjectInfo;
    _objectInfoCache = { at: Date.now(), data };
    return data;
  } catch {
    _objectInfoFailedAt = Date.now();
    return null;
  }
}

/** Resolve widget order for a node class — the ordered list of input names
 *  whose values are scalars (widgets).  Widgets are inputs whose type is one
 *  of: INT, FLOAT, STRING, BOOLEAN, COMBO.  Connection types (MODEL, LATENT,
 *  IMAGE, CONDITIONING, CLIP, …) are excluded because their values come from
 *  `links`, not from `widgets_values`. */
const CONNECTION_TYPE_RE = /^(MODEL|LATENT|IMAGE|IMAGE_TENSOR|MASK|CONDITIONING|CLIP|CLIP_VISION|CLIP_VISION_OUTPUT|VAE|MODEL_PATCH|GLIGEN|UPSCALE_MODEL|STYLE_MODEL|CONTROL_NET|SIGMAS|NOISE|SAMPLER|MASKED_IMAGE|IMAGE_3D|MESH|VOXEL|MESH_HOLDER|LATENT_3D|LOAD_3D|LATENT_4D|AUDIO|VIDEO|INT_ARRAY|FLOAT_ARRAY|STRING_ARRAY|TRANSFORMERS_MODEL_TENSOR|MT5|MT5_MODEL|CLIP_MODEL|UNET|UNET_TIMESTEP_EMBEDDING)$/i;

/**
 * ComfyUI 前端会在 seed 类 INT 控件后面**自动插入**一个 `control_after_generate`
 * 伪控件（fixed / increment / decrement / randomize），它同样会被序列化进
 * `widgets_values`。不补上这一格，后面所有 widget 都会整体错位一位。
 * 用哨兵名占位，写回 API graph 时跳过（ComfyUI 的 INPUT_TYPES 里并没有它）。
 */
const CONTROL_SENTINEL = "__control_after_generate__";
const SEED_WIDGET_NAMES = new Set(["seed", "noise_seed"]);

function hasControlAfterGenerate(name: string, type: string, options: Record<string, any>): boolean {
  if (type !== "INT") return false;
  return SEED_WIDGET_NAMES.has(name) || options?.control_after_generate === true;
}

/**
 * 把节点的 raw `inputs[]`（每项带 `widget: {name}`，且可能带 `type`）与
 * `widgets_values[]` 按名字配对，自动跳过 ComfyUI 在 seed 类 INT 控件后
 * 插入的 `control_after_generate` 哨兵槽。
 *
 * ComfyUI 序列化时哨兵紧跟在 seed 值之后，因此 `widgets_values` 比 widget
 * 输入列表多一格——朴素的下标配对（input i → widgets_values[i]）会让 seed
 * 之后的每个控件整体错位一位。这里复刻 `resolveWidgetOrder` 的哨兵插入逻辑，
 * 使下标与磁盘上的顺序严格对齐。
 *
 * 返回 `widgetName → value` 映射；供画布展示用的 raw_inputs 配对（父子图
 * 两个 route 共用），避免重复实现导致再次错位。
 */
export function pairWidgetValues(
  inputs: { name?: string; widget?: { name?: string }; type?: string }[],
  widgetsValues: unknown[]
): Record<string, unknown> {
  // 规范 widget 顺序：按 raw inputs[] 顺序收集 widget 名，并在每个
  // seed/noise_seed INT 控件后插入 CONTROL_SENTINEL（正是 ComfyUI 序列化
  // widgets_values 时的顺序）。
  const order: string[] = [];
  for (const inp of inputs) {
    const wname = inp?.widget?.name;
    if (typeof wname !== "string") continue;
    order.push(wname);
    if (SEED_WIDGET_NAMES.has(wname) && (inp.type === "INT" || inp.type === undefined)) {
      order.push(CONTROL_SENTINEL);
    }
  }
  const map: Record<string, unknown> = {};
  order.forEach((name, i) => {
    if (name === CONTROL_SENTINEL) return;
    if (i < widgetsValues.length) map[name] = widgetsValues[i];
  });
  return map;
}

function resolveWidgetOrder(cls: ObjectInfoClassDef | undefined): string[] {
  if (!cls) return [];
  const reqOrder = cls.input_order?.required ?? [];
  const optOrder = cls.input_order?.optional ?? [];
  const req = cls.input?.required ?? {};
  const opt = cls.input?.optional ?? {};
  const out: string[] = [];
  const push = (name: string, defs: Record<string, ObjectInfoInputSpec>) => {
    const spec = defs[name];
    if (!spec) return;
    const { type, options } = readInputSpec(spec);
    if (!type) return;
    // 连接类型的值来自 links，不在 widgets_values 里。
    if (CONNECTION_TYPE_RE.test(type)) return;
    // forceInput 的标量输入被渲染成插槽，同样不占 widgets_values 的位置。
    if (options?.forceInput === true) return;
    out.push(name);
    if (hasControlAfterGenerate(name, type, options)) out.push(CONTROL_SENTINEL);
  };
  // widgets_values = required 全部 widget + optional 全部 widget 按顺序扁平化，
  // 只取 required 会从第一个 optional 起错位（VHS_VideoCombine / SaveAnimatedWEBP / KJNodes）。
  for (const k of reqOrder) push(k, req);
  for (const k of optOrder) push(k, opt);
  return out;
}

/** Full input order — widgets + connections interleaved in display order.
 *  Used to translate link `dst_slot` → input name. Must include optional
 *  inputs too, otherwise dst_slot indices for optional connection inputs miss. */
function resolveFullOrder(cls: ObjectInfoClassDef | undefined): string[] {
  if (!cls) return [];
  const req = cls.input_order?.required ?? [];
  const opt = cls.input_order?.optional ?? [];
  return [...req, ...opt];
}

/** Fallback widget mapping for common classes when /object_info is unavailable.
 *  The order here is the display order of WIDGET inputs only (connections
 *  excluded) — that matches how `widgets_values` is serialized on disk. */
const FALLBACK_WIDGETS: Record<string, string[]> = {
  KSampler: ["seed", CONTROL_SENTINEL, "steps", "cfg", "sampler_name", "scheduler", "denoise"],
  KSamplerAdvanced: [
    "add_noise",
    "noise_seed",
    CONTROL_SENTINEL,
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "start_at_step",
    "end_at_step",
    "return_with_leftover_noise",
  ],
  CLIPTextEncode: ["text"],
  CheckpointLoaderSimple: ["ckpt_name"],
  LoraLoader: ["lora_name", "strength_model", "strength_clip"],
  LoraLoaderModelOnly: ["lora_name", "strength_model"],
  EmptyLatentImage: ["width", "height", "batch_size"],
  EmptySD3LatentImage: ["width", "height", "batch_size"],
  VAEEncode: [],
  VAEDecode: [],
  SaveImage: ["filename_prefix"],
  SaveImageAdvanced: ["filename_prefix", "output_type"],
  PreviewImage: [],
  LoadImage: ["image"],
  ImageScale: ["width", "height", "upscale_method", "crop"],
  ImageScaleBy: ["scale_by", "upscale_method"],
  VAELoader: ["vae_name"],
  CLIPSetLastLayer: ["stop_at_clip_layer"],
  CLIPVisionLoader: ["clip_name"],
  DualCLIPLoader: ["clip_name1", "clip_name2", "type", "device"],
  UNETLoader: ["unet_name", "weight_dtype"],
  ControlNetLoader: ["control_net_name"],
  UpscaleModelLoader: ["upscale_model_name"],
};

/** Fallback FULL input order (widgets + connections) for slot→name mapping. */
const FALLBACK_FULL: Record<string, string[]> = {
  KSampler: ["model", "positive", "negative", "latent_image", "seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"],
  KSamplerAdvanced: [
    "model", "positive", "negative", "latent_image",
    "add_noise", "noise_seed", "steps", "cfg", "sampler_name", "scheduler",
    "start_at_step", "end_at_step", "return_with_leftover_noise",
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

/* ──────────────────────────────────────────────────────────────────────
 * 3.1) 节点索引 —— 抹平 raw 的两种连线表达
 * ────────────────────────────────────────────────────────────────────── */

interface NodeInputSlot {
  name: string;
  type?: string;
  /** raw.links 里的 link id；null 表示该槽位没有接线 */
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
  type?: string;
}

/** link id → 起点。每条 link 是 [link_id, src_id, src_slot, dst_id, dst_slot, type]。 */
function buildLinkMap(raw: RawWorkflow): Map<number, LinkRef> {
  const map = new Map<number, LinkRef>();
  for (const l of raw.links ?? []) {
    if (!Array.isArray(l) || l.length < 5) continue;
    map.set(Number(l[0]), {
      originId: String(l[1]),
      originSlot: Number(l[2]),
      type: typeof l[5] === "string" ? l[5] : undefined,
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
function indexNodes(
  raw: RawWorkflow,
  fullOrder: Map<string, string[]>
): Map<string, IndexedNode> {
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
      const order = fullOrder.get(type) ?? [];
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
        ? n.outputs.map((output) => (output && typeof output.type === "string" ? output.type : ""))
        : [],
    });
  }
  return byId;
}

/** 把 widgets_values 按 widget 顺序摊平成命名参数。 */
function applyWidgets(
  node: RawNode,
  widgetNames: string[],
  clsType: string,
  id: string,
  warnings: string[],
  inputs: Record<string, any>
) {
  const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  if (!widgets.length) return;
  if (!widgetNames.length) {
    warnings.push(`${clsType}#${id}：未知节点类，widget 值无法还原为命名参数`);
    return;
  }
  // 老版本前端存的 widgets_values 里没有 control_after_generate 这一格。
  // 用长度精确匹配挑顺序，避免「多补一格」反而把所有值推错位。
  const bare = widgetNames.filter((widgetName) => widgetName !== CONTROL_SENTINEL);
  const names =
    bare.length !== widgetNames.length && widgets.length === bare.length ? bare : widgetNames;

  for (let i = 0; i < widgets.length && i < names.length; i++) {
    const key = names[i];
    if (key === CONTROL_SENTINEL) continue; // 伪控件，不是真实 input
    inputs[key!] = widgets[i]!;
  }
}

/** raw → API 的公共主体，convertRawToApi / fallbackRawToApi 共用。 */
function buildApiGraph(
  raw: RawWorkflow,
  widgetOrder: Map<string, string[]>,
  fullOrder: Map<string, string[]>,
  warnings: string[]
): Record<string, ApiWorkflowNode> {
  const graph: Record<string, ApiWorkflowNode> = {};
  const linkMap = buildLinkMap(raw);
  const index = indexNodes(raw, fullOrder);
  let inactive = 0;

  for (const idx of index.values()) {
    const inputs: Record<string, any> = {};

    applyWidgets(idx.raw, widgetOrder.get(idx.type) ?? [], idx.type, idx.id, warnings, inputs);

    for (const slot of idx.inputs) {
      if (slot.link == null) continue;
      const ref = linkMap.get(slot.link);
      if (!ref) {
        warnings.push(`${idx.type}#${idx.id}：入参 ${slot.name} 的 link=${slot.link} 不在 links 表中`);
        continue;
      }
      inputs[slot.name] = [ref.originId, ref.originSlot];
    }

    // `_meta` 只在本地存储/画布使用，执行前会被 prepareGraphForExecution 剥掉。
    const meta: ApiNodeMeta = {};
    const title = idx.raw.title ?? idx.raw.properties?.title;
    if (title) meta.title = String(title);
    if (idx.mode !== NODE_MODE_ALWAYS) meta.mode = idx.mode;
    if (idx.virtual) meta.virtual = true;

    const skipped =
      idx.virtual || idx.mode === NODE_MODE_BYPASS || idx.mode === NODE_MODE_NEVER;
    if (skipped) {
      inactive += 1;
      meta.inputOrder = idx.inputs.map((input) => input.name);
      const types: Record<string, string> = {};
      for (const s of idx.inputs) if (s.type) types[s.name] = s.type;
      if (Object.keys(types).length) meta.inputTypes = types;
      if (idx.outputTypes.length) meta.outputTypes = idx.outputTypes;
      if (idx.type === "PrimitiveNode") {

        const value = Array.isArray(idx.raw.widgets_values) ? idx.raw.widgets_values[0] : undefined;

        if (value !== undefined) meta.value = value;

      }

    }

    graph[idx.id] = {
      class_type: idx.type,
      inputs,
      ...(Object.keys(meta).length ? { _meta: meta } : {}),
    };
  }

  if (inactive > 0) {
    warnings.push(
      `${inactive} 个节点为 bypass / 静音 / 中转节点：已保留在图中供画布展示，提交执行时会被剔除并穿透连线`
    );
  }
  return graph;
}

/** Best-effort conversion: raw → api. Returns empty graph + warning when unparseable. */
export async function convertRawToApi(raw: RawWorkflow): Promise<ConversionResult> {
  const warnings: string[] = [];
  const positions = extractPositions(raw);
  const graph: Record<string, ApiWorkflowNode> = {};

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
    return { graph, positions, warnings: ["raw.nodes 为空"], usedObjectInfo: false };
  }

  // Try to fetch /object_info for accurate widget/connection mapping.
  const info = await fetchObjectInfo();
  const usedObjectInfo = !!info;

  // Two parallel maps: widget-only (for widgets_values) and full-order (for links).
  const widgetOrder = new Map<string, string[]>();
  const fullOrder = new Map<string, string[]>();
  if (info) {
    for (const [clsName, def] of Object.entries(info)) {
      widgetOrder.set(clsName, resolveWidgetOrder(def));
      fullOrder.set(clsName, resolveFullOrder(def));
    }
  } else {
    for (const [clsName, list] of Object.entries(FALLBACK_WIDGETS)) widgetOrder.set(clsName, list);
    for (const [clsName, list] of Object.entries(FALLBACK_FULL)) fullOrder.set(clsName, list);
    warnings.push("ComfyUI /object_info 不可达，使用启发式 widget 映射（部分字段可能错位）");
  }

  Object.assign(graph, buildApiGraph(raw, widgetOrder, fullOrder, warnings));

  return { graph, positions, warnings, usedObjectInfo };
}

/** Synchronous variant using only the fallback heuristics — used for offline import. */
export function fallbackRawToApi(raw: RawWorkflow): ConversionResult {
  const warnings: string[] = ["使用 fallback widget 映射（未尝试连接 ComfyUI）"];
  const positions = extractPositions(raw);
  const graph: Record<string, ApiWorkflowNode> = {};
  if (!Array.isArray(raw.nodes)) return { graph, positions, warnings, usedObjectInfo: false };

  const widgetOrder = new Map<string, string[]>(Object.entries(FALLBACK_WIDGETS));
  const fullOrder = new Map<string, string[]>(Object.entries(FALLBACK_FULL));
  Object.assign(graph, buildApiGraph(raw, widgetOrder, fullOrder, warnings));
  return { graph, positions, warnings, usedObjectInfo: false };
}

/* ──────────────────────────────────────────────────────────────────────
 * 4) 执行前的最后一道处理：对齐 ComfyUI 前端的 graphToPrompt
 *
 * ComfyUI 提交 prompt 时并不是原样发送画布：
 *   - mode 2（静音）/ mode 4（旁路）的节点**不会出现在 prompt 里**；
 *   - 旁路节点的连线要「穿透」——按类型在它自己的入参里找同类型的上游；
 *   - Reroute / PrimitiveNode / Note 这类纯前端节点同样不入 prompt，
 *     Reroute 透传连线，PrimitiveNode 把字面量灌给下游。
 *
 * 存库的 graph 保留全部节点（画布要画出来），执行前才跑这一遍。
 * ────────────────────────────────────────────────────────────────────── */

export interface ExecutionPrep {
  graph: Record<string, ApiWorkflowNode>;
  /** 被剔除的节点 id（bypass / 静音 / 纯前端节点） */
  removed: string[];
  /** 因上游被静音而彻底断链、只能丢弃的入参数量 */
  droppedInputs: number;
}

/** 判断一个 input 值是否为连线引用 `[nodeId, slot]`（且目标节点真实存在）。 */
function isLinkRef(
  v: unknown,
  graph: Record<string, ApiWorkflowNode>
): v is [string | number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[1] === "number" &&
    (typeof v[0] === "string" || typeof v[0] === "number") &&
    !!graph[String(v[0])]
  );
}

type ResolvedOrigin =
  | { kind: "link"; value: [string, number] }
  | { kind: "value"; value: unknown };

export function prepareGraphForExecution(input: Record<string, any>): ExecutionPrep {
  const graph = (input ?? {}) as Record<string, ApiWorkflowNode>;

  const removed: string[] = [];
  for (const [id, n] of Object.entries(graph)) {
    if (!n || typeof n !== "object") continue;
    const meta = n._meta ?? {};
    const mode = Number(meta.mode ?? NODE_MODE_ALWAYS);
    if (
      mode === NODE_MODE_NEVER ||
      mode === NODE_MODE_BYPASS ||
      meta.virtual === true ||
      isVirtualNodeType(n.class_type)
    ) {
      removed.push(id);
    }
  }
  const inactive = new Set(removed);

  /** 沿着被剔除的节点向上游走，直到落到一个真正会执行的节点。 */
  function walk(originId: string, originSlot: number, depth: number): ResolvedOrigin | null {
    if (depth > 64) return null; // 环保护
    const node = graph[originId];
    if (!node) return null;
    if (!inactive.has(originId)) return { kind: "link", value: [originId, originSlot] };

    const meta = node._meta ?? {};
    // 静音节点不透传：下游这一路直接断掉（与 ComfyUI 行为一致）。
    if (Number(meta.mode ?? NODE_MODE_ALWAYS) === NODE_MODE_NEVER) return null;
    // PrimitiveNode：把字面量直接内联给下游。
    if (meta.value !== undefined) return { kind: "value", value: meta.value };

    const order = meta.inputOrder ?? Object.keys(node.inputs ?? {});
    const types = meta.inputTypes ?? {};
    const wanted = meta.outputTypes?.[originSlot];

    // ComfyUI 的顺序：先试与输出槽同序号的入参，再遍历其余入参做类型匹配。
    const seen = new Set<string>();
    const candidates: string[] = [];
    const sameSlot = order[originSlot];
    if (sameSlot) {
      candidates.push(sameSlot);
      seen.add(sameSlot);
    }
    for (const nm of order) {
      if (seen.has(nm)) continue;
      candidates.push(nm);
      seen.add(nm);
    }

    for (const nm of candidates) {

      const value = node.inputs?.[nm];

      if (!isLinkRef(value, graph)) continue;

      if (wanted && types[nm] && types[nm].toUpperCase() !== wanted.toUpperCase()) continue;

      return walk(String(value[0]), Number(value[1]), depth + 1);

    }


    // 类型信息缺失（老工作流没存 type）时：只有一条入线就直接穿过去。
    const linked = candidates.filter((nm) => isLinkRef(node.inputs?.[nm], graph));
    if (linked.length === 1) {

      const value = node.inputs[linked[0]!] as [string | number, number];

      return walk(String(value[0]), Number(value[1]), depth + 1);

    }

    return null;
  }

  const out: Record<string, ApiWorkflowNode> = {};
  let droppedInputs = 0;

  for (const [id, n] of Object.entries(graph)) {
    if (!n || typeof n !== "object" || inactive.has(id)) continue;
    const inputs: Record<string, any> = {};
    for (const [k, v] of Object.entries(n.inputs ?? {})) {
      if (!isLinkRef(v, graph)) {
        inputs[k] = v;
        continue;
      }
      const resolved = walk(String(v[0]), Number(v[1]), 0);
      if (!resolved) {
        droppedInputs += 1;
        continue;
      }
      inputs[k] = resolved.value;
    }
    const title = n._meta?.title;
    // 只保留官方认可的 `_meta.title`，本地字段一律不外发。
    out[id] = { class_type: n.class_type, inputs, ...(title ? { _meta: { title } } : {}) };
  }

  return { graph: out, removed, droppedInputs };
}