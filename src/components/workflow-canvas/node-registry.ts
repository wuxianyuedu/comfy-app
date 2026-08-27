/**
 * Node Type Registry
 *
 * Maps every ComfyUI class_type we support to its visual config,
 * default fields, and category. Used by both graph→ReactFlow conversion
 * and the parameter editor panel.
 */

import type { NodeTypeConfig, FieldDef } from "./types";
import { CUSTOM_NODE_TYPES } from "@/config/custom-nodes";

/* ── Shared field definitions (reused across node types) ── */
const F = {
  text: (key: string, label: string, opts?: Partial<FieldDef>): FieldDef => ({
    key, label, type: "text", multiline: true, group: "提示词", ...opts,
  }),
  str: (key: string, label: string, opts?: Partial<FieldDef>): FieldDef => ({
    key, label, type: "string", group: "参数", ...opts,
  }),
  num: (key: string, label: string, opts?: Partial<FieldDef>): FieldDef => ({
    key, label, type: "number", group: "采样", ...opts,
  }),
  sel: (key: string, label: string, options: string[], opts?: Partial<FieldDef>): FieldDef => ({
    key, label, type: "select", options, group: "采样", ...opts,
  }),
  img: (key: string, label: string): FieldDef => ({
    key, label, type: "image", group: "输入",
  }),
  toggle: (key: string, label: string): FieldDef => ({
    key, label, type: "toggle", group: "选项",
  }),
};

// Mirrors ComfyUI's built-in KSampler sampler/scheduler names (comfy/samplers.py).
const SAMPLERS = [
  "euler", "euler_ancestral", "heun", "heunpp2",
  "dpm_2", "dpm_2_ancestral", "dpmpp_2s_ancestral",
  "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu",
  "dpmpp_3m_sde", "dpmpp_3m_sde_gpu",
  "ddim", "ddim_variance", "uni_pc", "uni_pc_bh2",
  "plms", "ipndm", "ipndm_v", "deis", "gradalign",
  "res_multistep", "res_multistep_sde", "res_multistep_sde_gpu",
  "lcm",
];

const SCHEDULERS = [
  "normal", "karras", "exponential", "sgm_uniform",
  "simple", "ddim_uniform", "beta",
  "linear_quadratic", "kl_optimal",
];

/** Registry: class_type → NodeTypeConfig */
export const NODE_TYPE_REGISTRY: Record<string, NodeTypeConfig> = {
  /* ── Model ── */
  CheckpointLoaderSimple: {
    label: "加载模型",
    color: "#F59E0B",       // amber
    icon: "\u{1F4BE}",
    category: "model",
    width: 220,
    height: 80,
    defaultFields: [
      F.sel("ckpt_name", "模型文件", [], {
        group: "模型",
        placeholder: "选择 checkpoint...",
        modelFolder: "checkpoints",
      }),
    ],
  },
  LoraLoader: {
    label: "加载 LoRA",
    color: "#EC4899",       // pink
    icon: "\u{1F3A8}",
    category: "model",
    width: 240,
    height: 100,
    defaultFields: [
      F.sel("lora_name", "LoRA 文件", [], {
        group: "模型",
        placeholder: "选择 LoRA...",
        modelFolder: "loras",
      }),
      F.num("strength_model", "模型强度", { min: 0, max: 2, step: 0.01, placeholder: "0.0 ~ 1.0" }),
      F.num("strength_clip", "CLIP 强度", { min: 0, max: 2, step: 0.01, placeholder: "0.0 ~ 1.0" }),
    ],
  },

  /* ── Conditioning / Text ── */
  CLIPTextEncode: {
    label: "编码提示词",
    color: "#8B5CF6",       // purple
    icon: "\u{270D}\uFE0F",
    category: "conditioning",
    width: 280,
    height: 120,
    defaultFields: [
      F.text("text", "提示词", { placeholder: "输入提示词..." }),
    ],
  },
  CLIPTextEncodeSDXL: {
    label: "编码提示词 SDXL",
    color: "#8B5CF6",
    icon: "\u{270D}\uFE0F",
    category: "conditioning",
    width: 280,
    height: 160,
    defaultFields: [
      F.text("text", "主提示词 (G)", { placeholder: "主提示词..." }),
      F.text("text2", "副提示词 (L)", { placeholder: "风格/质量修饰..." }),
    ],
  },

  /* ── Sampling ── */
  KSampler: {
    label: "采样去噪",
    color: "#06B6D4",       // cyan
    icon: "\u{26A1}",
    category: "process",
    width: 260,
    height: 200,
    defaultFields: [
      F.num("steps", "步数", { min: 1, max: 150, step: 1, placeholder: "20" }),
      F.sel("sampler_name", "采样器", SAMPLERS),
      F.sel("scheduler", "调度器", SCHEDULERS),
      F.num("cfg", "CFG", { min: 0, max: 30, step: 0.5, placeholder: "7.0" }),
      F.num("seed", "种子", { min: 0, max: 4294967295, step: 1, placeholder: "-1 = 随机" }),
      F.num("denoise", "去噪强度", { min: 0, max: 1, step: 0.01, placeholder: "1.0" }),
    ],
  },
  KSamplerAdvanced: {
    label: "高级采样",
    color: "#06B6D4",
    icon: "\u{26A1}",
    category: "process",
    width: 260,
    height: 220,
    defaultFields: [
      F.num("steps", "步数", { min: 1, max: 150, step: 1, placeholder: "20" }),
      F.sel("sampler_name", "采样器", SAMPLERS),
      F.sel("scheduler", "调度器", SCHEDULERS),
      F.num("cfg", "CFG", { min: 0, max: 30, step: 0.5, placeholder: "7.0" }),
      F.num("seed", "种子", { min: 0, max: 4294967295, step: 1, placeholder: "-1 = 随机" }),
      F.num("denoise", "去噪强度", { min: 0, max: 1, step: 0.01, placeholder: "1.0" }),
      F.num("start_at_step", "起始步", { min: 0, max: 150, step: 1 }),
      F.num("end_at_step", "结束步", { min: 0, max: 150, step: 1 }),
      F.toggle("return_with_leftover_noise", "保留噪声"),
    ],
  },

  /* ── Latent ── */
  EmptyLatentImage: {
    label: "初始化潜空间",
    color: "#10B981",       // emerald
    icon: "\u{1F5BC}\uFE0F",
    category: "latent",
    width: 200,
    height: 90,
    defaultFields: [
      F.num("width", "宽度", { min: 64, max: 4096, step: 8, group: "潜空间", placeholder: "1024" }),
      F.num("height", "高度", { min: 64, max: 4096, step: 8, group: "潜空间", placeholder: "1024" }),
      F.num("batch_size", "批次", { min: 1, max: 64, step: 1, group: "潜空间", placeholder: "1" }),
    ],
  },
  VAEDecode: {
    label: "VAE 解码",
    color: "#10B981",
    icon: "\u{1F504}",
    category: "latent",
    width: 180,
    height: 60,
    defaultFields: [],
  },
  VAEEncode: {
    label: "VAE 编码",
    color: "#10B981",
    icon: "\u{1F504}",
    category: "latent",
    width: 180,
    height: 60,
    defaultFields: [],
  },

  /* ── Image I/O ── */
  SaveImage: {
    label: "保存图像",
    color: "#EF4444",       // red
    icon: "\u{1F5BB}\uFE0F",
    category: "output",
    width: 180,
    height: 60,
    defaultFields: [
      F.str("filename_prefix", "文件名前缀", { placeholder: "ComfyAPP" }),
    ],
  },
  LoadImage: {
    label: "加载图像",
    color: "#3B82F6",       // blue
    icon: "\u{1F5BC}\uFE0F",
    category: "input",
    width: 200,
    height: 90,
    defaultFields: [
      F.img("image", "图像"),
    ],
  },
  ImageScale: {
    label: "缩放图像",
    color: "#3B82F6",
    icon: "\u{1F50D}",
    category: "image",
    width: 200,
    height: 90,
    defaultFields: [
      F.str("upscale_method", "方法"),
      F.num("width", "宽度"),
      F.num("height", "高度"),
      F.toggle("crop", "裁剪"),
    ],
  },

  /* ── ControlNet / etc (common extensions) ── */
  ControlNetApply: {
    label: "ControlNet 应用",
    color: "#14B8A6",       // teal
    icon: "\u{1F3AF}",
    category: "process",
    width: 220,
    height: 100,
    defaultFields: [
      F.num("strength", "强度", { placeholder: "1.0" }),
      F.num("start_percent", "起始比例"),
      F.num("end_percent", "结束比例"),
    ],
  },
  ControlNetLoader: {
    label: "加载 ControlNet",
    color: "#14B8A6",
    icon: "\u{1F3AF}",
    category: "model",
    width: 220,
    height: 80,
    defaultFields: [
      F.str("control_net_name", "模型文件"),
    ],
  },
};

/**
 * Get config for a class_type; returns a generic fallback for unknown types.
 */
export function getNodeConfig(classType: string): NodeTypeConfig {
  return (
    CUSTOM_NODE_TYPES[classType] ??
    NODE_TYPE_REGISTRY[classType] ?? {
      label: classType,
      color: "#6B7280",
      icon: "\u{2699}\uFE0F}",
      category: "process",
      width: 200,
      height: 70,
      defaultFields: [],
    }
  );
}

/** All known class_type names (for the "add node" menu). Recomputed on call so
 *  newly-parsed custom nodes appear without a restart. */
export function getAllNodeTypes(): string[] {
  return Object.keys({
    ...NODE_TYPE_REGISTRY,
    ...CUSTOM_NODE_TYPES,
  });
}

/** Category labels for grouping in add-node menu */
export const CATEGORY_LABELS: Record<string, string> = {
  input: "输入",
  output: "输出",
  model: "模型",
  process: "处理",
  conditioning: "条件编码",
  latent: "潜空间",
  image: "图像处理",
  custom: "自定义节点",
};
