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
export const WORKFLOW_CATEGORIES = /* SAFETY: 类型断言已复核 */ [
  "image", // 图像侧（静态）
  "video", // 视频侧（动态）
  "audio", // 音频 / 语音侧
] as const;

export type WorkflowCategory = (typeof WORKFLOW_CATEGORIES)[number];

/* ── 图像侧（静态） ── */
export type WorkflowTypeDefinition = {
  /** 所属一级分类 */
  category: WorkflowCategory;
  /** 缩写码，如 T2I / I2V / S2V */
  code: string;
  /** 简短说明（用于 tooltip / 帮助文案） */
  description: string;
  /** 英文全称 */
  fullName: string;
  /** 该类型在 ComfyUI 中常用的节点特征（用于自动推断） */
  hints?: Array<string>;
  /** 是否为「生成模式」（true）还是「后处理模式」（false，如 Upscale/Outpaint） */
  isGenerative: boolean;
  /** 中文描述 */
  label: string;
  /** 更详细的子分类标签（可选） */
  subCategory?: string;
};

export const IMAGE_WORKFLOW_TYPES: Array<WorkflowTypeDefinition> = [
  {
    category: "image",
    code: "T2I",
    description: "用提示词生成图像（SD / FLUX / Qwen-Image）",
    fullName: "Text-to-Image",
    hints: ["CLIPTextEncode", "KSampler", "VAEDecode", "EmptyLatentImage"],
    isGenerative: true,
    label: "文生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "I2I",
    description: "含重绘、风格迁移、denoising 重解释",
    fullName: "Image-to-Image",
    hints: ["VAEEncode", "LoadImage", "KSampler"],
    isGenerative: true,
    label: "图生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "TI2I",
    description: "少数节点联合驱动",
    fullName: "Text+Image-to-Image",
    isGenerative: true,
    label: "图文混合条件生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "R2I",
    description: "参考图作为主体参考（IP-Adapter / Bernini 等）",
    fullName: "Reference-to-Image",
    isGenerative: true,
    label: "参考图生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "E2I",
    description: "ControlNet 边缘控制",
    fullName: "Edge-to-Image",
    hints: ["ControlNetApply", "CannyEdgePreprocessor"],
    isGenerative: true,
    label: "边缘图生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "D2I",
    description: "深度图引导生成",
    fullName: "Depth-to-Image",
    hints: ["ControlNetApply", "DepthAnythingPreprocessor"],
    isGenerative: true,
    label: "深度图生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "P2I",
    description: "OpenPose 骨架点控制",
    fullName: "Pose-to-Image",
    hints: ["ControlNetApply", "OpenPosePreprocessor"],
    isGenerative: true,
    label: "姿态骨架生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "S2I",
    description: "手绘/线稿转精细图像",
    fullName: "Sketch-to-Image",
    hints: ["ControlNetApply", "LineArtPreprocessor"],
    isGenerative: true,
    label: "线稿生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "M2I",
    description: "Inpaint 底层，局部重绘",
    fullName: "Mask-to-Image",
    hints: ["VAEInpaint", "SetLatentNoiseMask"],
    isGenerative: true,
    label: "掩码生图",
    subCategory: "生成",
  },
  {
    category: "image",
    code: "Inpaint",
    description: "I2I 特例，带 mask 的局部重绘",
    fullName: "Inpaint",
    hints: ["VAEInpaint", "SetLatentNoiseMask"],
    isGenerative: false,
    label: "局部重绘",
    subCategory: "编辑",
  },
  {
    category: "image",
    code: "Outpaint",
    description: "I2V 特例，扩展 canvas 边界",
    fullName: "Outpaint",
    hints: ["LatentUpscale", "GrowMask"],
    isGenerative: false,
    label: "扩图",
    subCategory: "编辑",
  },
  {
    category: "image",
    code: "Upscale",
    description: "不是生成模式，是后处理（常和 T2I/I2I 串用）",
    fullName: "Upscale",
    hints: ["ImageUpscaleWithModel", "UpscaleModelLoader"],
    isGenerative: false,
    label: "超分放大",
    subCategory: "后处理",
  },
];

/* ── 视频侧（动态） ── */
export const VIDEO_WORKFLOW_TYPES: Array<WorkflowTypeDefinition> = [
  {
    category: "video",
    code: "T2V",
    description: "文生视频（Wan T2V / LTX T2V）",
    fullName: "Text-to-Video",
    isGenerative: true,
    label: "文生视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "I2V",
    description: "首帧锁定生成视频",
    fullName: "Image-to-Video",
    isGenerative: true,
    label: "单图生视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "TI2V",
    description: "Wan TI2V-5B 官方支持",
    fullName: "Text+Image-to-Video",
    isGenerative: true,
    label: "图文联合生视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "FLF2V",
    description: "Wan/LTX/Bernini 用（首尾帧只此一个 code，旧 FL2V 已归一至此）",
    fullName: "First-Last-Frame-to-Video",
    isGenerative: true,
    label: "首尾帧生视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "FMF2V",
    description: "DaSiWa 工作流新增",
    fullName: "First-Middle-Last-Frame-to-Video",
    isGenerative: true,
    label: "首中尾三帧生视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "V2V",
    description: "风格化/增强/编辑",
    fullName: "Video-to-Video",
    isGenerative: false,
    label: "视频生视频",
    subCategory: "编辑",
  },
  {
    category: "video",
    code: "R2V",
    description: "主体参考",
    fullName: "Reference-to-Video",
    isGenerative: true,
    label: "参考图生视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "RV2V",
    description: "",
    fullName: "Reference-Video-to-Video",
    isGenerative: false,
    label: "参考视频改视频",
    subCategory: "编辑",
  },
  {
    category: "video",
    code: "VI2V",
    description: "",
    fullName: "Video-Instruct-to-Video",
    isGenerative: false,
    label: "指令改视频",
    subCategory: "编辑",
  },
  {
    category: "video",
    code: "MV2V",
    description: "",
    fullName: "Mask-Video-to-Video",
    isGenerative: false,
    label: "遮罩改视频",
    subCategory: "编辑",
  },
  {
    category: "video",
    code: "VRC2V",
    description: "",
    fullName: "Video-Region-Control-to-Video",
    isGenerative: false,
    label: "区域动作微调",
    subCategory: "编辑",
  },
  {
    category: "video",
    code: "ADS2V",
    description: "",
    fullName: "Ad-Swap-to-Video",
    isGenerative: false,
    label: "广告植入改视频",
    subCategory: "编辑",
  },
  {
    category: "video",
    code: "S2V",
    description: "Wan S2V-14B, LTX IA2V 同类",
    fullName: "Speech/Audio-to-Video",
    isGenerative: true,
    label: "音频/语音驱生视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "IA2V",
    description: "LTX 官方",
    fullName: "Image+Audio-to-Video",
    isGenerative: true,
    label: "图+音频生唇形视频",
    subCategory: "生成",
  },
  {
    category: "video",
    code: "V2A",
    description: "反向任务",
    fullName: "Video-to-Audio",
    isGenerative: false,
    label: "生音频",
    subCategory: "后处理",
  },
  {
    category: "video",
    code: "A2V",
    description: "同 S2V，社区另一写法",
    fullName: "Audio-to-Video",
    isGenerative: true,
    label: "音生视频",
    subCategory: "生成",
  },
];

/* ── 音频 / 语音侧 ── */
export const AUDIO_WORKFLOW_TYPES: Array<WorkflowTypeDefinition> = [
  {
    category: "audio",
    code: "T2A",
    description: "",
    fullName: "Text-to-Audio",
    isGenerative: true,
    label: "文生音频/音效",
    subCategory: "生成",
  },
  {
    category: "audio",
    code: "T2M",
    description: "",
    fullName: "Text-to-Music",
    isGenerative: true,
    label: "文生音乐",
    subCategory: "生成",
  },
  {
    category: "audio",
    code: "T2S",
    description: "",
    fullName: "Text-to-Speech",
    isGenerative: true,
    label: "文生语音",
    subCategory: "生成",
  },
  {
    category: "audio",
    code: "S2S",
    description: "克隆/翻译",
    fullName: "Speech-to-Speech",
    isGenerative: false,
    label: "语音变语音",
    subCategory: "编辑",
  },
  {
    category: "audio",
    code: "A2A",
    description: "降噪/分离",
    fullName: "Audio-to-Audio",
    isGenerative: false,
    label: "音频转音频",
    subCategory: "后处理",
  },
  {
    category: "audio",
    code: "V2T",
    description: "caption",
    fullName: "Video-to-Text",
    isGenerative: false,
    label: "视频生描述",
    subCategory: "后处理",
  },
  {
    category: "audio",
    code: "I2T",
    description: "VLM 反向",
    fullName: "Image-to-Text",
    isGenerative: false,
    label: "图生文",
    subCategory: "后处理",
  },
];

/* ── 全量合并表 ── */
export const ALL_WORKFLOW_TYPES: Array<WorkflowTypeDefinition> = [
  ...IMAGE_WORKFLOW_TYPES,
  ...VIDEO_WORKFLOW_TYPES,
  ...AUDIO_WORKFLOW_TYPES,
];

/* ── 查找工具 ── */

/** 按 code 查找 */
export function getWorkflowType(code: string): WorkflowTypeDefinition | undefined {
  return ALL_WORKFLOW_TYPES.find((ALL_WORKFLOW_TYPES) => ALL_WORKFLOW_TYPES.code === code);
}

/** 按分类查找 */
export function getWorkflowTypesByCategory(cat: WorkflowCategory): Array<WorkflowTypeDefinition> {
  return ALL_WORKFLOW_TYPES.filter((ALL_WORKFLOW_TYPES) => ALL_WORKFLOW_TYPES.category === cat);
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
  if (!trimmed) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  return CODE_BY_LOWER.get(lower) ?? RETIRED_CODE_ALIASES.get(lower) ?? trimmed;
}

/** 一个工作流「当前生效的模式」—— 三处消费方（画布节点 / 工作流库 / 编辑器）
 *  必须得出同一个答案，否则会出现「库里显示单图生视频、卡片却说需要选模式」。
 *
 *  优先级：声明的 defaultMode（且必须仍在 modes 里）→ modes[0] → taskType。
 *  都为空 = 该工作流确实没有模式（此时才谈得上「未声明模式」）。 */
export function resolveWorkflowMode(args: {
  defaultMode?: string | null;
  modes?: ReadonlyArray<string> | null;
  taskType?: string | null;
}): string | null {
  const modes = (args.modes ?? []).filter(
    (mode): mode is string => typeof mode === "string" && mode.length > 0,
  );
  const declared = args.defaultMode;
  if (declared && (modes.length === 0 || modes.includes(declared))) {
    return declared;
  }
  const [firstMode] = modes;
  if (firstMode) {
    return firstMode;
  }
  if (typeof args.taskType === "string" && args.taskType) {
    return normalizeTaskType(args.taskType);
  }
  return null;
}

/* ── 多模式 JSON 编解码────────────────────────────
 * SQLite 没有标量数组列，故 WorkflowTemplate.modes 存为
 * JSON 字符串（与 Skill.tags 同构）。下面两个函数统一在「DB 列 ↔
 * TS 数组」之间转换，并在任何畸形输入下都安全降级为空数组 / 合法
 * JSON，绝不抛错（路由层吞异常比崩溃更安全）。 */
export function parseModesJson(raw: unknown): Array<string> {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === "string");
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const arr = /* SAFETY: 类型断言已复核 */ JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        return arr.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

export function serializeModesJson(modes: Array<string>): string {
  return JSON.stringify(Array.isArray(modes) ? modes : []);
}
