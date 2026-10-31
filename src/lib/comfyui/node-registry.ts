/**
 * Node Type Registry — 内置 ComfyUI 节点（class_type）→ 展示配置。
 *
 * 只有一个消费者：`src/config/custom-nodes.ts`。自定义节点 manifest 里携带的
 * class_type 是否属于「已知内置节点」（决定节点卡片的来源标签与调试链路标注）
 * 就查这张表。
 */

import type { NodeTypeConfig, FieldDef } from "./node-config";
import { CUSTOM_NODE_TYPES } from "~/config/custom-nodes";

/* ── 共享字段定义（在多种节点类型之间复用） ── */
const F = {
  img: (key: string, label: string): FieldDef => ({
    group: "输入",
    key,
    label,
    type: "image",
  }),
  num: (key: string, label: string, opts?: Partial<FieldDef>): FieldDef => ({
    group: "采样",
    key,
    label,
    type: "number",
    ...opts,
  }),
  sel: (
    key: string,
    label: string,
    options: Array<string>,
    opts?: Partial<FieldDef>,
  ): FieldDef => ({
    group: "采样",
    key,
    label,
    options,
    type: "select",
    ...opts,
  }),
  str: (key: string, label: string, opts?: Partial<FieldDef>): FieldDef => ({
    group: "参数",
    key,
    label,
    type: "string",
    ...opts,
  }),
  text: (key: string, label: string, opts?: Partial<FieldDef>): FieldDef => ({
    group: "提示词",
    key,
    label,
    multiline: true,
    type: "text",
    ...opts,
  }),
  toggle: (key: string, label: string): FieldDef => ({
    group: "选项",
    key,
    label,
    type: "toggle",
  }),
};

// 与 ComfyUI 内置 KSampler 的 sampler / scheduler 名字对齐（见 comfy/samplers.py）。
const SAMPLERS = [
  "euler",
  "euler_ancestral",
  "heun",
  "heunpp2",
  "dpm_2",
  "dpm_2_ancestral",
  "dpmpp_2s_ancestral",
  "dpmpp_2m",
  "dpmpp_2m_sde",
  "dpmpp_2m_sde_gpu",
  "dpmpp_3m_sde",
  "dpmpp_3m_sde_gpu",
  "ddim",
  "ddim_variance",
  "uni_pc",
  "uni_pc_bh2",
  "plms",
  "ipndm",
  "ipndm_v",
  "deis",
  "gradalign",
  "res_multistep",
  "res_multistep_sde",
  "res_multistep_sde_gpu",
  "lcm",
];

const SCHEDULERS = [
  "normal",
  "karras",
  "exponential",
  "sgm_uniform",
  "simple",
  "ddim_uniform",
  "beta",
  "linear_quadratic",
  "kl_optimal",
];

/* 注册表：把 class_type 映射到 NodeTypeConfig。 */
export const NODE_TYPE_REGISTRY: Record<string, NodeTypeConfig> = {
  /* ── Model ── */
  CheckpointLoaderSimple: {
    category: "model",
    color: "#F59E0B", // amber
    defaultFields: [
      F.sel("ckpt_name", "模型文件", [], {
        group: "模型",
        modelFolder: "checkpoints",
        placeholder: "选择 checkpoint...",
      }),
    ],
    height: 80,
    icon: "\u{1F4BE}",
    label: "加载模型",
    width: 220,
  },
  LoraLoader: {
    category: "model",
    color: "#EC4899", // pink
    defaultFields: [
      F.sel("lora_name", "LoRA 文件", [], {
        group: "模型",
        modelFolder: "loras",
        placeholder: "选择 LoRA...",
      }),
      F.num("strength_model", "模型强度", {
        max: 2,
        min: 0,
        placeholder: "0.0 ~ 1.0",
        step: 0.01,
      }),
      F.num("strength_clip", "CLIP 强度", {
        max: 2,
        min: 0,
        placeholder: "0.0 ~ 1.0",
        step: 0.01,
      }),
    ],
    height: 100,
    icon: "\u{1F3A8}",
    label: "加载 LoRA",
    width: 240,
  },

  /* ── Conditioning / Text ── */
  CLIPTextEncode: {
    category: "conditioning",
    color: "#8B5CF6", // purple
    defaultFields: [F.text("text", "提示词", { placeholder: "输入提示词..." })],
    height: 120,
    icon: "\u{270D}\uFE0F",
    label: "编码提示词",
    width: 280,
  },
  CLIPTextEncodeSDXL: {
    category: "conditioning",
    color: "#8B5CF6",
    defaultFields: [
      F.text("text", "主提示词 (G)", { placeholder: "主提示词..." }),
      F.text("text2", "副提示词 (L)", { placeholder: "风格/质量修饰..." }),
    ],
    height: 160,
    icon: "\u{270D}\uFE0F",
    label: "编码提示词 SDXL",
    width: 280,
  },

  /* ── Sampling ── */
  KSampler: {
    category: "process",
    color: "#06B6D4", // cyan
    defaultFields: [
      F.num("steps", "步数", { max: 150, min: 1, placeholder: "20", step: 1 }),
      F.sel("sampler_name", "采样器", SAMPLERS),
      F.sel("scheduler", "调度器", SCHEDULERS),
      F.num("cfg", "CFG", { max: 30, min: 0, placeholder: "7.0", step: 0.5 }),
      F.num("seed", "种子", {
        max: 4294967295,
        min: 0,
        placeholder: "-1 = 随机",
        step: 1,
      }),
      F.num("denoise", "去噪强度", {
        max: 1,
        min: 0,
        placeholder: "1.0",
        step: 0.01,
      }),
    ],
    height: 200,
    icon: "\u{26A1}",
    label: "采样去噪",
    width: 260,
  },
  KSamplerAdvanced: {
    category: "process",
    color: "#06B6D4",
    defaultFields: [
      F.num("steps", "步数", { max: 150, min: 1, placeholder: "20", step: 1 }),
      F.sel("sampler_name", "采样器", SAMPLERS),
      F.sel("scheduler", "调度器", SCHEDULERS),
      F.num("cfg", "CFG", { max: 30, min: 0, placeholder: "7.0", step: 0.5 }),
      F.num("seed", "种子", {
        max: 4294967295,
        min: 0,
        placeholder: "-1 = 随机",
        step: 1,
      }),
      F.num("denoise", "去噪强度", {
        max: 1,
        min: 0,
        placeholder: "1.0",
        step: 0.01,
      }),
      F.num("start_at_step", "起始步", { max: 150, min: 0, step: 1 }),
      F.num("end_at_step", "结束步", { max: 150, min: 0, step: 1 }),
      F.toggle("return_with_leftover_noise", "保留噪声"),
    ],
    height: 220,
    icon: "\u{26A1}",
    label: "高级采样",
    width: 260,
  },

  /* ── Latent ── */
  EmptyLatentImage: {
    category: "latent",
    color: "#10B981", // emerald
    defaultFields: [
      F.num("width", "宽度", {
        group: "潜空间",
        max: 4096,
        min: 64,
        placeholder: "1024",
        step: 8,
      }),
      F.num("height", "高度", {
        group: "潜空间",
        max: 4096,
        min: 64,
        placeholder: "1024",
        step: 8,
      }),
      F.num("batch_size", "批次", {
        group: "潜空间",
        max: 64,
        min: 1,
        placeholder: "1",
        step: 1,
      }),
    ],
    height: 90,
    icon: "\u{1F5BC}\uFE0F",
    label: "初始化潜空间",
    width: 200,
  },
  VAEDecode: {
    category: "latent",
    color: "#10B981",
    defaultFields: [],
    height: 60,
    icon: "\u{1F504}",
    label: "VAE 解码",
    width: 180,
  },
  VAEEncode: {
    category: "latent",
    color: "#10B981",
    defaultFields: [],
    height: 60,
    icon: "\u{1F504}",
    label: "VAE 编码",
    width: 180,
  },

  /* ── Image I/O ── */
  ImageScale: {
    category: "image",
    color: "#3B82F6",
    defaultFields: [
      F.str("upscale_method", "方法"),
      F.num("width", "宽度"),
      F.num("height", "高度"),
      F.toggle("crop", "裁剪"),
    ],
    height: 90,
    icon: "\u{1F50D}",
    label: "缩放图像",
    width: 200,
  },
  LoadImage: {
    category: "input",
    color: "#3B82F6", // blue
    defaultFields: [F.img("image", "图像")],
    height: 90,
    icon: "\u{1F5BC}\uFE0F",
    label: "加载图像",
    width: 200,
  },
  SaveImage: {
    category: "output",
    color: "#EF4444", // red
    defaultFields: [F.str("filename_prefix", "文件名前缀", { placeholder: "ComfyAPP" })],
    height: 60,
    icon: "\u{1F5BB}\uFE0F",
    label: "保存图像",
    width: 180,
  },

  /* ── ControlNet 等常见扩展 ── */
  ControlNetApply: {
    category: "process",
    color: "#14B8A6", // teal
    defaultFields: [
      F.num("strength", "强度", { placeholder: "1.0" }),
      F.num("start_percent", "起始比例"),
      F.num("end_percent", "结束比例"),
    ],
    height: 100,
    icon: "\u{1F3AF}",
    label: "ControlNet 应用",
    width: 220,
  },
  ControlNetLoader: {
    category: "model",
    color: "#14B8A6",
    defaultFields: [F.str("control_net_name", "模型文件")],
    height: 80,
    icon: "\u{1F3AF}",
    label: "加载 ControlNet",
    width: 220,
  },
};

/**
 * 取某个 class_type 的配置；未知类型返回通用兜底配置。
 */
export function getNodeConfig(classType: string): NodeTypeConfig {
  return (
    CUSTOM_NODE_TYPES[classType] ??
    NODE_TYPE_REGISTRY[classType] ?? {
      category: "process",
      color: "#6B7280",
      defaultFields: [],
      height: 70,
      icon: "\u{2699}\uFE0F",
      label: classType,
      width: 200,
    }
  );
}

/* 所有已知的 class_type 名字（内置 + 解析出的自定义节点）。
 * 每次调用都重新计算，因此新解析出来的自定义节点不必重启就能出现。 */
export function getAllNodeTypes(): Array<string> {
  return Object.keys({
    ...NODE_TYPE_REGISTRY,
    ...CUSTOM_NODE_TYPES,
  });
}
