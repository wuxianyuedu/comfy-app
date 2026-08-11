import type { Node } from "@xyflow/react";

/* ── Canvas node model ── */

export type NodeKind = "image" | "video" | "script" | "agent" | "workflow";

/* Which parameters a given model exposes in its node UI.
 * Different models → different param sets.  The node renders only the params
 * listed here, in the order they appear, so swapping models updates the form
 * dynamically. */
export interface ModelParamSchema {
  prompt?: boolean;
  negative?: boolean;
  size?: boolean;       // image resolution OR video resolution
  ratio?: boolean;      // aspect ratio chip
  duration?: boolean;   // video length in seconds
  steps?: boolean;
  cfg?: boolean;
  seed?: boolean;
  frames?: boolean;     // video
  fps?: boolean;        // video
}

export interface ModelPreset {
  id: string;
  name: string;
  badge?: string;       // short tag shown next to name (e.g. "推荐")
  params: ModelParamSchema;
}

export interface ModelRegistry {
  image: ModelPreset[];
  video: ModelPreset[];
  text: ModelPreset[];
  /** True if the kind supports connection ports / chaining. */
  chainable: boolean;
}

/* ── Model registry ── */
export const MODEL_REGISTRY: Record<NodeKind, ModelRegistry> = {
  image: {
    chainable: true,
    image: [
      { id: "seedream45", name: "SeeDream 4.5", badge: "推荐", params: { prompt: true, negative: true, size: true, steps: true, cfg: true, seed: true } },
      { id: "sdxl",       name: "SDXL",         params: { prompt: true, negative: true, size: true, steps: true, cfg: true, seed: true } },
      { id: "flux1",      name: "Flux.1",       params: { prompt: true, negative: true, size: true, steps: true, cfg: true, seed: true } },
      { id: "kandinsky",  name: "Kandinsky 3",  params: { prompt: true, negative: true, size: true, steps: true, seed: true } },
    ],
    video: [],
    text: [],
  },
  video: {
    chainable: false,
    image: [],
    video: [
      { id: "kling30",  name: "Kling 3.0 Omni", badge: "热门", params: { prompt: true, negative: true, ratio: true, duration: true, size: true } },
      { id: "wan22",    name: "Wan 2.2 I2V 14B",           params: { prompt: true, negative: true, ratio: true, frames: true, fps: true, steps: true, cfg: true, seed: true } },
      { id: "hunyuan",  name: "HunyuanVideo",               params: { prompt: true, negative: true, ratio: true, duration: true, steps: true, cfg: true, seed: true } },
      { id: "cogvideo", name: "CogVideoX 5B",               params: { prompt: true, ratio: true, duration: true } },
    ],
    text: [],
  },
  script: {
    chainable: true,
    image: [],
    video: [],
    text: [
      { id: "gpt55",    name: "GPT-5.5", badge: "推荐", params: { prompt: true } },
      { id: "claude45", name: "Claude 4.5",            params: { prompt: true } },
      { id: "deepseek", name: "DeepSeek V3",           params: { prompt: true } },
      { id: "qwen",     name: "Qwen 3",                params: { prompt: true } },
    ],
  },
  agent: {
    chainable: false,
    image: [],
    video: [],
    text: [
      { id: "gpt55", name: "GPT-5.5", params: { prompt: true } },
      { id: "claude45", name: "Claude 4.5", params: { prompt: true } },
    ],
  },
  workflow: {
    chainable: false,
    image: [],
    video: [],
    text: [],
  },
};

/** First (default) model id for a given kind. */
export function defaultModelFor(kind: NodeKind): string {
  const reg = MODEL_REGISTRY[kind];
  const list = reg.image.length ? reg.image : reg.video.length ? reg.video : reg.text;
  return list[0]?.id ?? "";
}

/** Resolve a model preset by id; falls back to the first preset of the kind. */
export function getModelPreset(kind: NodeKind, modelId?: string): ModelPreset | null {
  const reg = MODEL_REGISTRY[kind];
  const list = reg.image.length ? reg.image : reg.video.length ? reg.video : reg.text;
  if (!list.length) return null;
  return list.find((m) => m.id === modelId) ?? list[0];
}

export interface CanvasNodeData {
  kind: NodeKind;
  status: "idle" | "running" | "done" | "error";
  error?: string;
  /** Selected model id (from MODEL_REGISTRY for the given kind). */
  model: string;

  // image / video common
  prompt: string;
  negative: string;
  mode: string; // image: txt2img | img2img ; video: t2v | i2v | flf
  size: string;
  steps: number;
  cfg: number;
  seed: string;
  // video only
  frames: number;
  fps: number;
  // uploaded references (ComfyUI input filenames)
  inputImage?: string;
  firstFrame?: string;
  lastFrame?: string;

  // chaining: id of the upstream node this inputImage was auto-fed from
  upstreamId?: string;

  // result
  taskId?: string;
  resultPath?: string;
  resultMediaType?: string;

  // script node
  theme: string;
  scriptText?: string;

  // agent node
  agentHistory: { role: "user" | "assistant"; content: string }[];
  agentReply?: string;
  agentReady?: boolean;
  agentSpec?: {
    prompt: string;
    negative?: string;
    kind?: "image" | "video";
    params?: { steps?: number; cfg?: number; sampler?: string; scheduler?: string; size?: string };
  };

  // workflow node (user-uploaded ComfyUI workflow)
  workflowId?: string;
  workflowName?: string;
  workflowTaskType?: string;
  /** Dynamic form values keyed by ioKey (`${nodeId}::${kind}::${name}`), driven by the workflow's exposed IO. */
  workflowInputs?: Record<string, unknown>;
  /** Downstream node auto-spawned for this workflow's output (so we only create it once). */
  workflowSinkId?: string;

  // ReactFlow node data must be a plain record
  [key: string]: unknown;
}

export type CanvasNodeType = Node<CanvasNodeData, "canvasNode">;

/* ── Sizes ── */
export const IMAGE_SIZES = ["1024x1024", "832x1216", "1216x832", "768x768", "640x640", "512x512"];
export const VIDEO_SIZES = ["832x480", "480x832", "1024x576", "576x1024", "1280x720"];

/* ── Node palette metadata ── */
export const NODE_META: Record<
  NodeKind,
  {
    label: string;
    icon: string;
    color: string;
    desc: string;
    /** Single-character type indicator shown in the top-left circle of every node (header + result). */
    typeChar: string;
  }
> = {
  image:    { label: "生图",         icon: "image",   color: "#8B5CF6", desc: "文生图 / 图生图",     typeChar: "I" },
  video:    { label: "生视频",       icon: "film",    color: "#22D3EE", desc: "文生视频 / 图生视频 / 首尾帧", typeChar: "V" },
  script:   { label: "生成剧本",     icon: "filetext",color: "#F59E0B", desc: "一句话扩写为分镜剧本", typeChar: "T" },
  agent:    { label: "Agent 模式",   icon: "bot",     color: "#34D399", desc: "多轮对话引导创作",     typeChar: "A" },
  workflow: { label: "自定义工作流", icon: "puzzle",  color: "#A78BFA", desc: "运行你上传的 ComfyUI 工作流", typeChar: "W" },
};

/** Human-readable labels for the status badge shown on the node header + result card. */
export const STATUS_LABEL: Record<CanvasNodeData["status"], string> = {
  idle:    "待开始",
  running: "生成中…",
  done:    "运行后生成",
  error:   "生成失败",
};

export const CANVAS_STORAGE_KEY = "comfyapp.canvas.v1";

/** Build a fresh node-data object for the given kind. */
export function defaultData(kind: NodeKind): CanvasNodeData {
  const base: CanvasNodeData = {
    kind,
    status: "idle",
    model: defaultModelFor(kind),
    prompt: "",
    negative: "",
    mode: kind === "video" ? "t2v" : "txt2img",
    size: kind === "video" ? "832x480" : "1024x1024",
    steps: kind === "video" ? 25 : 25,
    cfg: kind === "video" ? 6 : 7,
    seed: "",
    frames: 49,
    fps: 16,
    theme: "",
    agentHistory: [],
    workflowInputs: {},
  };
  return base;
}
