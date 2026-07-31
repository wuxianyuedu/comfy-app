import type { Node } from "@xyflow/react";

/* ── Canvas node model ── */

export type NodeKind = "image" | "video" | "script" | "agent";

export interface CanvasNodeData {
  kind: NodeKind;
  status: "idle" | "running" | "done" | "error";
  error?: string;

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
  { label: string; icon: string; color: string; desc: string }
> = {
  image: { label: "生图", icon: "🖼️", color: "#8B5CF6", desc: "文生图 / 图生图" },
  video: { label: "生视频", icon: "🎬", color: "#22D3EE", desc: "文生视频 / 图生视频 / 首尾帧" },
  script: { label: "生成剧本", icon: "📝", color: "#F59E0B", desc: "一句话扩写为分镜剧本" },
  agent: { label: "Agent 模式", icon: "🤖", color: "#34D399", desc: "多轮对话引导创作" },
};

export const CANVAS_STORAGE_KEY = "comfyapp.canvas.v1";

/** Build a fresh node-data object for the given kind. */
export function defaultData(kind: NodeKind): CanvasNodeData {
  const base: CanvasNodeData = {
    kind,
    status: "idle",
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
  };
  return base;
}
