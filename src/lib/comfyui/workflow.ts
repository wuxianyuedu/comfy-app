import { linkTargetId } from "./workflow-preview";
import type { RawWorkflowOverride } from "./runner-state";

export type LoraSpec = { name: string; weight: number };

/** `buildCustomWorkflow` 能消费的参数。
 *
 *  **只有 `GenerateInput`（`generate.generate` 的入参）里也有的字段会被真正填充**
 *  —— 内置模板（token 替换）移除后，`checkpoint` / `sampler` / `scheduler` /
 *  `steps` / `cfg` / `seed` / `size` / `count` / `denoise` / `mask` / `upscaleModel`
 *  / `prefix` / `wanModel` / `wanVae` / `t5Model` / `ltxModel` / `duration` /
 *  `resolution` / `fps` / `loras` 已无任何生产写入方，它们的自动注入分支只在
 *  「有人绕过路由直接调用本函数」时才有意义。
 *
 *  保留这些字段与自动注入是为了两件事：① 画布 / 导入图的**提示词**注入
 *  （`prompt` / `negative` / `inputImage`，这条是真的在用）；② 未来若把某个
 *  扁平字段重新接回路由，注入逻辑不必重写。**新增字段前先确认路由入参里有它**，
 *  否则就是那个反复出现的「传了不生效且无任何报错」的静默失配。
 */
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
  inputImage?: string; // filename already in ComfyUI input dir
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
 * text-encode node (CLIPTextEncode / SDXL / Flux / …). Falls back to the
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

/**
 * Build a graph from a user-imported ComfyUI workflow (API format).
 *
 * 按节点检测自动注入：prompt/negative 进第一对 CLIPTextEncode，steps/cfg/seed/
 * sampler/scheduler/checkpoint 进对应节点（存在时）。这样一张原样的
 * "Export (API Format)" 图不必手工改就能换提示词复用。
 *
 * 这条通路**不做** `__PROMPT__` / `__SEED__` 这类 token 替换 —— 那套占位符
 * 是与内置模板一起移除的「模板作者约定」，导入的工作流按 `paramMap` /
 * 节点检测下发，或由工坊的对外封装逐端口派值。
 */
export function buildCustomWorkflow(
  graph: Record<string, unknown>,
  params: GenerateParams,
  paramMap?: ParamMap | null,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(graph)) as Record<string, unknown>;

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
