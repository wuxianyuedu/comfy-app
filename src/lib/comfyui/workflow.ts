import { listModels } from "./client";
import { getWorkflow } from "./_meta";
import { linkTargetId } from "./workflow-preview";
import type { RawWorkflowOverride } from "./runner-state";
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
  // Custom workflow: user-curated exposed pins from the IO-edit mode.
  // Same shape as the runner's RawWorkflowOverride — the generate router feeds
  // the same array to buildCustomWorkflow and to enqueue().overrides.
  workflowInputs?: RawWorkflowOverride[];
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
 * Client-safe workflow preview helpers are split into `workflow-preview.ts`
 * so they can be imported by browser components without pulling in server-only
 * modules such as `fs` / ComfyUI client.
 */
export {
  buildWorkflowPreview,
  buildWorkflowPreviewFull,
  FULL_PREVIEW_LEVEL_GAP,
  FULL_PREVIEW_MARGIN,
  FULL_PREVIEW_NODE_H,
  FULL_PREVIEW_NODE_W,
  FULL_PREVIEW_ROW_GAP,
  type WorkflowPreview,
  type WorkflowPreviewEdge,
  type WorkflowPreviewNode,
  type WorkflowPreviewNodeKind,
} from "./workflow-preview";

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
/**
 * Loose structural view of a possibly-incomplete graph node. Imported graphs
 * are user JSON — fields may be missing or hold unexpected types — so the
 * walkers below interpret every field defensively instead of trusting shapes.
 */
type GraphNodeLike = {
  class_type?: unknown;
  inputs: Record<string, unknown>;
};

/** Object check returning a structural view of `value` (same reference — no
 *  copy — so mutations through it write back into the graph). */
function asGraphNode(value: unknown): GraphNodeLike | null {
  return typeof value === "object" && value !== null
    ? (value as GraphNodeLike)
    : null;
}

function findTextEncoder(
  graph: Record<string, unknown>,
  startId: string | undefined,
  visited = new Set<string>(),
): string | null {
  if (!startId || visited.has(startId)) return null;
  visited.add(startId);
  const node = asGraphNode(graph[startId]);
  if (!node?.inputs) return null;
  const TEXT_FIELDS = [
    "text",
    "text_g",
    "text_l",
    "prompt",
    "positive",
    "negative",
    "text_positive",
    "text_negative",
  ];
  for (const f of TEXT_FIELDS) {
    const value = node.inputs[f];

    if (typeof value === "string" && !Array.isArray(value)) return startId;
  }

  for (const v of Object.values(node.inputs)) {
    const target = linkTargetId(v);
    if (target && graph[target]) {
      const result = findTextEncoder(graph, target, visited);

      if (result) return result;
    }
  }
  return null;
}

function isSamplerLike(node: GraphNodeLike): boolean {
  return (
    !!node.inputs &&
    Array.isArray(node.inputs.positive) &&
    Array.isArray(node.inputs.negative)
  );
}

/**
 * Auto-detect the role nodes of an imported ComfyUI graph.
 *
 * Positive/negative are no longer guessed by node id order — they follow the
 * KSampler's `positive`/`negative` conditioning links upstream to the actual
 * text-encode node (CLIPTextEncode / SDXL / Flux / T5 …). Falls back to the
 * first two CLIPTextEncode when no sampler is present.
 */
export function detectParamMap(graph: Record<string, unknown>): ParamMap {
  const map: ParamMap = {};
  const ids = Object.keys(graph);
  const nodes = ids.map((id) => ({ id, node: asGraphNode(graph[id]) }));

  const sampler = nodes.find((node) => {
    const n = node.node;
    if (!n) return false;
    return (
      n.class_type === "KSampler" ||
      n.class_type === "KSamplerAdvanced" ||
      isSamplerLike(n)
    );
  });
  if (sampler?.node) {
    const inputs = sampler.node.inputs;
    const posEnc = findTextEncoder(graph, linkTargetId(inputs.positive));
    const negEnc = findTextEncoder(graph, linkTargetId(inputs.negative));
    if (posEnc) map.positiveNode = posEnc;
    if (negEnc) map.negativeNode = negEnc;
  }
  // Fallback: first two CLIPTextEncode by id (preserves old behavior if no sampler).
  if (!map.positiveNode || !map.negativeNode) {
    const clips = nodes.filter(
      (node) => node.node?.class_type === "CLIPTextEncode",
    );
    if (!map.positiveNode && clips[0]) map.positiveNode = clips[0].id;
    if (!map.negativeNode && clips[1]) map.negativeNode = clips[1].id;
  }

  const ckpt = nodes.find(
    (node) => node.node?.class_type === "CheckpointLoaderSimple",
  );
  if (ckpt) map.checkpointNode = ckpt.id;

  const ks = nodes.find(
    (node) =>
      node.node?.class_type === "KSampler" ||
      node.node?.class_type === "KSamplerAdvanced",
  );
  if (ks) map.samplerNode = ks.id;

  const li = nodes.find((node) => node.node?.class_type === "LoadImage");
  if (li) map.inputImageNode = li.id;

  return map;
}

function replaceTokens(obj: unknown, values: Record<string, string>): unknown {
  if (typeof obj === "string") {
    let str = obj;

    for (const [k, v] of Object.entries(values)) {
      str = str.split(k).join(v);
    }

    return str;
  }

  if (Array.isArray(obj)) return obj.map((obj) => replaceTokens(obj, values));
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
  const truncated = Math.trunc(seed);

  if (!Number.isFinite(truncated)) return randomSeed();

  return Math.max(0, Math.min(0xffffffff, truncated));
}

/**
 * Token substitution turns every `__TOKEN__` value into a string, and
 * `replaceTokens` substitutes them verbatim. ComfyUI's INT/FLOAT input
 * validation rejects string values, so coerce the known numeric input names
 * back to numbers after the token pass. Guarded by an allow-list of numeric
 * field names so genuinely-string fields (ckpt_name, text, prefix) stay strings.
 */
const NUMERIC_INPUT_NAMES = new Set([
  "seed",
  "noise_seed",
  "variation_seed",
  "variation_seed_strength",
  "steps",
  "cfg",
  "denoise",
  "shift",
  "guidance",
  "guidance_scale",
  "width",
  "height",
  "batch_size",
  "count",
  "frames",
  "fps",
  "num_frames",
  "loop_count",
  "frame_rate",
  "riflex_freq_index",
  "base_shift",
  "max_shift",
  "samples",
  "num_inference_steps",
  "strength",
  "noise",
  "clip_sample",
]);

function coerceNumericFields(graph: Record<string, unknown>): void {
  for (const nodeValue of Object.values(graph)) {
    const node = asGraphNode(nodeValue);
    if (!node?.inputs) continue;
    for (const key of Object.keys(node.inputs)) {
      if (!NUMERIC_INPUT_NAMES.has(key)) continue;

      const value = node.inputs[key];

      if (
        typeof value === "string" &&
        value.trim() !== "" &&
        !Number.isNaN(Number(value))
      ) {
        node.inputs[key] = Number(value);
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
const CLIP_LOADER = new Set([
  "DualCLIPLoader",
  "TripleCLIPLoader",
  "CLIPLoader",
  "CLIPLoaderGGUF",
]);

/**
 * Inject a chain of LoraLoader nodes. Supports Flux / SD3 / WAN workflows whose
 * base model+clip come from UNETLoader + DualCLIPLoader (or Triple/CLIPLoader)
 * instead of a single CheckpointLoaderSimple. Returns the base loader outputs
 * and the id of the last LoraLoader so callers can re-point only the nodes that
 * originally consumed the base model/clip (preserving refiner / dual-CLIP chains).
 */
function injectLoras(
  graph: Record<string, unknown>,
  loras: LoraSpec[],
): {
  baseModel: [string, number] | null;
  baseClip: [string, number] | null;
  lastLora: string | null;
} {
  let baseModel: [string, number] | null = null;
  let baseClip: [string, number] | null = null;
  for (const [id, value] of Object.entries(graph)) {
    const classType = asGraphNode(value)?.class_type;
    if (typeof classType !== "string") continue;
    if (CHECKPOINT_LOADER.has(classType)) {
      // CheckpointLoaderSimple: outputs [MODEL0, CLIP1, VAE2].
      baseModel ??= [id, 0];
      baseClip ??= [id, 1];
    } else if (UNET_LOADER.has(classType) && !baseModel) {
      baseModel = [id, 0];
    } else if (CLIP_LOADER.has(classType) && !baseClip) {
      baseClip = [id, 0];
    }
  }
  if (!baseModel) return { baseModel: null, baseClip: null, lastLora: null };

  let prevModel: [string, number] = baseModel;
  let prevClip: [string, number] | null = baseClip;
  const loraIds: string[] = [];
  loras.forEach((lora, i) => {
    const id = `lora_${i}`;
    const inputs: Record<string, unknown> = {
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
  return {
    baseModel,
    baseClip,
    lastLora: loraIds.length ? loraIds[loraIds.length - 1]! : null,
  };
}

/** Re-point only the loader outputs that originally fed the base model/clip.
 *  Skips the injected LoraLoader nodes themselves (their model/clip inputs
 *  legitimately reference the previous link in the chain). */
function rewireLoaders(
  graph: Record<string, unknown>,
  baseModel: [string, number] | null,
  baseClip: [string, number] | null,
  lastLora: string,
) {
  for (const value of Object.values(graph)) {
    const node = asGraphNode(value);
    if (!node?.inputs) continue;
    const inputs = node.inputs;
    if (
      node.class_type === "LoraLoader" ||
      node.class_type === "LoraLoaderModelOnly"
    )
      continue;
    if (
      baseModel &&
      Array.isArray(inputs.model) &&
      inputs.model[0] === baseModel[0] &&
      inputs.model[1] === baseModel[1]
    ) {
      inputs.model = [lastLora, 0];
    }
    if (
      baseClip &&
      Array.isArray(inputs.clip) &&
      inputs.clip[0] === baseClip[0] &&
      inputs.clip[1] === baseClip[1]
    ) {
      inputs.clip = [lastLora, 1];
    }
  }
}

/** Set the prompt string on a CLIPTextEncode-style node (handles SDXL text_g/text_l). */
function setPromptText(node: GraphNodeLike | null, prompt: string) {
  if (!node?.inputs) return;
  const inputs = node.inputs;
  if (inputs.text_g !== undefined) {
    // SDXL / SDXL-simplified: both text_g and text_l carry the prompt.
    inputs.text_g = prompt;
    if (inputs.text_l !== undefined) inputs.text_l = prompt;
  } else if (!Array.isArray(inputs.text)) {
    // Plain CLIPTextEncode: `text` is the prompt (unless it's a link).
    inputs.text = prompt;
  }
}

export async function buildAndValidate(
  templateName: string,
  params: GenerateParams,
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
    if (
      available.length &&
      usesCheckpoint &&
      params.checkpoint &&
      !available.includes(params.checkpoint)
    ) {
      return {
        ok: false,
        error: `模型不可用或文件名不匹配: ${params.checkpoint}`,
      };
    }
  } catch {
    // ComfyUI unreachable — let submission surface the error later.
  }

  const def = meta.defaultParams ?? {};
  const [w, h] = (params.size ?? (def.size as string) ?? "1024x1024")
    .split("x")
    .map((num) => parseInt(num, 10));
  const values: Record<string, string> = {
    __CKPT__: params.checkpoint ?? "",
    __PROMPT__: params.prompt ?? "",
    __NEG__: params.negative ?? "",
    __W__: String(w ?? 1024),
    __H__: String(h ?? 1024),
    __COUNT__: String(params.count ?? 1),
    __SEED__: String(params.seed ?? randomSeed()),
    __STEPS__: String(params.steps ?? 25),
    __CFG__: String(params.cfg ?? 7),
    __SAMPLER__: params.sampler ?? "euler",
    __SCHEDULER__: params.scheduler ?? "normal",
    __DENOISE__: String(
      params.denoise ?? (templateName === "img2img" ? 0.65 : 1),
    ),
    __INPUT__: params.inputImage ?? "",
    __PREFIX__: params.prefix ?? "ComfyAPP",
    __UPSCALE_MODEL__:
      params.upscaleModel ??
      (def.upscaleModel as string) ??
      "4x-UltraSharp.pth",
    __WAN_MODEL__: params.wanModel ?? (def.wanModel as string) ?? "",
    __WAN_VAE__: params.wanVae ?? (def.wanVae as string) ?? "",
    __T5_MODEL__: params.t5Model ?? (def.t5Model as string) ?? "",
    __FRAMES__: String(params.frames ?? (def.frames as number) ?? 81),
    __FPS__: String(params.fps ?? (def.fps as number) ?? 16),
    __FIRST_FRAME__: params.firstFrame ?? "",
    __LAST_FRAME__: params.lastFrame ?? "",
  };

  const graph = replaceTokens(template, values) as Record<string, unknown>;

  // ComfyUI rejects string values for numeric inputs, but token substitution
  // produces strings. Coerce the known numeric fields back to numbers after the
  // token pass (handles WAN video nodes, sampler steps/cfg, seed, width, etc.).
  coerceNumericFields(graph);

  // Re-wire model/clip if LoRAs are present.
  if (params.loras?.length) {
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
  graph: Record<string, unknown>,
  params: GenerateParams,
  paramMap?: ParamMap | null,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(graph)) as Record<string, unknown>;

  const serialized = JSON.stringify(out);
  const hasTokens =
    serialized.includes("__PROMPT__") ||
    serialized.includes("__NEG__") ||
    serialized.includes("__SEED__");

  if (hasTokens) {
    const [w, h] = (params.size ?? "1024x1024")
      .split("x")
      .map((num) => parseInt(num, 10));
    const values: Record<string, string> = {
      __PROMPT__: params.prompt ?? "",
      __NEG__: params.negative ?? "",
      __SEED__: String(params.seed ?? randomSeed()),

      __STEPS__: String(params.steps ?? 25),
      __CFG__: String(params.cfg ?? 7),
      __W__: String(w ?? 1024),
      __H__: String(h ?? 1024),
      __COUNT__: String(params.count ?? 1),
      __CKPT__: params.checkpoint ?? "",
      __SAMPLER__: params.sampler ?? "euler",
      __SCHEDULER__: params.scheduler ?? "normal",
      __DENOISE__: String(params.denoise ?? 0.65),
      __FIRST_FRAME__: params.firstFrame ?? "",
      __LAST_FRAME__: params.lastFrame ?? "",
      __INPUT__: params.inputImage ?? "",
    };
    const tok = replaceTokens(out, values) as Record<string, unknown>;
    coerceNumericFields(tok);
    return tok;
  }

  // Use the user-supplied role mapping, else fall back to auto-detection.
  const map: ParamMap =
    paramMap && Object.keys(paramMap).length ? paramMap : detectParamMap(out);

  // Prompt/negative are only overridden when explicitly supplied — otherwise a
  // workflow with a baked-in prompt must keep it (the old code wiped it to "").
  if (
    map.positiveNode &&
    out[map.positiveNode] &&
    params.prompt !== undefined
  ) {
    setPromptText(asGraphNode(out[map.positiveNode]), params.prompt);
  }
  if (
    map.negativeNode &&
    out[map.negativeNode] &&
    params.negative !== undefined
  ) {
    setPromptText(asGraphNode(out[map.negativeNode]), params.negative);
  }

  if (params.checkpoint && map.checkpointNode) {
    const ck = asGraphNode(out[map.checkpointNode]);
    const inputs = ck?.inputs;
    if (inputs?.ckpt_name !== undefined)
      inputs.ckpt_name = params.checkpoint;
  }

  const seedNum = params.seed;
  if (map.samplerNode) {
    const samplerNode = asGraphNode(out[map.samplerNode]);

    if (samplerNode?.inputs) {
      const inputs = samplerNode.inputs;

      if (typeof params.steps === "number")
        inputs.steps = params.steps;

      if (typeof params.cfg === "number") inputs.cfg = params.cfg;

      // KSampler uses `seed`, KSamplerAdvanced uses `noise_seed`.

      // Note: seed=0 is a valid, intentional value — the old `> 0` guard dropped it.

      const seedKey =
        samplerNode.class_type === "KSamplerAdvanced" ? "noise_seed" : "seed";

      if (typeof seedNum === "number" && !Number.isNaN(seedNum)) {
        inputs[seedKey] = clampSeed(seedNum);
      }

      if (params.sampler) inputs.sampler_name = params.sampler;

      if (params.scheduler) inputs.scheduler = params.scheduler;
    }
  }

  // Feed an upstream-generated (or manually uploaded) image into the
  // workflow's LoadImage node so chains like 图生图 work out of the box.
  if (params.inputImage && map.inputImageNode) {
    const inputNode = asGraphNode(out[map.inputImageNode]);
    if (inputNode?.inputs) inputNode.inputs.image = params.inputImage;
  }

  // Apply user-curated exposed-pin values (the dynamic form). These win over
  // the auto-injection above, so an explicitly set pin always takes effect.
  // Numeric coercion: ComfyUI rejects string values for numeric inputs, so when
  // the existing pin already holds a number we coerce a numeric-looking string.
  if (params.workflowInputs && Array.isArray(params.workflowInputs)) {
    for (const it of params.workflowInputs) {
      const node = asGraphNode(out[it.nodeId]);

      if (!node?.inputs) continue;

      const value = it.value;

      if (value === undefined) continue;

      const cur = node.inputs[it.name];

      let assigned: unknown = value;

      if (
        typeof cur === "number" &&
        typeof value === "string" &&
        value.trim() !== "" &&
        !Number.isNaN(Number(value))
      ) {
        assigned = Number(value);
      }

      node.inputs[it.name] = assigned;
    }
  }

  // Re-wire model/clip if LoRAs are present (custom workflows too).
  if (params.loras?.length) {
    const { baseModel, baseClip, lastLora } = injectLoras(out, params.loras);
    if (lastLora) rewireLoaders(out, baseModel, baseClip, lastLora);
  }

  return out;
}
