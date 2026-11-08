// Comfy-APP 模型库的「模型类型（目录）」元数据，集中在这里。
//
// 设计原则：**每个 ComfyUI 模型目录就是它自己独立的类型。**
// 某个目录在磁盘上的文件**只**属于该目录的类型 —— 从不存在
//「目录 X 的模型必须归到另一个类型」的情形。具体来说，数据库里
// `Model.type` 的值直接就是目录名原样（例如 "checkpoints"、"loras"、
// "adetailer"、"blip"）。这消除了过去那个疑惑：
//「adetailer 为什么被标成 Ultralytics / Checkpoint？」——
// 用户看到的标签**就是**目录名。
//
// SQLite 没有枚举，所以 `type` 是自由字符串；`ModelType` 只作为字符串别名
// 存在，纯为文档之用。

export type ModelType = string;

/* ── 「什么东西算模型」的判据（同步与目录清单共用，ISSUE #3368）──
 *
 * ComfyUI 的 `GET /api/models` 会把 custom_nodes 也列进目录清单（插件注册的目录
 * 与历史遗留都在里面），且 `/api/models/<folder>` 递归列出该目录下**所有**文件
 * —— 不过滤就会把插件仓库的 .py/.pyc/.json/README 当成模型收进库（#3368 现场：
 * 「Custom Nodes」一栏 220 个条目全是 x-flux-comfyui 的源码文件）。 */

/** ComfyUI 权重/模型文件的扩展名（小写、含点）：folder_paths 的 pt 扩展名，
 *  加上生态常见的 gguf / sft / onnx / tensorrt。 */
export const MODEL_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".safetensors",
  ".ckpt",
  ".pt",
  ".pth",
  ".bin",
  ".gguf",
  ".sft",
  ".onnx",
  ".engine",
  ".trt",
]);

/** 文件名按扩展名判是不是模型：取最后一段后缀、大小写不敏感（`X.FLUX.Py` 这类
 *  路径里后缀可能是路径段，`lastIndexOf` 取到的就是真后缀段）。 */
export function isModelFileName(fileName: string): boolean {
  const dot = fileName.lastIndexOf(".");
  return dot !== -1 && MODEL_FILE_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
}

/** 非「模型用途」的目录：custom_nodes 是节点代码目录（有自己的管理面板），
 *  它出现在 /api/models 里不代表库该把它当模型目录展示。 */
const NON_MODEL_FOLDERS: ReadonlySet<string> = new Set(["customnodes"]);

/** 目录名按用途判该不该出现在模型库（归一化后比对，覆盖 `custom_nodes` /
 *  `Custom Nodes` 等大小写与分隔符形态）。 */
export function isModelFolder(folder: string): boolean {
  return !NON_MODEL_FOLDERS.has(folder.toLowerCase().replaceAll(/[\s_-]+/g, ""));
}

/* 把目录名格式化成好看的显示名：下划线 / 连字符分隔 → 首字母大写。 */
export function prettyFolder(folder: string): string {
  return folder
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * 把 ComfyUI COMBO 控件的字段名映射到「其磁盘文件应并入画布下拉框」的目录名。
 * 因为每个目录就是它自己的类型，所以值**就是**目录名原样。
 *
 * 键是 ComfyUI 加载器里的规范字段名；数组列出这些字段真正读取的
 * `folder_paths` 目录。
 */
export const FIELD_TO_FOLDERS: Record<string, Array<string>> = {
  ckpt_name: ["checkpoints"],
  unet_name: ["unet", "diffusion_models"],
  vae_name: ["vae"],
  vae: ["vae"],
  clip_name: ["clip"],
  clip_name1: ["clip"],
  clip_name2: ["clip"],
  clip: ["clip"],
  clip_vision_name: ["clip_vision"],
  clip_vision: ["clip_vision"],
  text_encoders: ["text_encoders", "clip", "clip_vision"],
  lora_name: ["loras"],
  lora: ["loras"],
  control_net_name: ["controlnet"],
  control_net: ["controlnet"],
  controlnet: ["controlnet"],
  embedding: ["embeddings"],
  embeddings: ["embeddings"],
  upscale_model: ["upscale_models"],
  ipadapter_model_name: ["ipadapter"],
  ipadapter: ["ipadapter"],
  style_model_name: ["style_models"],
  hypernetwork_name: ["hypernetworks"],
  gligen_name: ["gligen"],
  gligen_model: ["gligen"],
  photomaker_model_name: ["photomaker"],
  photomaker: ["photomaker"],
  instantid_file: ["instantid"],
  instantid: ["instantid"],
  motion_model: ["animatediff_models", "animatediff_motion_lora"],
  motion_model_settings: ["animatediff_models", "animatediff_motion_lora"],
  insightface: ["insightface"],
  insightface_name: ["insightface"],
  sam_model: ["sam"],
  liveportrait: ["liveportrait"],
  liveportrait_path: ["liveportrait"],
  pose: ["pose"],
};

/**
 * 解析某个 COMBO 字段映射到哪些目录名：先精确查表，
 * 再不精确地按归一化后的子串兜底，好让变体字段名也能解析出来。
 * 返回目录名（它们**就是**模型类型）。
 */
export function modelFoldersForField(field: string): Array<string> {
  if (!field) {
    return [];
  }

  const exact = FIELD_TO_FOLDERS[field];

  if (exact) {
    return exact;
  }

  const lowerField = field.toLowerCase();

  const rules: Array<[RegExp, Array<string>]> = [
    [/ckpt/, ["checkpoints"]],

    [/unet|diffusion/, ["unet", "diffusion_models"]],

    [/vae/, ["vae"]],

    [/clip/, ["clip", "clip_vision", "text_encoders"]],

    [/lora/, ["loras"]],

    [/control/, ["controlnet"]],

    [/embed/, ["embeddings"]],

    [/upscale/, ["upscale_models"]],

    [/ipadapter/, ["ipadapter"]],

    [/style/, ["style_models"]],

    [/hyper/, ["hypernetworks"]],

    [/gligen/, ["gligen"]],

    [/photomaker/, ["photomaker"]],

    [/instantid/, ["instantid"]],

    [/animatediff|motion_model/, ["animatediff_models", "animatediff_motion_lora"]],

    [/insightface/, ["insightface"]],

    [/sam/, ["sam"]],

    [/liveportrait/, ["liveportrait"]],

    [/pose/, ["pose"]],

    [/\bmodel\b/, ["checkpoints"]],
  ];

  for (const [re, folders] of rules) {
    if (re.test(lowerField)) {
      return folders;
    }
  }

  return [];
}

/* 为常见 ComfyUI 目录手工整理的展示元数据。 */
const FOLDER_META: Record<string, { color: string; label: string }> = {
  checkpoints: {
    label: "Checkpoint",
    color: "text-violet-700 dark:text-violet-300 bg-violet-500/15",
  },
  loras: {
    label: "LoRA",
    color: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15",
  },
  vae: { label: "VAE", color: "text-sky-700 dark:text-sky-300 bg-sky-500/15" },
  clip: {
    label: "CLIP",
    color: "text-teal-700 dark:text-teal-300 bg-teal-500/15",
  },
  clip_vision: {
    label: "CLIP Vision",
    color: "text-teal-700 dark:text-teal-300 bg-teal-500/15",
  },
  text_encoders: {
    label: "Text Encoder",
    color: "text-teal-700 dark:text-teal-300 bg-teal-500/15",
  },
  unet: {
    label: "UNet",
    color: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/15",
  },
  diffusion_models: {
    label: "Diffusion Models",
    color: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/15",
  },
  diffusers: {
    label: "Diffusers",
    color: "text-indigo-700 dark:text-indigo-300 bg-indigo-500/15",
  },
  controlnet: {
    label: "ControlNet",
    color: "text-amber-700 dark:text-amber-300 bg-amber-500/15",
  },
  embeddings: { label: "Embedding", color: "text-pink-600 bg-pink-500/15" },
  upscale_models: {
    label: "Upscale",
    color: "text-rose-700 dark:text-rose-300 bg-rose-500/15",
  },
  ipadapter: {
    label: "IP-Adapter",
    color: "text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-500/15",
  },
  style_models: {
    label: "Style",
    color: "text-orange-700 dark:text-orange-300 bg-orange-500/15",
  },
  hypernetworks: {
    label: "Hypernetwork",
    color: "text-lime-600 bg-lime-500/15",
  },
  gligen: {
    label: "GLIGEN",
    color: "text-purple-700 dark:text-purple-300 bg-purple-500/15",
  },
  photomaker: {
    label: "PhotoMaker",
    color: "text-orange-700 dark:text-orange-300 bg-orange-500/15",
  },
  instantid: {
    label: "InstantID",
    color: "text-orange-700 dark:text-orange-300 bg-orange-500/15",
  },
  animatediff_models: {
    label: "AnimateDiff",
    color: "text-blue-700 dark:text-blue-300 bg-blue-500/15",
  },
  animatediff_motion_lora: {
    label: "AnimateDiff LoRA",
    color: "text-blue-700 dark:text-blue-300 bg-blue-500/15",
  },
  insightface: {
    label: "InsightFace",
    color: "text-red-700 dark:text-red-300 bg-red-500/15",
  },
  ultralytics: {
    label: "Ultralytics",
    color: "text-red-700 dark:text-red-300 bg-red-500/15",
  },
  sam: { label: "SAM", color: "text-red-700 dark:text-red-300 bg-red-500/15" },
  liveportrait: {
    label: "LivePortrait",
    color: "text-yellow-700 dark:text-yellow-300 bg-yellow-500/15",
  },
  pose: {
    label: "Pose",
    color: "text-slate-700 dark:text-slate-300 bg-slate-500/15",
  },
  adetailer: {
    label: "ADetailer",
    color: "text-red-700 dark:text-red-300 bg-red-500/15",
  },
  blip: {
    label: "BLIP",
    color: "text-teal-700 dark:text-teal-300 bg-teal-500/15",
  },
  background_removal: {
    label: "Background Removal",
    color: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/15",
  },
};

/* 非空数组：模运算取下标时用 `.at()`，缺席有兜底项（见 `folderMeta`）。 */
const FALLBACK_PALETTE: [string, ...Array<string>] = [
  "text-violet-700 dark:text-violet-300 bg-violet-500/15",
  "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15",
  "text-sky-700 dark:text-sky-300 bg-sky-500/15",
  "text-amber-700 dark:text-amber-300 bg-amber-500/15",
  "text-pink-600 bg-pink-500/15",
  "text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-500/15",
  "text-cyan-700 dark:text-cyan-300 bg-cyan-500/15",
  "text-blue-700 dark:text-blue-300 bg-blue-500/15",
  "text-rose-700 dark:text-rose-300 bg-rose-500/15",
  "text-teal-700 dark:text-teal-300 bg-teal-500/15",
];

function hashString(s: string): number {
  let hash = 0;

  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }

  return Math.abs(hash);
}

/* 某个目录名的展示元数据（手工整理的标签 / 配色，或推导得出）。 */
export function folderMeta(folder: string): { color: string; label: string } {
  const curated = FOLDER_META[folder];
  if (curated) {
    return curated;
  }
  return {
    label: prettyFolder(folder),
    color: FALLBACK_PALETTE.at(hashString(folder) % FALLBACK_PALETTE.length) ?? FALLBACK_PALETTE[0],
  };
}
