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

/** ComfyUI core built-in nodes (zh-CN UI).  Source: ComfyUI-frontend
 *  apps/src/locales/zh-CN.json, version 0.5.x — manually verified vs
 *  a fresh /object_info payload. */
const NODE_TITLES: Record<string, NodeTitleEntry> = {
  /* ── Loaders ── */
  CheckpointLoaderSimple:        { zh: "Checkpoint 加载器（简易）",         en: "Load Checkpoint" },
  CheckpointLoader:              { zh: "Checkpoint 加载器",               en: "Checkpoint Loader" },
  DiffusersLoader:               { zh: "Diffusers 加载器",                en: "Diffusers Loader" },
  UNETLoader:                    { zh: "UNet 加载器",                    en: "Load UNet" },
  UNetLoader:                    { zh: "UNet 加载器",                    en: "Load UNet" },
  VAELoader:                     { zh: "VAE 加载器",                     en: "Load VAE" },
  CLIPLoader:                    { zh: "CLIP 加载器",                    en: "Load CLIP" },
  DualCLIPLoader:                { zh: "双 CLIP 加载器",                  en: "DualCLIPLoader" },
  ControlNetLoader:              { zh: "ControlNet 加载器",               en: "Load ControlNet Model" },
  LoraLoader:                    { zh: "LoRA 加载器",                    en: "Load LoRA" },
  LoraLoaderModelOnly:           { zh: "LoRA 加载器（仅模型）",            en: "LoRA Loader (Model Only)" },
  CLIPVisionLoader:              { zh: "CLIP Vision 加载器",              en: "CLIPVisionLoader" },
  GLIGENLoader:                  { zh: "GLIGEN 加载器",                  en: "GLIGEN Loader" },
  UpscaleModelLoader:            { zh: "放大模型加载器",                  en: "Load Upscale Model" },
  LoadImage:                     { zh: "加载图像",                       en: "Load Image" },
  LoadImageMask:                 { zh: "加载图像遮罩",                   en: "Load Image (Mask)" },

  /* ── Encoding / text ── */
  CLIPTextEncode:                { zh: "CLIP 文本编码",                  en: "CLIP Text Encode" },
  CLIPTextEncodeSDXL:            { zh: "CLIP 文本编码 (SDXL)",           en: "CLIPTextEncodeSDXL" },
  CLIPSetLastLayer:              { zh: "设置 CLIP 停止层",                en: "CLIP Set Last Layer" },
  ConditioningCombine:           { zh: "条件合并",                       en: "Conditioning (Combine)" },
  ConditioningAverage:           { zh: "条件平均",                       en: "Conditioning (Average)" },
  ConditioningConcat:            { zh: "条件拼接",                       en: "Conditioning (Concat)" },
  ConditioningSetArea:           { zh: "条件设置区域",                    en: "Conditioning (Set Area)" },
  ConditioningSetAreaPercentage: { zh: "条件设置区域百分比",              en: "Set Area by Percentage" },
  ConditioningSetMask:           { zh: "条件设置遮罩",                    en: "Conditioning (Set Mask)" },

  /* ── Sampling / latent ── */
  KSampler:                      { zh: "K 采样器",                       en: "KSampler" },
  KSamplerAdvanced:              { zh: "K 采样器（高级）",                 en: "KSampler (Advanced)" },
  SamplerCustom:                 { zh: "自定义采样器",                    en: "Sampler Custom" },
  SamplerDpmpp2MSDE:             { zh: "DPM++ 2M SDE 采样器",            en: "SamplerDpmpp2MSDE" },
  EmptyLatentImage:              { zh: "空 Latent 图像",                  en: "Empty Latent Image" },
  EmptySD3LatentImage:           { zh: "空 SD3 Latent 图像",              en: "Empty SD3 Latent" },
  EmptyHunyuanLatentVideo:       { zh: "空混元 Latent 视频",               en: "Empty Hunyuan Latent Video" },
  EmptyMochiLikeLatentVideo:     { zh: "空 Mochi 风格 Latent 视频",        en: "Empty Mochi-style Latent Video" },
  LatentRotate:                  { zh: "Latent 旋转",                    en: "Latent Rotate" },
  LatentFlip:                    { zh: "Latent 翻转",                    en: "Latent Flip" },
  LatentCrop:                    { zh: "Latent 裁剪",                    en: "Latent Crop" },
  LatentUpscale:                 { zh: "Latent 放大",                    en: "Latent Upscale" },
  SetLatentNoiseMask:            { zh: "设置 Latent 噪声遮罩",            en: "Set Latent Noise Mask" },

  /* ── Decode / save / preview ── */
  VAEDecode:                     { zh: "VAE 解码",                       en: "VAE Decode" },
  VAEDecodeTiled:                { zh: "VAE 解码（分块）",                en: "VAE Decode (Tiled)" },
  VAEEncode:                     { zh: "VAE 编码",                       en: "VAE Encode" },
  VAEEncodeTiled:                { zh: "VAE 编码（分块）",                en: "VAE Encode (Tiled)" },
  SaveImage:                     { zh: "保存图像",                       en: "Save Image" },
  SaveImageAdvanced:             { zh: "保存图像（高级）",                 en: "Save Image (Advanced)" },
  PreviewImage:                  { zh: "预览图像",                       en: "Preview Image" },

  /* ── Image ops ── */
  ImageBatch:                    { zh: "图像批",                        en: "Image Batch" },
  ImageScale:                    { zh: "图像缩放",                       en: "Image Scale" },
  ImageScaleBy:                  { zh: "图像按比例缩放",                  en: "Image Scale (By Factor)" },
  ImageUpscaleWithModel:         { zh: "图像放大（模型）",                 en: "Image Upscale With Model" },
  ImageInvert:                   { zh: "图像反色",                       en: "Image Invert" },
  ImageColorCorrect:             { zh: "图像色彩校正",                    en: "Image Color Correct" },
  ImageComposite:                { zh: "图像合成",                       en: "Image Composite" },
  ImageCompositeMasked:          { zh: "图像合成（带遮罩）",               en: "Image Composite (Masked)" },

  /* ── Conditioning / controlnet ── */
  ControlNetApply:               { zh: "ControlNet 应用",                 en: "Apply ControlNet" },
  ControlNetApplyAdvanced:       { zh: "ControlNet 应用（高级）",          en: "Apply ControlNet (Advanced)" },
  ApplyFluxControlNet:           { zh: "应用 Flux ControlNet",            en: "Apply Flux ControlNet" },

  /* ── Specialised ── */
  ResolutionSelector:            { zh: "分辨率选择器",                    en: "Resolution Selector" },
  MathExpression:                { zh: "数学表达式",                     en: "Math Expression" },
  PrimitiveNode:                 { zh: "原始值",                        en: "Primitive" },
  Reroute:                       { zh: "转接节点",                       en: "Reroute" },
};

/** Friendly title lookup.
 *
 *  Resolution order:
 *    1. Static NODE_TITLES map (covers ~60 common nodes)
 *    2. The ComfyUI raw `title` property (from properties or root).
 *    3. A cleaned-up variant of the class_type.
 *
 *  @param rawTitle — server-side `detail.nodes[i].title` (ComfyUI's preferred display)
 *  @param lang     — "zh" | "en"
 */
export function friendlyNodeTitle(
  classType: string,
  rawTitle?: string | null,
  lang: "zh" | "en" = "zh"
): string {
  if (!classType) return rawTitle ?? "";
  const entry = NODE_TITLES[classType];
  if (entry) return lang === "zh" ? entry.zh : entry.en;

  // If raw title is a plain class_type echo we treat it as missing; else use it.
  if (rawTitle && rawTitle.trim() && rawTitle.trim() !== classType) {
    return rawTitle.trim();
  }

  // UUID-style extension display nodes
  if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(classType)) {
    return lang === "zh" ? "子工作流" : "Subgraph";
  }

  // Unknown — turn "FooBarBaz" into "Foo Bar Baz" for legibility
  return prettifyClassType(classType, lang);
}

/** "FooBarBaz" → "Foo Bar Baz"; preserves trailing parens "(rgthree)".
 *  Used as the last-resort display name when no static or raw title applies. */
export function prettifyClassType(classType: string, lang: "zh" | "en" = "zh"): string {
  // Strip trailing parenthesised library suffix "(rgthree)" / "(advanced)"
  const parenMatch = /\s*\(([^)]+)\)\s*$/.exec(classType);
  let name = classType;
  let suffix = "";
  if (parenMatch) {
    suffix = parenMatch[1];
    name = classType.slice(0, parenMatch.index!).trim();
  }
  // Convert camelCase / PascalCase into spaces.
  const spaced = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .trim();
  if (lang === "en") return suffix ? `${spaced} (${suffix})` : spaced;
  // zh: leave english as-is but keep the (rgthree) suffix for provenance
  return suffix ? `${spaced}（${suffix}）` : spaced;
}

/** Translate a *single* input name to its zh-CN label.  Returns the original
 *  `name` when no entry matches.  Used when the raw JSON exposes only the
 *  English field name (no `localized_name` field). */
const INPUT_LABELS: Record<string, string> = {
  text:                "文本",
  /* Subgraph wrappers (class_type = UUID) often wire these widget names
   * with a human label like `positive_prompt` / `width_1`.  ComfyUI's
   * frontend maps them to friendly Chinese labels; we replicate the
   * common ones here so the subgraph node reads naturally in zh-CN. */
  text_1:              "反向文本",
  positive_prompt:     "正面提示词",
  negative_prompt:     "反向提示词",
  pos:                 "正向",
  neg:                 "反向",
  ckpt_name:           "Checkpoint",
  model:               "模型",
  clip:                "CLIP",
  vae:                 "VAE",
  positive:            "正向条件",
  negative:            "反向条件",
  latent_image:        "Latent 图像",
  seed:                "随机种子",
  steps:               "采样步数",
  cfg:                 "CFG",
  sampler_name:        "采样器",
  scheduler:           "调度器",
  denoise:             "重绘强度",
  control_after_generate: "生成后控制",
  width:               "宽度",
  width_1:             "宽度",
  height:              "高度",
  height_1:            "高度",
  batch_size:          "批次大小",
  samples:             "Latent",
  pixels:              "图像",
  images:              "图像",
  filename_prefix:     "文件名前缀",
  output_type:         "输出格式",
  format:              "格式",
  strength_model:      "模型强度",
  strength_clip:       "CLIP 强度",
  weight_dtype:        "权重精度",
  control_net_name:    "ControlNet",
  upscale_model_name:  "放大模型",
  upscale_method:      "缩放方法",
  crop:                "裁剪",
  scale_by:            "缩放系数",
  image:               "图像",
  mask:                "遮罩",
  stop_at_clip_layer:  "CLIP 停止层",
  aspect_ratio:        "宽高比",
  megapixels:          "百万像素",
  multiple:            "倍数",
  noise:               "噪声",
  sigmas:              "sigmas",
};
/** Some ComfyUI nodes surface the `label` as the human name with snake_case
 *  English flavour; map the recurring subgraph wrapper labels too. */
const SUBGRAPH_LABELS: Record<string, string> = {
  positive_prompt: "正面提示词",
  negative_prompt: "反向提示词",
  width:           "宽度",
  height:          "高度",
  steps:           "采样步数",
  cfg:             "CFG",
  seed:            "随机种子",
  unet_name:       "UNet",
  clip_name:       "CLIP",
  vae_name:        "VAE",
  control_after_generate: "生成后控制",
  upscale_method:  "缩放方法",
};
export function friendlyInputName(name: string): string {
  if (!name) return "";
  return INPUT_LABELS[name] ?? name;
}
/** Friendly label for a Subgraph wrapper's `label` field, which is the
 *  user-facing name ComfyUI gave that exposed port.  Falls back to
 *  friendlyInputName() and ultimately to the raw key. */
export function friendlySubgraphLabel(name: string): string {
  return SUBGRAPH_LABELS[name] ?? friendlyInputName(name) ?? name;
}
