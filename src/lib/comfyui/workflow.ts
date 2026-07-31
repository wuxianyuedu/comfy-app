import { listModels } from "./client";
import { getWorkflow } from "./_meta";
import txt2img from "./workflows/txt2img.json";
import img2img from "./workflows/img2img.json";
import inpaint from "./workflows/inpaint.json";
import upscale from "./workflows/upscale.json";
import txt2video from "./workflows/txt2video.json";
import img2video from "./workflows/img2video.json";
import flfvideo from "./workflows/flfvideo.json";
import ltxt2video from "./workflows/ltxt2video.json";

const TEMPLATES: Record<string, unknown> = {
  txt2img,
  img2img,
  inpaint,
  upscale,
  txt2video,
  img2video,
  flfvideo,
  ltxt2video,
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
 * Auto-detect the role nodes of an imported ComfyUI graph:
 *  - first two CLIPTextEncode → positive / negative prompt
 *  - first CheckpointLoaderSimple → model
 *  - first KSampler → sampler
 */
export function detectParamMap(graph: Record<string, any>): ParamMap {
  const map: ParamMap = {};
  const clipNodes = Object.entries(graph).filter(
    ([, n]) => n && n.class_type === "CLIPTextEncode"
  );
  if (clipNodes.length >= 1) map.positiveNode = clipNodes[0][0];
  if (clipNodes.length >= 2) map.negativeNode = clipNodes[1][0];

  const ckpt = Object.entries(graph).find(([, n]) => n?.class_type === "CheckpointLoaderSimple");
  if (ckpt) map.checkpointNode = ckpt[0];

  const ks = Object.entries(graph).find(([, n]) => n?.class_type === "KSampler");
  if (ks) map.samplerNode = ks[0];

  const li = Object.entries(graph).find(([, n]) => n?.class_type === "LoadImage");
  if (li) map.inputImageNode = li[0];

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

function injectLoras(
  graph: Record<string, any>,
  loras: LoraSpec[]
): { modelNode: string; clipNode: string } {
  // Base model/clip come from CheckpointLoaderSimple (find it dynamically).
  let modelNode = "";
  let clipNode = "";
  for (const [id, node] of Object.entries(graph)) {
    if (node.class_type === "CheckpointLoaderSimple") {
      modelNode = id;
      clipNode = id;
    }
  }
  loras.forEach((lora, i) => {
    const id = `lora_${i}`;
    graph[id] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.name,
        strength_model: lora.weight,
        strength_clip: lora.weight,
        model: [modelNode, 0],
        clip: [clipNode, 1],
      },
    };
    modelNode = id;
    clipNode = id;
  });
  return { modelNode, clipNode };
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

  const [w, h] = (params.size ?? "1024x1024").split("x").map((n) => parseInt(n, 10));
  const def = meta.defaultParams ?? {};
  const values: Record<string, string> = {
    __CKPT__: params.checkpoint ?? "",
    __PROMPT__: params.prompt ?? "",
    __NEG__: params.negative ?? "",
    __W__: String(w || 1024),
    __H__: String(h || 1024),
    __COUNT__: String(params.count ?? 1),
    __SEED__: String(params.seed ?? Math.floor(Math.random() * 0xffffffffffffffff)),
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
    __LTX_MODEL__: params.ltxModel ?? (def.ltxModel as string) ?? "LTX-2 (Fast)",
    __DURATION__: String(params.duration ?? (def.duration as number) ?? 8),
    __RESOLUTION__: params.resolution ?? (def.resolution as string) ?? "1920x1080",
  };

  const graph = replaceTokens(template, values) as Record<string, any>;

  // LTX-2.3 uses COMBO number fields (duration / fps) — token substitution
  // yields strings, so coerce them back to numbers; also set strings directly
  // to avoid relying solely on the token pass.
  if (templateName === "ltxt2video") {
    const node = graph["1"];
    if (node?.inputs) {
      node.inputs.model = values.__LTX_MODEL__;
      node.inputs.prompt = values.__PROMPT__;
      node.inputs.duration = Number(values.__DURATION__);
      node.inputs.resolution = values.__RESOLUTION__;
      node.inputs.fps = Number(values.__FPS__);
    }
  }

  // Re-wire model/clip if LoRAs are present.
  if (params.loras && params.loras.length) {
    const { modelNode, clipNode } = injectLoras(graph, params.loras);
    for (const [id, node] of Object.entries(graph)) {
      if (node.class_type === "KSampler") node.inputs.model = [modelNode, 0];
      if (node.class_type === "CLIPTextEncode") node.inputs.clip = [clipNode, 1];
    }
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
      __SEED__: String(params.seed ?? Math.floor(Math.random() * 0xffffffffffffffff)),
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
    return replaceTokens(out, values) as Record<string, any>;
  }

  // Use the user-supplied role mapping, else fall back to auto-detection.
  const map: ParamMap =
    paramMap && Object.keys(paramMap).length ? paramMap : detectParamMap(out);

  if (map.positiveNode && out[map.positiveNode]) {
    out[map.positiveNode].inputs.text = params.prompt ?? "";
  }
  if (map.negativeNode && out[map.negativeNode]) {
    out[map.negativeNode].inputs.text = params.negative ?? "";
  }

  if (params.checkpoint && map.checkpointNode && out[map.checkpointNode]?.inputs) {
    out[map.checkpointNode].inputs.ckpt_name = params.checkpoint;
  }

  const seedNum = params.seed;
  if (map.samplerNode && out[map.samplerNode]) {
    const n = out[map.samplerNode];
    if (typeof params.steps === "number") n.inputs.steps = params.steps;
    if (typeof params.cfg === "number") n.inputs.cfg = params.cfg;
    if (typeof seedNum === "number" && seedNum > 0) n.inputs.seed = seedNum;
    if (params.sampler) n.inputs.sampler_name = params.sampler;
    if (params.scheduler) n.inputs.scheduler = params.scheduler;
  }

  // Feed an upstream-generated (or manually uploaded) image into the
  // workflow's LoadImage node so chains like 图生图 work out of the box.
  if (params.inputImage && map.inputImageNode && out[map.inputImageNode]?.inputs) {
    out[map.inputImageNode].inputs.image = params.inputImage;
  }

  // Re-wire model/clip if LoRAs are present (custom workflows too).
  if (params.loras && params.loras.length) {
    const { modelNode, clipNode } = injectLoras(out, params.loras);
    for (const [id, node] of Object.entries(out)) {
      if (!node || !node.class_type) continue;
      if (node.class_type === "KSampler") node.inputs.model = [modelNode, 0];
      if (node.class_type === "CLIPTextEncode") node.inputs.clip = [clipNode, 1];
    }
  }

  return out;
}
