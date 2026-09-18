/**
 * ComfyUI 节点「中文友好标题」映射表
 *
 * ComfyUI 服务端会通过 /object_info 把每个 class_type 映射成一个本地化
 * display_name（zh-CN / en-US）。  我们离线状态下拿不到那个映射，所以
 * 这里维护一份静态的 fallback，覆盖最常用的 60+ 内置节点；其他未列出
 * 的 class_type 会按下面 friendlyNodeTitle() 的兜底逻辑展示。
 *
 * Key 规则：
 *   - key 永远是 ComfyUI 的 class_type（大小写敏感）
 *   - 显示中文优先；若调用方 ctx="en" 则给英文版本
 */

interface NodeTitleEntry {
  zh: string;
  en: string;
}

/* ComfyUI 核心内置节点（简体中文界面的叫法）。
 * 来源是 ComfyUI 前端 apps/src/locales/zh-CN.json（0.5.x 版），
 * 并逐条对照过一份新的 /object_info 响应。 */
const NODE_TITLES: Record<string, NodeTitleEntry> = {
  /* ── Loaders ── */
  CheckpointLoaderSimple: {
    zh: "Checkpoint 加载器（简易）",
    en: "Load Checkpoint",
  },
  CheckpointLoader: { zh: "Checkpoint 加载器", en: "Checkpoint Loader" },
  DiffusersLoader: { zh: "Diffusers 加载器", en: "Diffusers Loader" },
  UNETLoader: { zh: "UNet 加载器", en: "Load UNet" },
  UNetLoader: { zh: "UNet 加载器", en: "Load UNet" },
  VAELoader: { zh: "VAE 加载器", en: "Load VAE" },
  CLIPLoader: { zh: "CLIP 加载器", en: "Load CLIP" },
  DualCLIPLoader: { zh: "双 CLIP 加载器", en: "DualCLIPLoader" },
  ControlNetLoader: { zh: "ControlNet 加载器", en: "Load ControlNet Model" },
  LoraLoader: { zh: "LoRA 加载器", en: "Load LoRA" },
  LoraLoaderModelOnly: {
    zh: "LoRA 加载器（仅模型）",
    en: "LoRA Loader (Model Only)",
  },
  CLIPVisionLoader: { zh: "CLIP Vision 加载器", en: "CLIPVisionLoader" },
  GLIGENLoader: { zh: "GLIGEN 加载器", en: "GLIGEN Loader" },
  UpscaleModelLoader: { zh: "放大模型加载器", en: "Load Upscale Model" },
  LoadImage: { zh: "加载图像", en: "Load Image" },
  LoadImageMask: { zh: "加载图像遮罩", en: "Load Image (Mask)" },

  /* ── Encoding / text ── */
  CLIPTextEncode: { zh: "CLIP 文本编码", en: "CLIP Text Encode" },
  CLIPTextEncodeSDXL: { zh: "CLIP 文本编码 (SDXL)", en: "CLIPTextEncodeSDXL" },
  CLIPSetLastLayer: { zh: "设置 CLIP 停止层", en: "CLIP Set Last Layer" },
  ConditioningCombine: { zh: "条件合并", en: "Conditioning (Combine)" },
  ConditioningAverage: { zh: "条件平均", en: "Conditioning (Average)" },
  ConditioningConcat: { zh: "条件拼接", en: "Conditioning (Concat)" },
  ConditioningSetArea: { zh: "条件设置区域", en: "Conditioning (Set Area)" },
  ConditioningSetAreaPercentage: {
    zh: "条件设置区域百分比",
    en: "Set Area by Percentage",
  },
  ConditioningSetMask: { zh: "条件设置遮罩", en: "Conditioning (Set Mask)" },

  /* ── Sampling / latent ── */
  KSampler: { zh: "K 采样器", en: "KSampler" },
  KSamplerAdvanced: { zh: "K 采样器（高级）", en: "KSampler (Advanced)" },
  SamplerCustom: { zh: "自定义采样器", en: "Sampler Custom" },
  SamplerDpmpp2MSDE: { zh: "DPM++ 2M SDE 采样器", en: "SamplerDpmpp2MSDE" },
  EmptyLatentImage: { zh: "空 Latent 图像", en: "Empty Latent Image" },
  EmptySD3LatentImage: { zh: "空 SD3 Latent 图像", en: "Empty SD3 Latent" },
  EmptyHunyuanLatentVideo: {
    zh: "空混元 Latent 视频",
    en: "Empty Hunyuan Latent Video",
  },
  EmptyMochiLikeLatentVideo: {
    zh: "空 Mochi 风格 Latent 视频",
    en: "Empty Mochi-style Latent Video",
  },
  LatentRotate: { zh: "Latent 旋转", en: "Latent Rotate" },
  LatentFlip: { zh: "Latent 翻转", en: "Latent Flip" },
  LatentCrop: { zh: "Latent 裁剪", en: "Latent Crop" },
  LatentUpscale: { zh: "Latent 放大", en: "Latent Upscale" },
  SetLatentNoiseMask: {
    zh: "设置 Latent 噪声遮罩",
    en: "Set Latent Noise Mask",
  },

  /* ── 解码 / 保存 / 预览 ── */
  VAEDecode: { zh: "VAE 解码", en: "VAE Decode" },
  VAEDecodeTiled: { zh: "VAE 解码（分块）", en: "VAE Decode (Tiled)" },
  VAEEncode: { zh: "VAE 编码", en: "VAE Encode" },
  VAEEncodeTiled: { zh: "VAE 编码（分块）", en: "VAE Encode (Tiled)" },
  SaveImage: { zh: "保存图像", en: "Save Image" },
  SaveImageAdvanced: { zh: "保存图像（高级）", en: "Save Image (Advanced)" },
  PreviewImage: { zh: "预览图像", en: "Preview Image" },

  /* ── Image ops ── */
  ImageBatch: { zh: "图像批", en: "Image Batch" },
  ImageScale: { zh: "图像缩放", en: "Image Scale" },
  ImageScaleBy: { zh: "图像按比例缩放", en: "Image Scale (By Factor)" },
  ImageUpscaleWithModel: {
    zh: "图像放大（模型）",
    en: "Image Upscale With Model",
  },
  ImageInvert: { zh: "图像反色", en: "Image Invert" },
  ImageColorCorrect: { zh: "图像色彩校正", en: "Image Color Correct" },
  ImageComposite: { zh: "图像合成", en: "Image Composite" },
  ImageCompositeMasked: {
    zh: "图像合成（带遮罩）",
    en: "Image Composite (Masked)",
  },

  /* ── Conditioning / controlnet ── */
  ControlNetApply: { zh: "ControlNet 应用", en: "Apply ControlNet" },
  ControlNetApplyAdvanced: {
    zh: "ControlNet 应用（高级）",
    en: "Apply ControlNet (Advanced)",
  },
  ApplyFluxControlNet: {
    zh: "应用 Flux ControlNet",
    en: "Apply Flux ControlNet",
  },

  /* ── Specialised ── */
  ResolutionSelector: { zh: "分辨率选择器", en: "Resolution Selector" },
  MathExpression: { zh: "数学表达式", en: "Math Expression" },
  PrimitiveNode: { zh: "原始值", en: "Primitive" },
  Reroute: { zh: "转接节点", en: "Reroute" },
};

/** 友好标题查询。
 *
 *  Resolution order:
 *    1. **用户自己填的 `rawTitle`**（来自 ComfyUI 的属性对话框，
 *       例如 "Save Z-Anime Upscaled"）。作者特意写它，就是为了区分
 *       同 classType 的兄弟节点，因此这个意图必须优先于静态表。
 *       如果 `rawTitle` 只是把 classType 原样抄一遍，视为「没改名」。
 *    2. 静态 NODE_TITLES 表（覆盖约 60 个常见核心节点）。
 *    3. Cleaned-up classType (UUID → "子工作流", FooBarBaz → "Foo Bar Baz").
 *
 *  @param rawTitle — 服务端给的 `detail.nodes[i].title`（ComfyUI 的首选显示名）
 *  @param lang     — "zh" 或 "en"
 */
export function friendlyNodeTitle(
  classType: string,
  rawTitle?: string | null,
  lang: "zh" | "en" = "zh",
): string {
  if (!classType) return rawTitle ?? "";
  // (1) 作者自己填的标题优先 —— 那是为了与同 classType 的兄弟节点区分而特意写的。
  // 不调换这个顺序的话，静态表（例如 SaveImage 对应「保存图像」）
  // 会悄悄盖掉用户自定义的名字（例如 "Save Z-Anime Upscaled"），
  // 用户的意图在画布上就看不出来了。
  if (rawTitle?.trim() && rawTitle.trim() !== classType) {
    return rawTitle.trim();
  }

  const entry = NODE_TITLES[classType];
  if (entry) return lang === "zh" ? entry.zh : entry.en;

  // 以 UUID 形式命名的扩展显示节点
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType)) {
    return lang === "zh" ? "子工作流" : "Subgraph";
  }

  // 未知类型 —— 把 "FooBarBaz" 变成 "Foo Bar Baz"，提升可读性
  return prettifyClassType(classType, lang);
}

/* "FooBarBaz" → "Foo Bar Baz"，并保留尾部的括号后缀 "(rgthree)"。
 * 静态表与 rawTitle 都不适用时，用它作为最后兜底的显示名。 */
export function prettifyClassType(
  classType: string,
  lang: "zh" | "en" = "zh",
): string {
  // 去掉尾部的库名括号后缀，例如 "(rgthree)" 或 "(advanced)"
  const parenMatch = /\s*\(([^)]+)\)\s*$/.exec(classType);
  let name = classType;
  let suffix = "";
  if (parenMatch) {
    suffix = parenMatch[1]!;
    name = classType.slice(0, parenMatch.index).trim();
  }
  // 把 camelCase 与 PascalCase 拆成以空格分隔的单词。
  const spaced = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .trim();
  if (lang === "en") return suffix ? `${spaced} (${suffix})` : spaced;
  // 中文模式：英文原样保留，但留着 (rgthree) 后缀以标明来源
  return suffix ? `${spaced}（${suffix}）` : spaced;
}

/* 把**单个**输入名翻译成中文标签；没有对应条目时原样返回 `name`。
 * 原始 JSON 只给了英文字段名（没有 `localized_name`）时用它。 */
const INPUT_LABELS: Record<string, string> = {
  text: "文本",
  /* 子图 wrapper（class_type 是 UUID）常把这些控件名接成人可读的标签，
   * 例如 `positive_prompt` 或 `width_1`。ComfyUI 前端会把它们映射成中文标签，
   * 这里把常见的那批复制一份，让子图节点在中文界面下读起来自然。 */
  text_1: "反向文本",
  positive_prompt: "正面提示词",
  negative_prompt: "反向提示词",
  pos: "正向",
  neg: "反向",
  ckpt_name: "Checkpoint",
  model: "模型",
  clip: "CLIP",
  vae: "VAE",
  positive: "正向条件",
  negative: "反向条件",
  latent_image: "Latent 图像",
  seed: "随机种子",
  steps: "采样步数",
  cfg: "CFG",
  sampler_name: "采样器",
  scheduler: "调度器",
  denoise: "重绘强度",
  control_after_generate: "生成后控制",
  width: "宽度",
  width_1: "宽度",
  height: "高度",
  height_1: "高度",
  batch_size: "批次大小",
  samples: "Latent",
  pixels: "图像",
  images: "图像",
  filename_prefix: "文件名前缀",
  output_type: "输出格式",
  format: "格式",
  strength_model: "模型强度",
  strength_clip: "CLIP 强度",
  weight_dtype: "权重精度",
  control_net_name: "ControlNet",
  upscale_model_name: "放大模型",
  upscale_method: "缩放方法",
  crop: "裁剪",
  scale_by: "缩放系数",
  image: "图像",
  mask: "遮罩",
  stop_at_clip_layer: "CLIP 停止层",
  aspect_ratio: "宽高比",
  megapixels: "百万像素",
  multiple: "倍数",
  noise: "噪声",
  sigmas: "sigmas",
};
export function friendlyInputName(name: string): string {
  if (!name) return "";
  return INPUT_LABELS[name] ?? name;
}
