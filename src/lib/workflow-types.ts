/**
 * Workflow Type Taxonomy — 工作流类型分类体系
 *
 * 覆盖三大类：图像(静态) / 视频(动态) / 音频·语音
 * 每个类型有缩写、全称、中文描述、所属分类。
 * 用于：
 *   - CreatePanel 中按类型筛选/切换工作流
 *   - WorkflowLibrary 分类展示
 *   - WorkflowTemplate.taskType 的合法值集
 *   - 自定义工作流导入时的类型推断与校验
 */

/* ── 分类枚举 ── */
export const WORKFLOW_CATEGORIES = [
  "image", // 图像侧（静态）
  "video", // 视频侧（动态）
  "audio", // 音频 / 语音侧
] as const;

export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

/* ── 图像侧（静态） ── */
export interface WorkflowTypeDefinition {
  /** 缩写码，如 T2I / I2V / S2V */
  code: string;
  /** 英文全称 */
  fullName: string;
  /** 中文描述 */
  label: string;
  /** 所属一级分类 */
  category: WorkflowCategory;
  /** 更详细的子分类标签（可选） */
  subCategory?: string;
  /** 简短说明（用于 tooltip / 帮助文案） */
  description: string;
  /** 是否为「生成模式」（true）还是「后处理模式」（false，如 Upscale/Outpaint） */
  isGenerative: boolean;
  /** 该类型在 ComfyUI 中常用的节点特征（用于自动推断） */
  hints?: string[];
}

export const IMAGE_WORKFLOW_TYPES: WorkflowTypeDefinition[] = [
  {
    code: "T2I",
    fullName: "Text-to-Image",
    label: "文生图",
    category: "image",
    subCategory: "生成",
    description: "用提示词生成图像（SD / FLUX / Qwen-Image）",
    isGenerative: true,
    hints: ["CLIPTextEncode", "KSampler", "VAEDecode", "EmptyLatentImage"],
  },
  {
    code: "I2I",
    fullName: "Image-to-Image",
    label: "图生图",
    category: "image",
    subCategory: "生成",
    description: "含重绘、风格迁移、denoising 重解释",
    isGenerative: true,
    hints: ["VAEEncode", "LoadImage", "KSampler"],
  },
  {
    code: "TI2I",
    fullName: "Text+Image-to-Image",
    label: "图文混合条件生图",
    category: "image",
    subCategory: "生成",
    description: "少数节点联合驱动",
    isGenerative: true,
  },
  {
    code: "R2I",
    fullName: "Reference-to-Image",
    label: "参考图生图",
    category: "image",
    subCategory: "生成",
    description: "参考图作为主体参考（IP-Adapter / Bernini 等）",
    isGenerative: true,
  },
  {
    code: "E2I",
    fullName: "Edge-to-Image",
    label: "边缘图生图",
    category: "image",
    subCategory: "生成",
    description: "ControlNet 边缘控制",
    isGenerative: true,
    hints: ["ControlNetApply", "CannyEdgePreprocessor"],
  },
  {
    code: "D2I",
    fullName: "Depth-to-Image",
    label: "深度图生图",
    category: "image",
    subCategory: "生成",
    description: "深度图引导生成",
    isGenerative: true,
    hints: ["ControlNetApply", "DepthAnythingPreprocessor"],
  },
  {
    code: "P2I",
    fullName: "Pose-to-Image",
    label: "姿态骨架生图",
    category: "image",
    subCategory: "生成",
    description: "OpenPose 骨架点控制",
    isGenerative: true,
    hints: ["ControlNetApply", "OpenPosePreprocessor"],
  },
  {
    code: "S2I",
    fullName: "Sketch-to-Image",
    label: "线稿生图",
    category: "image",
    subCategory: "生成",
    description: "手绘/线稿转精细图像",
    isGenerative: true,
    hints: ["ControlNetApply", "LineArtPreprocessor"],
  },
  {
    code: "M2I",
    fullName: "Mask-to-Image",
    label: "掩码生图",
    category: "image",
    subCategory: "生成",
    description: "Inpaint 底层，局部重绘",
    isGenerative: true,
    hints: ["VAEInpaint", "SetLatentNoiseMask"],
  },
  {
    code: "Inpaint",
    fullName: "Inpaint",
    label: "局部重绘",
    category: "image",
    subCategory: "编辑",
    description: "I2I 特例，带 mask 的局部重绘",
    isGenerative: false,
    hints: ["VAEInpaint", "SetLatentNoiseMask"],
  },
  {
    code: "Outpaint",
    fullName: "Outpaint",
    label: "扩图",
    category: "image",
    subCategory: "编辑",
    description: "I2V 特例，扩展 canvas 边界",
    isGenerative: false,
    hints: ["LatentUpscale", "GrowMask"],
  },
  {
    code: "Upscale",
    fullName: "Upscale",
    label: "超分放大",
    category: "image",
    subCategory: "后处理",
    description: "不是生成模式，是后处理（常和 T2I/I2I 串用）",
    isGenerative: false,
    hints: ["ImageUpscaleWithModel", "UpscaleModelLoader"],
  },
];

/* ── 视频侧（动态） ── */
export const VIDEO_WORKFLOW_TYPES: WorkflowTypeDefinition[] = [
  {
    code: "T2V",
    fullName: "Text-to-Video",
    label: "文生视频",
    category: "video",
    subCategory: "生成",
    description: "文生视频（Wan T2V / LTX T2V）",
    isGenerative: true,
  },
  {
    code: "I2V",
    fullName: "Image-to-Video",
    label: "单图生视频",
    category: "video",
    subCategory: "生成",
    description: "首帧锁定生成视频",
    isGenerative: true,
  },
  {
    code: "TI2V",
    fullName: "Text+Image-to-Video",
    label: "图文联合生视频",
    category: "video",
    subCategory: "生成",
    description: "Wan TI2V-5B 官方支持",
    isGenerative: true,
  },
  {
    code: "FLF2V",
    fullName: "First-Last-Frame-to-Video",
    label: "首尾帧生视频",
    category: "video",
    subCategory: "生成",
    description:
      "Wan/LTX/Bernini 用（首尾帧只此一个 code，旧 FL2V 已归一至此）",
    isGenerative: true,
  },
  {
    code: "FMF2V",
    fullName: "First-Middle-Last-Frame-to-Video",
    label: "首中尾三帧生视频",
    category: "video",
    subCategory: "生成",
    description: "DaSiWa 工作流新增",
    isGenerative: true,
  },
  {
    code: "V2V",
    fullName: "Video-to-Video",
    label: "视频生视频",
    category: "video",
    subCategory: "编辑",
    description: "风格化/增强/编辑",
    isGenerative: false,
  },
  {
    code: "R2V",
    fullName: "Reference-to-Video",
    label: "参考图生视频",
    category: "video",
    subCategory: "生成",
    description: "主体参考",
    isGenerative: true,
  },
  {
    code: "RV2V",
    fullName: "Reference-Video-to-Video",
    label: "参考视频改视频",
    category: "video",
    subCategory: "编辑",
    description: "",
    isGenerative: false,
  },
  {
    code: "VI2V",
    fullName: "Video-Instruct-to-Video",
    label: "指令改视频",
    category: "video",
    subCategory: "编辑",
    description: "",
    isGenerative: false,
  },
  {
    code: "MV2V",
    fullName: "Mask-Video-to-Video",
    label: "遮罩改视频",
    category: "video",
    subCategory: "编辑",
    description: "",
    isGenerative: false,
  },
  {
    code: "VRC2V",
    fullName: "Video-Region-Control-to-Video",
    label: "区域动作微调",
    category: "video",
    subCategory: "编辑",
    description: "",
    isGenerative: false,
  },
  {
    code: "ADS2V",
    fullName: "Ad-Swap-to-Video",
    label: "广告植入改视频",
    category: "video",
    subCategory: "编辑",
    description: "",
    isGenerative: false,
  },
  {
    code: "S2V",
    fullName: "Speech/Audio-to-Video",
    label: "音频/语音驱生视频",
    category: "video",
    subCategory: "生成",
    description: "Wan S2V-14B, LTX IA2V 同类",
    isGenerative: true,
  },
  {
    code: "IA2V",
    fullName: "Image+Audio-to-Video",
    label: "图+音频生唇形视频",
    category: "video",
    subCategory: "生成",
    description: "LTX 官方",
    isGenerative: true,
  },
  {
    code: "V2A",
    fullName: "Video-to-Audio",
    label: "生音频",
    category: "video",
    subCategory: "后处理",
    description: "反向任务",
    isGenerative: false,
  },
  {
    code: "A2V",
    fullName: "Audio-to-Video",
    label: "音生视频",
    category: "video",
    subCategory: "生成",
    description: "同 S2V，社区另一写法",
    isGenerative: true,
  },
];

/* ── 音频 / 语音侧 ── */
export const AUDIO_WORKFLOW_TYPES: WorkflowTypeDefinition[] = [
  {
    code: "T2A",
    fullName: "Text-to-Audio",
    label: "文生音频/音效",
    category: "audio",
    subCategory: "生成",
    description: "",
    isGenerative: true,
  },
  {
    code: "T2M",
    fullName: "Text-to-Music",
    label: "文生音乐",
    category: "audio",
    subCategory: "生成",
    description: "",
    isGenerative: true,
  },
  {
    code: "T2S",
    fullName: "Text-to-Speech",
    label: "文生语音",
    category: "audio",
    subCategory: "生成",
    description: "",
    isGenerative: true,
  },
  {
    code: "S2S",
    fullName: "Speech-to-Speech",
    label: "语音变语音",
    category: "audio",
    subCategory: "编辑",
    description: "克隆/翻译",
    isGenerative: false,
  },
  {
    code: "A2A",
    fullName: "Audio-to-Audio",
    label: "音频转音频",
    category: "audio",
    subCategory: "后处理",
    description: "降噪/分离",
    isGenerative: false,
  },
  {
    code: "V2T",
    fullName: "Video-to-Text",
    label: "视频生描述",
    category: "audio",
    subCategory: "后处理",
    description: "caption",
    isGenerative: false,
  },
  {
    code: "I2T",
    fullName: "Image-to-Text",
    label: "图生文",
    category: "audio",
    subCategory: "后处理",
    description: "VLM 反向",
    isGenerative: false,
  },
];

/* ── 全量合并表 ── */
export const ALL_WORKFLOW_TYPES: WorkflowTypeDefinition[] = [
  ...IMAGE_WORKFLOW_TYPES,
  ...VIDEO_WORKFLOW_TYPES,
  ...AUDIO_WORKFLOW_TYPES,
];

/* ── 查找工具 ── */

/** 按 code 查找 */
export function getWorkflowType(
  code: string,
): WorkflowTypeDefinition | undefined {
  return ALL_WORKFLOW_TYPES.find(
    (ALL_WORKFLOW_TYPES) => ALL_WORKFLOW_TYPES.code === code,
  );
}

/** 按分类查找 */
export function getWorkflowTypesByCategory(
  cat: WorkflowCategory,
): WorkflowTypeDefinition[] {
  return ALL_WORKFLOW_TYPES.filter(
    (ALL_WORKFLOW_TYPES) => ALL_WORKFLOW_TYPES.category === cat,
  );
}

/** 获取所有合法的 taskType code 集合（用于校验 DB 字段） */
export const VALID_TASK_TYPE_CODES = new Set<string>(
  ALL_WORKFLOW_TYPES.map((ALL_WORKFLOW_TYPES) => ALL_WORKFLOW_TYPES.code),
);

/** 大小写不敏感匹配用的规范 code 表（lower → 规范 code）。
 *  规范 code 本身区分大小写（如 Inpaint / Upscale 为混合大小写），
 *  故以 toLowerCase 作键，命中时回写规范 code，保留规范大小写。 */
const CODE_BY_LOWER = new Map<string, string>(
  ALL_WORKFLOW_TYPES.map((def) => [def.code.toLowerCase(), def.code]),
);

/** 已删除的规范 code → 现存 code 的别名表（去重后必须留一份迁移判据）。
 *
 *  「首尾帧生视频」曾同时存在 FLF2V 与 FL2V 两个同义 code，面板上出现两条同名
 *  条目，已删除 FL2V 只留 FLF2V（见别名表下方归一）。库里若已按旧 code 落过
 *  taskType / modes，必须在读取侧归一到 FLF2V，否则该工作流会被判成「未知模式」
 *  而丢掉模式端口。 */
const RETIRED_CODE_ALIASES = new Map<string, string>([["fl2v", "FLF2V"]]);

/** 将用户/前端输入的任务类型码归一到规范 code（大小写不敏感）。
 *
 *  数据自始即使用规范 code 写入，此函数不再承担历史旧值（TXT2IMG 等）的
 *  映射兼容——只把输入统一成规范大小写；已删 code 按 RETIRED_CODE_ALIASES
 *  归一到现存 code；非规范的自定义类型按原样透传。
 */
export function normalizeTaskType(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  return CODE_BY_LOWER.get(lower) ?? RETIRED_CODE_ALIASES.get(lower) ?? trimmed;
}

/** 一个工作流「当前生效的模式」—— 三处消费方（画布节点 / 工作流库 / 编辑器）
 *  必须得出同一个答案，否则会出现「库里显示单图生视频、卡片却说需要选模式」。
 *
 *  优先级：声明的 defaultMode（且必须仍在 modes 里）→ modes[0] → taskType。
 *  都为空 = 该工作流确实没有模式（此时才谈得上「未声明模式」）。 */
export function resolveWorkflowMode(args: {
  modes?: readonly string[] | null;
  defaultMode?: string | null;
  taskType?: string | null;
}): string | null {
  const modes = (args.modes ?? []).filter(
    (mode): mode is string => typeof mode === "string" && mode.length > 0,
  );
  const declared = args.defaultMode;
  if (declared && (modes.length === 0 || modes.includes(declared)))
    return declared;
  if (modes.length > 0) return modes[0]!;
  if (typeof args.taskType === "string" && args.taskType) {
    return normalizeTaskType(args.taskType);
  }
  return null;
}

/** 根据图中节点自动推断工作流类型 */
export function inferWorkflowTypeFromGraph(
  graph: Record<string, unknown>,
): string {
  const nodeClasses = new Set(
    Object.values(graph)
      .map((n) => {
        const classType = (n as { class_type?: string } | null | undefined)
          ?.class_type;
        return typeof classType === "string" ? classType : "";
      })
      .filter(Boolean),
  );

  // Video detection
  if (
    nodeClasses.has("WanVideoSampler") ||
    nodeClasses.has("VideoLinearScaleUniform")
  ) {
    if (nodeClasses.has("LoadImage")) return "I2V";
    if (nodeClasses.has("WanVideoImageToVideoEncode")) return "TI2V";
    return "T2V";
  }

  // Image-to-image
  if (nodeClasses.has("VAEEncode") && nodeClasses.has("LoadImage")) {
    if (nodeClasses.has("VAEInpaint") || nodeClasses.has("SetLatentNoiseMask"))
      return "Inpaint";
    return "I2I";
  }

  // ControlNet variants
  if (nodeClasses.has("ControlNetApply")) {
    if (
      nodeClasses.has("CannyEdgePreprocessor") ||
      nodeClasses.has("CannyEdgeDetection")
    )
      return "E2I";
    if (nodeClasses.has("DepthAnythingPreprocessor")) return "D2I";
    if (nodeClasses.has("OpenPosePreprocessor")) return "P2I";
    return "R2I";
  }

  // Upscale
  if (
    nodeClasses.has("ImageUpscaleWithModel") ||
    nodeClasses.has("UpscaleModelLoader")
  ) {
    return "Upscale";
  }

  // Default: text-to-image
  return "T2I";
}

/* ── 多模式 JSON 编解码────────────────────────────
 * SQLite 不支持 Prisma 标量数组，故 WorkflowTemplate.modes 存为
 * JSON 字符串（与 Skill.tags 同构）。下面两个函数统一在「DB 列 ↔
 * TS 数组」之间转换，并在任何畸形输入下都安全降级为空数组 / 合法
 * JSON，绝不抛错（路由层吞异常比崩溃更安全）。 */
export function parseModesJson(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string");
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        return arr.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

export function serializeModesJson(modes: string[]): string {
  return JSON.stringify(Array.isArray(modes) ? modes : []);
}
