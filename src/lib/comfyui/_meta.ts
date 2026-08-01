// Registry of available generation workflows (ComfyUI API-format templates).
// The "contract" between frontend params and the ComfyUI graph.

export type WorkflowMeta = {
  name: string;
  label: string;
  taskType: string; // TXT2IMG | IMG2IMG | INPAINT | HIRERES | VIDEO
  supports: string[];
  defaultParams: Record<string, unknown>;
  experimental?: boolean;
};

export const WORKFLOWS: Record<string, WorkflowMeta> = {
  txt2img: {
    name: "txt2img",
    label: "文生图",
    taskType: "TXT2IMG",
    supports: [
      "prompt",
      "negative",
      "checkpoint",
      "lora",
      "sampler",
      "size",
      "count",
      "seed",
      "cfg",
      "steps",
    ],
    defaultParams: {
      steps: 25,
      cfg: 7,
      sampler: "euler",
      scheduler: "normal",
      size: "1024x1024",
      count: 1,
      denoise: 1,
    },
  },
  img2img: {
    name: "img2img",
    label: "图生图",
    taskType: "IMG2IMG",
    supports: [
      "prompt",
      "negative",
      "checkpoint",
      "lora",
      "sampler",
      "size",
      "seed",
      "cfg",
      "steps",
      "denoise",
      "inputImage",
    ],
    defaultParams: {
      steps: 25,
      cfg: 7,
      sampler: "euler",
      scheduler: "normal",
      denoise: 0.65,
    },
  },
  inpaint: {
    name: "inpaint",
    label: "局部重绘",
    taskType: "INPAINT",
    supports: [
      "prompt",
      "negative",
      "checkpoint",
      "sampler",
      "seed",
      "cfg",
      "steps",
      "denoise",
      "inputImage",
    ],
    defaultParams: {
      steps: 25,
      cfg: 7,
      sampler: "euler",
      scheduler: "normal",
      denoise: 0.85,
    },
  },
  upscale: {
    name: "upscale",
    label: "高清修复",
    taskType: "HIRERES",
    supports: ["inputImage", "upscaleModel"],
    defaultParams: {
      upscaleModel: "4x-UltraSharp.pth",
    },
  },
  txt2video: {
    name: "txt2video",
    label: "文生视频",
    taskType: "VIDEO",
    supports: [
      "prompt",
      "negative",
      "checkpoint",
      "sampler",
      "seed",
      "cfg",
      "steps",
      "frames",
      "fps",
    ],
    defaultParams: {
      steps: 25,
      cfg: 6,
      sampler: "euler",
      scheduler: "normal",
      size: "832x480",
      frames: 81,
      fps: 16,
      shift: 8,
      wanModel: "DaSiWa WAN 2.2 I2V 14B SnatchKiss v11.0 HIGH FP8 - Wan2.2.safetensors",
      wanVae: "wan_2.1_vae.safetensors",
      t5Model: "umt5-xxl-enc-bf16.safetensors",
    },
    experimental: true,
  },
  img2video: {
    name: "img2video",
    label: "图生视频",
    taskType: "VIDEO",
    supports: [
      "prompt",
      "negative",
      "checkpoint",
      "sampler",
      "seed",
      "cfg",
      "steps",
      "frames",
      "fps",
      "inputImage",
    ],
    defaultParams: {
      steps: 25,
      cfg: 6,
      sampler: "euler",
      scheduler: "normal",
      size: "832x480",
      frames: 81,
      fps: 16,
      shift: 8,
      wanModel: "DaSiWa WAN 2.2 I2V 14B SnatchKiss v11.0 HIGH FP8 - Wan2.2.safetensors",
      wanVae: "wan_2.1_vae.safetensors",
      t5Model: "umt5-xxl-enc-bf16.safetensors",
    },
    experimental: true,
  },
  flfvideo: {
    name: "flfvideo",
    label: "首尾帧视频",
    taskType: "VIDEO",
    supports: [
      "prompt",
      "negative",
      "checkpoint",
      "sampler",
      "seed",
      "cfg",
      "steps",
      "frames",
      "fps",
      "firstFrame",
      "lastFrame",
    ],
    defaultParams: {
      steps: 25,
      cfg: 6,
      sampler: "euler",
      scheduler: "normal",
      size: "832x480",
      frames: 81,
      fps: 16,
      shift: 8,
      wanModel: "DaSiWa WAN 2.2 I2V 14B SnatchKiss v11.0 HIGH FP8 - Wan2.2.safetensors",
      wanVae: "wan_2.1_vae.safetensors",
      t5Model: "umt5-xxl-enc-bf16.safetensors",
    },
    experimental: true,
  },
};

export function getWorkflow(name: string): WorkflowMeta | undefined {
  return WORKFLOWS[name];
}
