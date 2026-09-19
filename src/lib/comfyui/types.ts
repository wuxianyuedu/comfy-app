/* ComfyUI 端口类型体系 —— 端口配色、标签与推断助手。
 *
 * 配色与命名口径取自 ComfyUI 自己的 litegraph.js 里 `LGraphCanvas.link_colors`
 * 与 node-type 的显示字符串。我们用同一套给每个连接点与连线着色，
 * 让本项目的流程画布与官方前端保持一致。
 *
 * 这里导出的助手用在两处：
 *   1. `WorkflowCanvasEditor` —— 给逐行的端口点、`← <srcTitle>` 标签与连线着色。
 *   2. 将来：用户试图连接不兼容类型时做 lint / 校验。
 */

/* ── 各数据类型的端口配色（与 ComfyUI 的 litegraph 调色板一致） ── */
export const PORT_COLORS: Record<string, string> = {
  MODEL: "#7C5CFF",
  CONDITIONING: "#FF6B6B",
  LATENT: "#9B59FF",
  IMAGE: "#3FBF7F",
  VAE: "#FFA15C",
  CLIP: "#FFD93D",
  CONTROL_NET: "#3F8FDF",
  MASK: "#1F9F1F",
  STYLE_MODEL: "#C7A93D",
  UPSCALE_MODEL: "#236C36",
  SAM_MODEL: "#A93D3D",
  GLIGEN: "#FF6B6B",
  AUDIO: "#A93D3D",
  VOICE: "#A93D3D",
  MOTION_DATA: "#1F77B4",
  MESH: "#1F77B4",
  POSE: "#1F77B4",
  BBOX: "#A93D3D",
  SEGS: "#A93D3D",
  INT: "#3CA018",
  FLOAT: "#3CA018",
  NUMBER: "#3CA018",
  STRING: "#3CA018",
  COMBO: "#3CA018",
  BOOLEAN: "#3CA018",
  /* 兜底色：低饱和的灰 */
  UNKNOWN: "#7C7C8A",
};

export const DEFAULT_PORT_COLOR = "#7C7C8A";

/* 查一个端口的配色；查不到就用默认色。 */
export function portColor(type: string | undefined | null): string {
  if (!type) return DEFAULT_PORT_COLOR;
  return PORT_COLORS[type] ?? DEFAULT_PORT_COLOR;
}

/* ── 各节点类型的**输出**类型表。ComfyUI 的 API 通过 /object_info 暴露这些，
 *    但画布只需要「每个槽位的输出顺序」—— 那是节点类型最稳定的属性。
 *    拿不到在跑的 /object_info 时，这张静态兜底表让连线配色依旧正确。 */
const OUTPUT_TYPES: Record<string, string[]> = {
  /* Loaders */
  CheckpointLoaderSimple: ["MODEL", "CLIP", "VAE"],
  CheckpointLoader: ["MODEL", "CLIP", "VAE"],
  UNETLoader: ["MODEL"],
  UNetLoader: ["MODEL"],
  CLIPLoader: ["CLIP"],
  DualCLIPLoader: ["CLIP", "CLIP"],
  TripleCLIPLoader: ["CLIP", "CLIP", "CLIP"],
  VAELoader: ["VAE"],
  ControlNetLoader: ["CONTROL_NET"],
  DiffControlNetLoader: ["CONTROL_NET"],
  StyleModelLoader: ["STYLE_MODEL"],
  GLIGENLoader: ["GLIGEN"],
  UpscaleModelLoader: ["UPSCALE_MODEL"],
  LoraLoader: ["MODEL", "CLIP"],
  LoraLoaderModelOnly: ["MODEL"],
  LoRAStacker: ["MODEL"],
  HypernetworkLoader: ["MODEL"],
  /* Samplers */
  KSampler: ["LATENT"],
  KSamplerAdvanced: ["LATENT"],
  KSamplerSelect: ["LATENT"],
  SamplerCustom: ["LATENT", "VAE"],
  SamplerCustomAdvanced: ["LATENT", "VAE"],
  SamplerDpmppEulerAncestralCFG: ["LATENT"],
  /* Latent */
  EmptyLatentImage: ["LATENT"],
  EmptyLatentAudio: ["AUDIO"],
  EmptyImage: ["IMAGE"],
  VAEDecode: ["IMAGE"],
  VAEDecodeTiled: ["IMAGE"],
  VAEEncode: ["LATENT"],
  VAEEncodeTiled: ["LATENT"],
  VAEEncodeForInpaint: ["LATENT"],
  LatentRotate: ["LATENT"],
  LatentFlip: ["LATENT"],
  LatentComposite: ["LATENT"],
  LatentCompositeMasked: ["LATENT"],
  SetLatentNoiseMask: ["LATENT"],
  LatentCrop: ["LATENT"],
  LatentBlend: ["LATENT"],
  LatentFromBatch: ["LATENT"],
  RepeatLatentBatch: ["LATENT"],
  LatentBatch: ["LATENT"],
  LatentInterpolate: ["LATENT"],
  LatentUpfactor: ["LATENT"],
  LatentUpscale: ["LATENT"],
  LatentUpscaleBy: ["LATENT"],
  /* Image */
  LoadImage: ["IMAGE", "MASK"],
  LoadImageMask: ["IMAGE", "MASK"],
  SaveImage: [],
  PreviewImage: [],
  ImageScale: ["IMAGE"],
  ImageScaleBy: ["IMAGE"],
  ImageScaleToTotalPixels: ["IMAGE"],
  ImageUpscaleWithModel: ["IMAGE"],
  ImageBatch: ["IMAGE"],
  ImageRepeat: ["IMAGE"],
  ImageFromBatch: ["IMAGE"],
  ImagePadForOutpaint: ["IMAGE", "MASK"],
  ImageComposite: ["IMAGE"],
  ImageCompositeMasked: ["IMAGE"],
  ImageBlend: ["IMAGE"],
  ImageInvert: ["IMAGE"],
  ImageRGBToYUV: ["IMAGE", "MASK"],
  ImageYUVToRGB: ["IMAGE"],
  ImageColorToMask: ["MASK"],
  ImageColorToMaskV2: ["MASK"],
  ImageMaskToImage: ["IMAGE"],
  ImageToMask: ["MASK"],
  MaskToImage: ["IMAGE"],
  SolidMask: ["MASK"],
  InvertMask: ["MASK"],
  CropMask: ["MASK"],
  MaskComposite: ["MASK"],
  FeatherMask: ["MASK"],
  GrowMask: ["MASK"],
  ThresholdMask: ["MASK"],
  /* Conditioning */
  CLIPTextEncode: ["CONDITIONING"],
  CLIPTextEncodeSDXL: ["CONDITIONING", "CONDITIONING"],
  CLIPTextEncodeSDXLRefiner: ["CONDITIONING"],
  ConditioningCombine: ["CONDITIONING"],
  ConditioningAverage: ["CONDITIONING"],
  ConditioningConcat: ["CONDITIONING"],
  ConditioningSetArea: ["CONDITIONING"],
  ConditioningSetAreaStrength: ["CONDITIONING"],
  ConditioningSetMask: ["CONDITIONING"],
  ControlNetApply: ["CONDITIONING"],
  ControlNetApplyAdvanced: ["CONDITIONING", "CONDITIONING"],
  ApplyStyleModel: ["CONDITIONING"],
  ApplyControlNet: ["CONDITIONING"],
  /* Misc */
  ConditioningZeroOut: ["CONDITIONING"],
  ConditioningTimestepRange: ["CONDITIONING"],
  /* 音频（部分 ComfyUI 音频扩展） */
  VAEDecodeAudio: ["AUDIO"],
  SaveAudio: [],
  LoadAudio: ["AUDIO"],
  /* Wan / I2V / T2V —— WanVideoWrapper 的常见节点名 */
  WanVideoSampler: ["LATENT"],
  WanVideoDecode: ["IMAGE"],
  WanVideoImageToVideoEncode: ["LATENT"],
  WanVideoTextEncode: ["CONDITIONING"],
  WanVideoModelLoader: ["MODEL", "CLIP", "VAE"],
  WanVideoT5TextEncode: ["CONDITIONING"],
};

/* 取某节点类型第 n 个输出槽位产出的数据类型。 */
export function inferOutputType(classType: string, slot: number): string {
  const types = OUTPUT_TYPES[classType];

  if (types && slot >= 0 && slot < types.length) return types[slot]!;

  /* 静态表没列出的自定义节点的启发式兜底

   *  （例如 EmptySD3LatentImage、ModelSamplingAuraFlow、ResolutionSelector 等）。

   *  判据是节点类名本身 —— 在 ComfyUI 五花八门的社区节点生态里，

   *  它相当稳定。 */

  const lower = classType.toLowerCase();

  if (slot === 0) {
    if (lower.startsWith("empty") && lower.includes("latent")) return "LATENT";

    if (lower.startsWith("empty") && lower.includes("image")) return "IMAGE";

    if (lower.startsWith("empty") && lower.includes("audio")) return "AUDIO";

    if (lower.startsWith("empty")) return "LATENT";

    if (
      lower.includes("modelsampling") ||
      lower.includes("modelloader") ||
      lower.includes("patchmodel") ||
      lower.includes("ipadapter") ||
      lower.includes("rescalemodel") ||
      lower.includes("modelsubpatch") ||
      lower === "modelmerge" ||
      lower.startsWith("modelload") ||
      lower.startsWith("modelsamp")
    )
      return "MODEL";

    if (lower.includes("dualclip") || lower.includes("tripleclip"))
      return "CLIP";

    if (
      lower.includes("clip") &&
      !lower.includes("textencode") &&
      !lower.includes("applyclip")
    )
      return "CLIP";

    if (lower.includes("vae") && lower.includes("decode")) return "IMAGE";

    if (lower.includes("vae") && lower.includes("encode")) return "LATENT";

    if (lower.includes("vae")) return "VAE";

    if (
      (lower.includes("controlnet") || lower.includes("applycontrol")) &&
      lower.includes("apply")
    )
      return "CONDITIONING";

    if (lower.includes("controlnet")) return "CONTROL_NET";

    if (lower.includes("upscale") && lower.includes("model"))
      return "UPSCALE_MODEL";

    if (lower.includes("upscale")) return "IMAGE";

    if (lower.includes("style") && lower.includes("model"))
      return "STYLE_MODEL";

    if (lower.includes("style") && lower.includes("apply"))
      return "CONDITIONING";

    if (
      lower.includes("ksampler") ||
      (lower.includes("sampler") && !lower.includes("custom"))
    )
      return "LATENT";

    if (lower.includes("textencode") || lower.includes("conditioning"))
      return "CONDITIONING";

    if (lower.includes("loadimage") || lower.includes("loadmask"))
      return "IMAGE";

    if (
      lower.includes("imagescale") ||
      lower.includes("imagebatch") ||
      lower.includes("imagecomposite") ||
      lower.startsWith("image")
    )
      return "IMAGE";

    if (lower.includes("latent")) return "LATENT";

    if (lower.includes("audio") || lower.includes("sound")) return "AUDIO";
  }

  return "UNKNOWN";
}

/* ── 各节点类型的**输入**类型表。它只覆盖最常用的节点，但信号量很高；
 *    其余一律回落到按名字推断的启发式函数 `inferInputTypeByName`。 */
const INPUT_TYPES: Record<string, Record<string, string>> = {
  KSampler: {
    model: "MODEL",
    positive: "CONDITIONING",
    negative: "CONDITIONING",
    latent_image: "LATENT",
    seed: "INT",
    steps: "INT",
    cfg: "FLOAT",
    denoise: "FLOAT",
    sampler_name: "COMBO",
    scheduler: "COMBO",
    control: "CONTROL_NET",
  },
  KSamplerAdvanced: {
    model: "MODEL",
    positive: "CONDITIONING",
    negative: "CONDITIONING",
    latent_image: "LATENT",
  },
  CLIPTextEncode: {
    clip: "CLIP",
    text: "STRING",
  },
  CLIPTextEncodeSDXL: {
    clip_g: "CLIP",
    clip_l: "CLIP",
    width: "INT",
    height: "INT",
    text_g: "STRING",
    text_l: "STRING",
  },
  CheckpointLoaderSimple: {
    ckpt_name: "COMBO",
  },
  UNETLoader: {
    unet_name: "COMBO",
    weight_dtype: "COMBO",
  },
  UNetLoader: {
    unet_name: "COMBO",
  },
  CLIPLoader: {
    clip_name: "COMBO",
    type: "COMBO",
  },
  DualCLIPLoader: {
    clip_name1: "COMBO",
    clip_name2: "COMBO",
    type: "COMBO",
  },
  VAELoader: {
    vae_name: "COMBO",
  },
  ControlNetLoader: {
    control_net_name: "COMBO",
  },
  VAEDecode: {
    samples: "LATENT",
    vae: "VAE",
  },
  VAEEncode: {
    pixels: "IMAGE",
    vae: "VAE",
  },
  EmptyLatentImage: {
    width: "INT",
    height: "INT",
    batch_size: "INT",
  },
  LoadImage: {
    image: "COMBO",
    upload: "IMAGE",
  },
  SaveImage: {
    filename_prefix: "STRING",
    images: "IMAGE",
  },
  LoraLoader: {
    model: "MODEL",
    clip: "CLIP",
    lora_name: "COMBO",
    strength_model: "FLOAT",
    strength_clip: "FLOAT",
  },
  ControlNetApply: {
    conditioning: "CONDITIONING",
    control_net: "CONTROL_NET",
    image: "IMAGE",
    strength: "FLOAT",
  },
  ConditioningCombine: {
    conditioning_1: "CONDITIONING",
    conditioning_2: "CONDITIONING",
  },
  ConditioningAverage: {
    conditioning_to: "CONDITIONING",
    conditioning_from: "CONDITIONING",
    conditioning_to_strength: "FLOAT",
  },
  ImageScale: {
    image: "IMAGE",
    upscale_method: "COMBO",
    width: "INT",
    height: "INT",
    crop: "COMBO",
  },
  ImageUpscaleWithModel: {
    upscale_model: "UPSCALE_MODEL",
    image: "IMAGE",
  },
  LatentUpscale: {
    samples: "LATENT",
    upscale_method: "COMBO",
    width: "INT",
    height: "INT",
    crop: "COMBO",
  },
  SetLatentNoiseMask: {
    samples: "LATENT",
    mask: "MASK",
  },
};

/* 判断某节点类型上某个输入槽位的数据类型。兜底是「按输入名启发式推断」。
 *  实在判断不出时返回 "UNKNOWN" —— 渲染器那时画一个通用灰点。 */
export function inferInputType(
  classType: string,
  inputName: string,
  value?: unknown,
): string {
  const fromTable = INPUT_TYPES[classType]?.[inputName];
  if (fromTable) return fromTable;
  if (value !== undefined) {
    if (Array.isArray(value)) return "CONNECTION"; // placeholder
    if (typeof value === "number") {
      return Number.isInteger(value) ? "INT" : "FLOAT";
    }
    if (typeof value === "boolean") return "BOOLEAN";
    if (typeof value === "string") return "STRING";
  }
  return inferInputTypeByName(inputName);
}

/* 仅按输入名做的启发式推断。 */
export function inferInputTypeByName(name: string): string {
  const lower = name.toLowerCase();

  if (lower === "model" || lower.includes("model")) return "MODEL";

  if (
    lower === "clip" ||
    lower === "clip_g" ||
    lower === "clip_l" ||
    lower === "clip_name"
  )
    return "CLIP";

  if (lower === "vae" || lower === "vae_name") return "VAE";

  if (
    lower === "positive" ||
    lower === "negative" ||
    lower === "conditioning" ||
    lower.startsWith("cond")
  )
    return "CONDITIONING";

  if (
    lower === "latent" ||
    lower === "latent_image" ||
    lower === "samples" ||
    lower.endsWith("_latent")
  )
    return "LATENT";

  if (
    lower === "image" ||
    lower === "images" ||
    lower === "pixels" ||
    lower === "output_image"
  )
    return "IMAGE";

  if (lower === "mask" || lower.endsWith("_mask")) return "MASK";

  if (lower === "control_net" || lower.endsWith("_controlnet"))
    return "CONTROL_NET";

  if (lower === "upscale_model" || lower === "model_name")
    return "UPSCALE_MODEL";

  if (lower === "audio" || lower === "waveform") return "AUDIO";

  /* 按后缀识别的控件类型 */

  if (lower === "seed") return "INT";

  if (lower === "steps" || lower === "step") return "INT";

  if (
    lower === "cfg" ||
    lower === "denoise" ||
    lower === "strength" ||
    lower === "scale" ||
    lower.includes("strength")
  )
    return "FLOAT";

  if (
    lower === "width" ||
    lower === "height" ||
    lower === "batch_size" ||
    lower.endsWith("_size") ||
    lower.endsWith("_count")
  )
    return "INT";

  if (
    lower === "sampler_name" ||
    lower === "scheduler" ||
    lower === "method" ||
    lower.endsWith("_method")
  )
    return "COMBO";

  if (
    lower.endsWith("_name") ||
    lower === "filename_prefix" ||
    lower === "ckpt_name"
  )
    return "COMBO";

  if (
    lower === "text" ||
    lower.endsWith("_text") ||
    lower === "prompt" ||
    lower === "negative_prompt"
  )
    return "STRING";

  if (lower === "noise_mask" || lower === "return_with_leftover_noise")
    return "COMBO";

  if (
    lower === "start_at_step" ||
    lower === "end_at_step" ||
    lower === "return_with_leftover_noise"
  )
    return "COMBO";

  return "UNKNOWN";
}

/* ── 多行 STRING 的识别 ─────────────────────────────────
 *
 *  ComfyUI 只有在节点 Python 侧的 `INPUT_TYPES()` 给该输入声明了该选项时，
 *  才把 STRING 控件渲染成文本域：
 *
 *      "value": (IO.STRING, {"multiline": True})     ← 对应 PrimitiveStringMultiline
 *      "text":  (IO.STRING, {"multiline": True, "dynamic_prompts": True})  ← 同理
 *      "filename_prefix": ("STRING", {"default": "ComfyUI"})   ← 单行
 *
 *  这是**声明的类型事实**，只能从 /api/object_info 读到（节点自己不带）。
 *  因此这里只接受调用方查到的声明标志，不再按 name / label 猜 —— 「叫 prompt
 *  的就是多行」会让 `prompt_width_of_thing` 这类名字把单行输入升级成 textarea，
 *  也会让改了名的提示词框掉回单行（用户口径：「不要用名字判断，看类型声明」）。
 *
 *  唯一保留的非声明判据是**当前值长度**：ComfyUI 未启动时读不到
 *  object_info，此时长文本仍是可靠信号（它不是名字，是数据）。阈值与表单侧
 *  `controlForEntry` 的 > 40 一致，两条路径据此收敛。
 *
 *  消费者：WorkflowNode / WorkflowSubgraphNode 的 `isStringWidget`、
 *  DynamicWorkflowForm（经 workflowIO.multiline）。画布那两个直接读服务端盖章的
 *  `rawMeta[k].multiline`，不自己重算。 */
export function inferIsMultiline(
  declaredMultiline: boolean | undefined,
  defaultValue?: unknown,
): boolean {
  if (declaredMultiline === true) return true;
  return typeof defaultValue === "string" && defaultValue.length > 40;
}

/* 给定一条连线的目标端，结合「源节点类型 + 槽位」返回源侧提供的**输出**类型。
 *  用于给连线着色，以及连接行右侧那个小类型标签。 */
export function edgeType(
  srcClass: string | undefined,
  srcSlot: number,
): string {
  if (!srcClass) return "UNKNOWN";
  return inferOutputType(srcClass, srcSlot);
}

/* 与 `edgeType` 相同，只是多一层按值兜底：源节点类型未知时，
 *  改从这条线喂进去的那个输入**名字**来推断。 */
export function edgeTypeByInputName(name: string): string {
  return inferInputTypeByName(name);
}
