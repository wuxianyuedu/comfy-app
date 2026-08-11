import { listModels } from "./client";
import { getWorkflow } from "./_meta";
import txt2img from "./workflows/txt2img.json";
import img2img from "./workflows/img2img.json";
import inpaint from "./workflows/inpaint.json";
import upscale from "./workflows/upscale.json";
import txt2video from "./workflows/txt2video.json";
import img2video from "./workflows/img2video.json";
import flfvideo from "./workflows/flfvideo.json";

const TEMPLATES: Record<string, unknown> = {
  txt2img,
  img2img,
  inpaint,
  upscale,
  txt2video,
  img2video,
  flfvideo,
};

export type LoraSpec = { name: string; weight: number };

export type GenerateParams = {
  prompt?: string;
  negative?: string;
  checkpoint?: string; // fileName — must match ComfyUI exactly
  loras?: LoraSpec[];
  sampler?: string;
  scheduler?: string;
  steps?: number;
  cfg?: number;
  size?: string; // e.g. "1024x1024"
  count?: number;
  seed?: number;
  denoise?: number;
  inputImage?: string; // filename already in ComfyUI input dir (img2img)
  prefix?: string;
  // image editing
  mask?: string;
  upscaleModel?: string;
  // video
  frames?: number;
  fps?: number;
  wanModel?: string;
  wanVae?: string;
  t5Model?: string;
  // LTX video
  ltxModel?: string;
  duration?: number;
  resolution?: string;
  firstFrame?: string; // filename already in ComfyUI input dir (首尾帧首图)
  lastFrame?: string; // filename already in ComfyUI input dir (首尾帧尾图)
  // Custom workflow: user-curated exposed pins from the IO-edit mode
  workflowInputs?: { nodeId: string; name: string; value?: any }[];
};

export type BuildResult = {
  ok: boolean;
  prompt?: Record<string, unknown>;
  error?: string;
};

/**
 * Maps a user-imported workflow's role nodes to specific node ids, so the UI
 * can override which CLIPTextEncode is the positive prompt, etc. All fields
 * are optional — any that are missing fall back to auto-detection.
 */
export type ParamMap = {
  positiveNode?: string;
  negativeNode?: string;
  checkpointNode?: string;
  samplerNode?: string;
  // LoadImage node whose `image` input should receive a fed upstream image
  // (set automatically when detected, or manually in the UI).
  inputImageNode?: string;
};

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
export function buildWorkflowPreview(graph: Record<string, any>): WorkflowPreview {
  const entries = Object.entries(graph).filter(
    ([, n]) => n && typeof n === "object" && typeof (n as any).class_type === "string"
  );
  const total = entries.length;
  if (total === 0) {
    return { nodes: [], edges: [], total: 0, width: 280, height: 80, truncated: false };
  }

  // Collect edges from any input that is a [nodeId, outputIndex] tuple.
  const incoming: Record<string, Set<string>> = {};
  const outAdj: Record<string, Set<string>> = {};
  for (const [id] of entries) {
    incoming[id] = new Set();
    outAdj[id] = new Set();
  }
  for (const [id, node] of entries) {
    const inputs = (node as any).inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const v of Object.values(inputs)) {
      if (Array.isArray(v) && v.length >= 1 && typeof v[0] === "string" && outAdj[v[0]]) {
        incoming[id].add(v[0]);
        outAdj[v[0]].add(id);
      }
    }
  }

  // Longest-path layer (Kahn-style BFS with depth = max parent depth + 1).
  const level: Record<string, number> = {};
  const remaining = new Map<string, number>(
    Object.entries(incoming).map(([k, v]) => [k, v.size])
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
    for (const nxt of outAdj[id]) {
      level[nxt] = Math.max(level[nxt] ?? 0, level[id] + 1);
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
    const sinks = visible.filter((id) => classifyNode((graph[id] as any).class_type) === "output");
    const sources = visible.filter((id) => classifyNode((graph[id] as any).class_type) === "input");
    const mid = visible.filter((id) => !sinks.includes(id) && !sources.includes(id));
    mid.sort((a, b) => level[a] - level[b]);
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

  // Compute the densest level for vertical sizing.
  const maxRows = Math.max(1, ...Object.values(byLevel).map((a) => a.length));
  // Number of distinct levels (1 means everything is a single column).
  const levelCount = Object.keys(byLevel).length || 1;

  // Layout constants.
  const width = 280;
  const height = 80;
  const padX = 16;
  const padY = 12;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const colStep = levelCount > 1 ? innerW / (levelCount - 1) : 0;

  const nodes: WorkflowPreviewNode[] = visible.map((id) => {
    const lv = level[id] ?? 0;
    const arr = byLevel[lv];
    const row = arr.indexOf(id);
    const x = padX + (levelCount > 1 ? lv * colStep : innerW / 2);
    const y = padY + (maxRows > 1 ? (row / (maxRows - 1)) * innerH : innerH / 2);
    return {
      id,
      class_type: (graph[id] as any).class_type,
      kind: classifyNode((graph[id] as any).class_type),
      level: lv,
      row,
    };
  });

  // Edges: only between visible nodes.
  const visibleSet = new Set(visible);
  const edges: WorkflowPreviewEdge[] = [];
  for (const id of visible) {
    for (const nxt of outAdj[id]) {
      if (visibleSet.has(nxt)) edges.push({ from: id, to: nxt });
    }
  }

  return { nodes, edges, total, width, height, truncated };
}

/**
 * Auto-detect the role nodes of an imported ComfyUI graph:
 *  - first two CLIPTextEncode → positive / negative prompt
 *  - first CheckpointLoaderSimple → model
 *  - first KSampler → sampler
 */
/**
 * Walk upstream from a conditioning link until we reach the text-encode node
 * that actually holds the prompt string (CLIPTextEncode / SDXL / Flux …). This
 * follows the real graph topology instead of guessing by node id order.
 */
function findTextEncoder(
  graph: Record<string, any>,
  startId: string | undefined,
  visited = new Set<string>()
): string | null {
  if (!startId || visited.has(startId)) return null;
  visited.add(startId);
  const node = graph[startId];
  if (!node || !node.inputs) return null;
  const TEXT_FIELDS = ["text", "text_g", "text_l", "prompt", "positive", "negative", "text_positive", "text_negative"];
  for (const f of TEXT_FIELDS) {
    const v = node.inputs[f];
    if (typeof v === "string" && !Array.isArray(v)) return startId;
  }
  for (const v of Object.values(node.inputs)) {
    if (Array.isArray(v) && typeof v[0] === "string" && graph[v[0]]) {
      const r = findTextEncoder(graph, v[0], visited);
      if (r) return r;
    }
  }
  return null;
}

function isSamplerLike(node: any): boolean {
  return !!node?.inputs && Array.isArray(node.inputs.positive) && Array.isArray(node.inputs.negative);
}

/**
 * Auto-detect the role nodes of an imported ComfyUI graph.
 *
 * Positive/negative are no longer guessed by node id order — they follow the
 * KSampler's `positive`/`negative` conditioning links upstream to the actual
 * text-encode node (CLIPTextEncode / SDXL / Flux / T5 …). Falls back to the
 * first two CLIPTextEncode when no sampler is present.
 */
export function detectParamMap(graph: Record<string, any>): ParamMap {
  const map: ParamMap = {};
  const ids = Object.keys(graph);
  const nodes = ids.map((id) => ({ id, node: graph[id] }));

  const sampler = nodes.find(
    (x) =>
      x.node &&
      (x.node.class_type === "KSampler" ||
        x.node.class_type === "KSamplerAdvanced" ||
        isSamplerLike(x.node))
  );
  if (sampler) {
    const posEnc = findTextEncoder(graph, sampler.node.inputs.positive?.[0]);
    const negEnc = findTextEncoder(graph, sampler.node.inputs.negative?.[0]);
    if (posEnc) map.positiveNode = posEnc;
    if (negEnc) map.negativeNode = negEnc;
  }
  // Fallback: first two CLIPTextEncode by id (preserves old behavior if no sampler).
  if (!map.positiveNode || !map.negativeNode) {
    const clips = nodes.filter((x) => x.node?.class_type === "CLIPTextEncode");
    if (!map.positiveNode && clips[0]) map.positiveNode = clips[0].id;
    if (!map.negativeNode && clips[1]) map.negativeNode = clips[1].id;
  }

  const ckpt = nodes.find((x) => x.node?.class_type === "CheckpointLoaderSimple");
  if (ckpt) map.checkpointNode = ckpt.id;

  const ks = nodes.find(
    (x) => x.node?.class_type === "KSampler" || x.node?.class_type === "KSamplerAdvanced"
  );
  if (ks) map.samplerNode = ks.id;

  const li = nodes.find((x) => x.node?.class_type === "LoadImage");
  if (li) map.inputImageNode = li.id;

  return map;
}

function replaceTokens(obj: unknown, values: Record<string, string>): unknown {
  if (typeof obj === "string") {
    let s = obj;
    for (const [k, v] of Object.entries(values)) {
      s = s.split(k).join(v);
    }
    return s;
  }
  if (Array.isArray(obj)) return obj.map((x) => replaceTokens(x, values));
  if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = replaceTokens(v, values);
    return out;
  }
  return obj;
}

/**
 * ComfyUI seeds are unsigned 32-bit integers. The old code used
 * `Math.random() * 0xffffffffffffffff` (2^64), which is both beyond
 * `Number.MAX_SAFE_INTEGER` (so the value lost integer precision) and beyond
 * the uint32 range ComfyUI expects. Generate a safe seed in [0, 2^32-1].
 */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

/** Clamp a user-provided seed into the valid uint32 range ComfyUI accepts. */
function clampSeed(seed: number): number {
  const t = Math.trunc(seed);
  if (!Number.isFinite(t)) return randomSeed();
  return Math.max(0, Math.min(0xffffffff, t));
}

/**
 * Token substitution turns every `__TOKEN__` value into a string, and
 * `replaceTokens` substitutes them verbatim. ComfyUI's INT/FLOAT input
 * validation rejects string values, so coerce the known numeric input names
 * back to numbers after the token pass. Guarded by an allow-list of numeric
 * field names so genuinely-string fields (ckpt_name, text, prefix) stay strings.
 */
const NUMERIC_INPUT_NAMES = new Set([
  "seed", "noise_seed", "variation_seed", "variation_seed_strength",
  "steps", "cfg", "denoise", "shift", "guidance", "guidance_scale",
  "width", "height", "batch_size", "count", "frames", "fps", "num_frames",
  "loop_count", "frame_rate", "riflex_freq_index", "base_shift", "max_shift",
  "samples", "num_inference_steps", "strength", "noise", "clip_sample",
]);

function coerceNumericFields(graph: Record<string, any>): void {
  for (const node of Object.values(graph) as any[]) {
    if (!node || !node.inputs) continue;
    for (const key of Object.keys(node.inputs)) {
      if (!NUMERIC_INPUT_NAMES.has(key)) continue;
      const v = node.inputs[key];
      if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
        node.inputs[key] = Number(v);
      }
    }
  }
}

const CHECKPOINT_LOADER = new Set([
  "CheckpointLoaderSimple",
  "CheckpointLoader",
  "unCLIPCheckpointLoader",
  "CheckpointLoaderNF4",
]);
const UNET_LOADER = new Set(["UNETLoader", "UNETLoaderGGUF", "ModelLoader"]);
const CLIP_LOADER = new Set(["DualCLIPLoader", "TripleCLIPLoader", "CLIPLoader", "CLIPLoaderGGUF"]);

/**
 * Inject a chain of LoraLoader nodes. Supports Flux / SD3 / WAN workflows whose
 * base model+clip come from UNETLoader + DualCLIPLoader (or Triple/CLIPLoader)
 * instead of a single CheckpointLoaderSimple. Returns the base loader outputs
 * and the id of the last LoraLoader so callers can re-point only the nodes that
 * originally consumed the base model/clip (preserving refiner / dual-CLIP chains).
 */
function injectLoras(
  graph: Record<string, any>,
  loras: LoraSpec[]
): { baseModel: [string, number] | null; baseClip: [string, number] | null; lastLora: string | null } {
  let baseModel: [string, number] | null = null;
  let baseClip: [string, number] | null = null;
  for (const [id, node] of Object.entries(graph)) {
    if (!node || !node.class_type) continue;
    if (CHECKPOINT_LOADER.has(node.class_type)) {
      // CheckpointLoaderSimple: outputs [MODEL0, CLIP1, VAE2].
      if (!baseModel) baseModel = [id, 0];
      if (!baseClip) baseClip = [id, 1];
    } else if (UNET_LOADER.has(node.class_type) && !baseModel) {
      baseModel = [id, 0];
    } else if (CLIP_LOADER.has(node.class_type) && !baseClip) {
      baseClip = [id, 0];
    }
  }
  if (!baseModel) return { baseModel: null, baseClip: null, lastLora: null };

  let prevModel: [string, number] = baseModel;
  let prevClip: [string, number] | null = baseClip;
  const loraIds: string[] = [];
  loras.forEach((lora, i) => {
    const id = `lora_${i}`;
    const inputs: Record<string, any> = {
      lora_name: lora.name,
      strength_model: lora.weight,
      model: prevModel,
    };
    if (prevClip) {
      inputs.strength_clip = lora.weight;
      inputs.clip = prevClip;
    }
    graph[id] = { class_type: "LoraLoader", inputs };
    prevModel = [id, 0];
    if (prevClip) prevClip = [id, 1];
    loraIds.push(id);
  });
  return { baseModel, baseClip, lastLora: loraIds.length ? loraIds[loraIds.length - 1] : null };
}

/** Re-point only the loader outputs that originally fed the base model/clip.
 *  Skips the injected LoraLoader nodes themselves (their model/clip inputs
 *  legitimately reference the previous link in the chain). */
function rewireLoaders(
  graph: Record<string, any>,
  baseModel: [string, number] | null,
  baseClip: [string, number] | null,
  lastLora: string
) {
  for (const node of Object.values(graph)) {
    if (!node || !node.inputs) continue;
    if (node.class_type === "LoraLoader" || node.class_type === "LoraLoaderModelOnly") continue;
    if (
      baseModel &&
      Array.isArray(node.inputs.model) &&
      node.inputs.model[0] === baseModel[0] &&
      node.inputs.model[1] === baseModel[1]
    ) {
      node.inputs.model = [lastLora, 0];
    }
    if (
      baseClip &&
      Array.isArray(node.inputs.clip) &&
      node.inputs.clip[0] === baseClip[0] &&
      node.inputs.clip[1] === baseClip[1]
    ) {
      node.inputs.clip = [lastLora, 1];
    }
  }
}

/** Set the prompt string on a CLIPTextEncode-style node (handles SDXL text_g/text_l). */
function setPromptText(node: any, prompt: string) {
  if (!node || !node.inputs) return;
  if (node.inputs.text_g !== undefined) {
    // SDXL / SDXL-simplified: both text_g and text_l carry the prompt.
    node.inputs.text_g = prompt;
    if (node.inputs.text_l !== undefined) node.inputs.text_l = prompt;
  } else if (!Array.isArray(node.inputs.text)) {
    // Plain CLIPTextEncode: `text` is the prompt (unless it's a link).
    node.inputs.text = prompt;
  }
}

export async function buildAndValidate(
  templateName: string,
  params: GenerateParams
): Promise<BuildResult> {
  const meta = getWorkflow(templateName);
  if (!meta) return { ok: false, error: `未知工作流: ${templateName}` };
  const template = TEMPLATES[templateName];
  if (!template) return { ok: false, error: `缺少模板文件: ${templateName}` };

  // Validate the checkpoint exists on disk (filename contract). Only enforced
  // for templates that actually use a CheckpointLoaderSimple.
  const usesCheckpoint = (meta.supports ?? []).includes("checkpoint");
  try {
    const available = await listModels("checkpoints");
    if (available.length && usesCheckpoint && params.checkpoint && !available.includes(params.checkpoint)) {
      return {
        ok: false,
        error: `模型不可用或文件名不匹配: ${params.checkpoint}`,
      };
    }
  } catch {
    // ComfyUI unreachable — let submission surface the error later.
  }

  const def = meta.defaultParams ?? {};
  const [w, h] = (params.size ?? (def.size as string) ?? "1024x1024").split("x").map((n) => parseInt(n, 10));
  const values: Record<string, string> = {
    __CKPT__: params.checkpoint ?? "",
    __PROMPT__: params.prompt ?? "",
    __NEG__: params.negative ?? "",
    __W__: String(w || 1024),
    __H__: String(h || 1024),
    __COUNT__: String(params.count ?? 1),
    __SEED__: String(params.seed ?? randomSeed()),
    __STEPS__: String(params.steps ?? 25),
    __CFG__: String(params.cfg ?? 7),
    __SAMPLER__: params.sampler ?? "euler",
    __SCHEDULER__: params.scheduler ?? "normal",
    __DENOISE__: String(params.denoise ?? (templateName === "img2img" ? 0.65 : 1)),
    __INPUT__: params.inputImage ?? "",
    __PREFIX__: params.prefix ?? "ComfyAPP",
    __UPSCALE_MODEL__: params.upscaleModel ?? (def.upscaleModel as string) ?? "4x-UltraSharp.pth",
    __WAN_MODEL__: params.wanModel ?? (def.wanModel as string) ?? "",
    __WAN_VAE__: params.wanVae ?? (def.wanVae as string) ?? "",
    __T5_MODEL__: params.t5Model ?? (def.t5Model as string) ?? "",
    __FRAMES__: String(params.frames ?? (def.frames as number) ?? 81),
    __FPS__: String(params.fps ?? (def.fps as number) ?? 16),
    __FIRST_FRAME__: params.firstFrame ?? "",
    __LAST_FRAME__: params.lastFrame ?? "",
  };

  const graph = replaceTokens(template, values) as Record<string, any>;

  // ComfyUI rejects string values for numeric inputs, but token substitution
  // produces strings. Coerce the known numeric fields back to numbers after the
  // token pass (handles WAN video nodes, sampler steps/cfg, seed, width, etc.).
  coerceNumericFields(graph);

  // Re-wire model/clip if LoRAs are present.
  if (params.loras && params.loras.length) {
    const { baseModel, baseClip, lastLora } = injectLoras(graph, params.loras);
    if (lastLora) rewireLoaders(graph, baseModel, baseClip, lastLora);
  }

  return { ok: true, prompt: graph };
}

/**
 * Build a graph from a user-imported ComfyUI workflow (API format).
 *
 * Two modes:
 *  - If the graph still contains our `__PROMPT__`-style placeholders, run the
 *    same token replacement as built-in templates (advanced users who export
 *    with tokens).
 *  - Otherwise auto-inject by node detection: prompt/negative into the first
 *    two CLIPTextEncode nodes, and steps/cfg/seed/sampler/scheduler/checkpoint
 *    into the matching nodes when present. This lets a plain "Export (API
 *    Format)" graph be reused with new prompts without manual editing.
 */
export function buildCustomWorkflow(
  graph: Record<string, any>,
  params: GenerateParams,
  paramMap?: ParamMap | null
): Record<string, any> {
  const out: Record<string, any> = JSON.parse(JSON.stringify(graph));

  const serialized = JSON.stringify(out);
  const hasTokens =
    serialized.includes("__PROMPT__") ||
    serialized.includes("__NEG__") ||
    serialized.includes("__SEED__");

  if (hasTokens) {
    const [w, h] = (params.size ?? "1024x1024").split("x").map((n) => parseInt(n, 10));
    const values: Record<string, string> = {
      __PROMPT__: params.prompt ?? "",
      __NEG__: params.negative ?? "",
      __SEED__: String(params.seed ?? randomSeed()),
      __STEPS__: String(params.steps ?? 25),
      __CFG__: String(params.cfg ?? 7),
      __W__: String(w || 1024),
      __H__: String(h || 1024),
      __COUNT__: String(params.count ?? 1),
      __CKPT__: params.checkpoint ?? "",
      __SAMPLER__: params.sampler ?? "euler",
      __SCHEDULER__: params.scheduler ?? "normal",
      __DENOISE__: String(params.denoise ?? 0.65),
      __FIRST_FRAME__: params.firstFrame ?? "",
      __LAST_FRAME__: params.lastFrame ?? "",
      __INPUT__: params.inputImage ?? "",
    };
    const tok = replaceTokens(out, values) as Record<string, any>;
    coerceNumericFields(tok);
    return tok;
  }

  // Use the user-supplied role mapping, else fall back to auto-detection.
  const map: ParamMap =
    paramMap && Object.keys(paramMap).length ? paramMap : detectParamMap(out);

  // Prompt/negative are only overridden when explicitly supplied — otherwise a
  // workflow with a baked-in prompt must keep it (the old code wiped it to "").
  if (map.positiveNode && out[map.positiveNode] && params.prompt !== undefined) {
    setPromptText(out[map.positiveNode], params.prompt);
  }
  if (map.negativeNode && out[map.negativeNode] && params.negative !== undefined) {
    setPromptText(out[map.negativeNode], params.negative);
  }

  if (params.checkpoint && map.checkpointNode && out[map.checkpointNode]?.inputs) {
    const ck = out[map.checkpointNode];
    if (ck.inputs.ckpt_name !== undefined) ck.inputs.ckpt_name = params.checkpoint;
  }

  const seedNum = params.seed;
  if (map.samplerNode && out[map.samplerNode]) {
    const n = out[map.samplerNode];
    if (typeof params.steps === "number") n.inputs.steps = params.steps;
    if (typeof params.cfg === "number") n.inputs.cfg = params.cfg;
    // KSampler uses `seed`, KSamplerAdvanced uses `noise_seed`.
    // Note: seed=0 is a valid, intentional value — the old `> 0` guard dropped it.
    const seedKey = n.class_type === "KSamplerAdvanced" ? "noise_seed" : "seed";
    if (typeof seedNum === "number" && !Number.isNaN(seedNum)) {
      n.inputs[seedKey] = clampSeed(seedNum);
    }
    if (params.sampler) n.inputs.sampler_name = params.sampler;
    if (params.scheduler) n.inputs.scheduler = params.scheduler;
  }

  // Feed an upstream-generated (or manually uploaded) image into the
  // workflow's LoadImage node so chains like 图生图 work out of the box.
  if (params.inputImage && map.inputImageNode && out[map.inputImageNode]?.inputs) {
    out[map.inputImageNode].inputs.image = params.inputImage;
  }

  // Apply user-curated exposed-pin values (the dynamic form). These win over
  // the auto-injection above, so an explicitly set pin always takes effect.
  // Numeric coercion: ComfyUI rejects string values for numeric inputs, so when
  // the existing pin already holds a number we coerce a numeric-looking string.
  if (params.workflowInputs && Array.isArray(params.workflowInputs)) {
    for (const it of params.workflowInputs as { nodeId: string; name: string; value?: unknown }[]) {
      const node = out[it.nodeId];
      if (!node || !node.inputs) continue;
      const v = it.value;
      if (v === undefined) continue;
      const cur = node.inputs[it.name];
      let assigned: unknown = v;
      if (typeof cur === "number" && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
        assigned = Number(v);
      }
      node.inputs[it.name] = assigned;
    }
  }

  // Re-wire model/clip if LoRAs are present (custom workflows too).
  if (params.loras && params.loras.length) {
    const { baseModel, baseClip, lastLora } = injectLoras(out, params.loras);
    if (lastLora) rewireLoaders(out, baseModel, baseClip, lastLora);
  }

  return out;
}
