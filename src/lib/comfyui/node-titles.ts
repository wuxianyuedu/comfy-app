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

type NodeTitleEntry = {
  en: string;
  zh: string;
};

/* ComfyUI 核心内置节点（简体中文界面的叫法）。
 * 来源是 ComfyUI 前端 apps/src/locales/zh-CN.json（0.5.x 版），
 * 并逐条对照过一份新的 /object_info 响应。 */
const NODE_TITLES: Record<string, NodeTitleEntry> = {
  /* ── Loaders ── */
  CheckpointLoader: { en: "Checkpoint Loader", zh: "Checkpoint 加载器" },
  CheckpointLoaderSimple: {
    en: "Load Checkpoint",
    zh: "Checkpoint 加载器（简易）",
  },
  CLIPLoader: { en: "Load CLIP", zh: "CLIP 加载器" },
  CLIPVisionLoader: { en: "CLIPVisionLoader", zh: "CLIP Vision 加载器" },
  ControlNetLoader: { en: "Load ControlNet Model", zh: "ControlNet 加载器" },
  DiffusersLoader: { en: "Diffusers Loader", zh: "Diffusers 加载器" },
  DualCLIPLoader: { en: "DualCLIPLoader", zh: "双 CLIP 加载器" },
  GLIGENLoader: { en: "GLIGEN Loader", zh: "GLIGEN 加载器" },
  LoadImage: { en: "Load Image", zh: "加载图像" },
  LoadImageMask: { en: "Load Image (Mask)", zh: "加载图像遮罩" },
  LoraLoader: { en: "Load LoRA", zh: "LoRA 加载器" },
  LoraLoaderModelOnly: {
    en: "LoRA Loader (Model Only)",
    zh: "LoRA 加载器（仅模型）",
  },
  UNETLoader: { en: "Load UNet", zh: "UNet 加载器" },
  UNetLoader: { en: "Load UNet", zh: "UNet 加载器" },
  UpscaleModelLoader: { en: "Load Upscale Model", zh: "放大模型加载器" },
  VAELoader: { en: "Load VAE", zh: "VAE 加载器" },

  /* ── Encoding / text ── */
  CLIPSetLastLayer: { en: "CLIP Set Last Layer", zh: "设置 CLIP 停止层" },
  CLIPTextEncode: { en: "CLIP Text Encode", zh: "CLIP 文本编码" },
  CLIPTextEncodeSDXL: { en: "CLIPTextEncodeSDXL", zh: "CLIP 文本编码 (SDXL)" },
  ConditioningAverage: { en: "Conditioning (Average)", zh: "条件平均" },
  ConditioningCombine: { en: "Conditioning (Combine)", zh: "条件合并" },
  ConditioningConcat: { en: "Conditioning (Concat)", zh: "条件拼接" },
  ConditioningSetArea: { en: "Conditioning (Set Area)", zh: "条件设置区域" },
  ConditioningSetAreaPercentage: {
    en: "Set Area by Percentage",
    zh: "条件设置区域百分比",
  },
  ConditioningSetMask: { en: "Conditioning (Set Mask)", zh: "条件设置遮罩" },

  /* ── Sampling / latent ── */
  EmptyHunyuanLatentVideo: {
    en: "Empty Hunyuan Latent Video",
    zh: "空混元 Latent 视频",
  },
  EmptyLatentImage: { en: "Empty Latent Image", zh: "空 Latent 图像" },
  EmptyMochiLikeLatentVideo: {
    en: "Empty Mochi-style Latent Video",
    zh: "空 Mochi 风格 Latent 视频",
  },
  EmptySD3LatentImage: { en: "Empty SD3 Latent", zh: "空 SD3 Latent 图像" },
  KSampler: { en: "KSampler", zh: "K 采样器" },
  KSamplerAdvanced: { en: "KSampler (Advanced)", zh: "K 采样器（高级）" },
  LatentCrop: { en: "Latent Crop", zh: "Latent 裁剪" },
  LatentFlip: { en: "Latent Flip", zh: "Latent 翻转" },
  LatentRotate: { en: "Latent Rotate", zh: "Latent 旋转" },
  LatentUpscale: { en: "Latent Upscale", zh: "Latent 放大" },
  SamplerCustom: { en: "Sampler Custom", zh: "自定义采样器" },
  SamplerDpmpp2MSDE: { en: "SamplerDpmpp2MSDE", zh: "DPM++ 2M SDE 采样器" },
  SetLatentNoiseMask: {
    en: "Set Latent Noise Mask",
    zh: "设置 Latent 噪声遮罩",
  },

  /* ── 解码 / 保存 / 预览 ── */
  PreviewImage: { en: "Preview Image", zh: "预览图像" },
  SaveImage: { en: "Save Image", zh: "保存图像" },
  SaveImageAdvanced: { en: "Save Image (Advanced)", zh: "保存图像（高级）" },
  VAEDecode: { en: "VAE Decode", zh: "VAE 解码" },
  VAEDecodeTiled: { en: "VAE Decode (Tiled)", zh: "VAE 解码（分块）" },
  VAEEncode: { en: "VAE Encode", zh: "VAE 编码" },
  VAEEncodeTiled: { en: "VAE Encode (Tiled)", zh: "VAE 编码（分块）" },

  /* ── Image ops ── */
  ImageBatch: { en: "Image Batch", zh: "图像批" },
  ImageColorCorrect: { en: "Image Color Correct", zh: "图像色彩校正" },
  ImageComposite: { en: "Image Composite", zh: "图像合成" },
  ImageCompositeMasked: {
    en: "Image Composite (Masked)",
    zh: "图像合成（带遮罩）",
  },
  ImageInvert: { en: "Image Invert", zh: "图像反色" },
  ImageScale: { en: "Image Scale", zh: "图像缩放" },
  ImageScaleBy: { en: "Image Scale (By Factor)", zh: "图像按比例缩放" },
  ImageUpscaleWithModel: {
    en: "Image Upscale With Model",
    zh: "图像放大（模型）",
  },

  /* ── Conditioning / controlnet ── */
  ApplyFluxControlNet: {
    en: "Apply Flux ControlNet",
    zh: "应用 Flux ControlNet",
  },
  ControlNetApply: { en: "Apply ControlNet", zh: "ControlNet 应用" },
  ControlNetApplyAdvanced: {
    en: "Apply ControlNet (Advanced)",
    zh: "ControlNet 应用（高级）",
  },

  /* ── Specialised ── */
  MathExpression: { en: "Math Expression", zh: "数学表达式" },
  PrimitiveNode: { en: "Primitive", zh: "原始值" },
  Reroute: { en: "Reroute", zh: "转接节点" },
  ResolutionSelector: { en: "Resolution Selector", zh: "分辨率选择器" },
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
  if (!classType) {
    return rawTitle ?? "";
  }
  // (1) 作者自己填的标题优先 —— 那是为了与同 classType 的兄弟节点区分而特意写的。
  // 不调换这个顺序的话，静态表（例如 SaveImage 对应「保存图像」）
  // 会悄悄盖掉用户自定义的名字（例如 "Save Z-Anime Upscaled"），
  // 用户的意图在画布上就看不出来了。
  if (rawTitle?.trim() && rawTitle.trim() !== classType) {
    return rawTitle.trim();
  }

  const entry = NODE_TITLES[classType];
  if (entry) {
    return lang === "zh" ? entry.zh : entry.en;
  }

  // 以 UUID 形式命名的扩展显示节点
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType)) {
    return lang === "zh" ? "子工作流" : "Subgraph";
  }

  // 未知类型 —— 把 "FooBarBaz" 变成 "Foo Bar Baz"，提升可读性
  return prettifyClassType(classType, lang);
}

/* "FooBarBaz" → "Foo Bar Baz"，并保留尾部的括号后缀 "(rgthree)"。
 * 静态表与 rawTitle 都不适用时，用它作为最后兜底的显示名。 */
export function prettifyClassType(classType: string, lang: "zh" | "en" = "zh"): string {
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
  if (lang === "en") {
    return suffix ? `${spaced} (${suffix})` : spaced;
  }
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
  aspect_ratio: "宽高比",
  batch_size: "批次大小",
  cfg: "CFG",
  ckpt_name: "Checkpoint",
  clip: "CLIP",
  control_after_generate: "生成后控制",
  control_net_name: "ControlNet",
  crop: "裁剪",
  denoise: "重绘强度",
  filename_prefix: "文件名前缀",
  format: "格式",
  height: "高度",
  height_1: "高度",
  image: "图像",
  images: "图像",
  latent_image: "Latent 图像",
  mask: "遮罩",
  megapixels: "百万像素",
  model: "模型",
  multiple: "倍数",
  neg: "反向",
  negative: "反向条件",
  negative_prompt: "反向提示词",
  noise: "噪声",
  output_type: "输出格式",
  pixels: "图像",
  pos: "正向",
  positive: "正向条件",
  positive_prompt: "正面提示词",
  sampler_name: "采样器",
  samples: "Latent",
  scale_by: "缩放系数",
  scheduler: "调度器",
  seed: "随机种子",
  sigmas: "sigmas",
  steps: "采样步数",
  stop_at_clip_layer: "CLIP 停止层",
  strength_clip: "CLIP 强度",
  strength_model: "模型强度",
  text_1: "反向文本",
  upscale_method: "缩放方法",
  upscale_model_name: "放大模型",
  vae: "VAE",
  weight_dtype: "权重精度",
  width: "宽度",
  width_1: "宽度",
};
export function friendlyInputName(name: string): string {
  if (!name) {
    return "";
  }
  return INPUT_LABELS[name] ?? name;
}
