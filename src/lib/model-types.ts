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

/* 把目录名格式化成好看的显示名：下划线 / 连字符分隔 → 首字母大写。 */
export function prettyFolder(folder: string): string {
  return folder
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * 把 ComfyUI COMBO 控件的字段名映射到「其磁盘文件应并入画布下拉框」的目录名。
 * 因为每个目录就是它自己的类型，所以值**就是**目录名原样。
 *
 * 键是 ComfyUI 加载器里的规范字段名；数组列出这些字段真正读取的
 * `folder_paths` 目录。
 */
export const FIELD_TO_FOLDERS: Record<string, string[]> = {
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

/* 反向映射：目录名 → 从它读取的字段名（用于提示气泡）。 */
const FOLDER_TO_FIELDS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const [field, folders] of Object.entries(FIELD_TO_FOLDERS)) {
    for (const f of folders) (m[f] ??= []).push(field);
  }
  return m;
})();

/**
 * 解析某个 COMBO 字段映射到哪些目录名：先精确查表，
 * 再不精确地按归一化后的子串兜底，好让变体字段名也能解析出来。
 * 返回目录名（它们**就是**模型类型）。
 */
export function modelFoldersForField(field: string): string[] {
  if (!field) return [];

  const exact = FIELD_TO_FOLDERS[field];

  if (exact) return exact;

  const lowerField = field.toLowerCase();

  const rules: [RegExp, string[]][] = [
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

    [
      /animatediff|motion_model/,
      ["animatediff_models", "animatediff_motion_lora"],
    ],

    [/insightface/, ["insightface"]],

    [/sam/, ["sam"]],

    [/liveportrait/, ["liveportrait"]],

    [/pose/, ["pose"]],

    [/\bmodel\b/, ["checkpoints"]],
  ];

  for (const [re, folders] of rules) {
    if (re.test(lowerField)) return folders;
  }

  return [];
}

/* 为常见 ComfyUI 目录手工整理的展示元数据。 */
const FOLDER_META: Record<string, { label: string; color: string }> = {
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

const FALLBACK_PALETTE = [
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

  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;

  return Math.abs(hash);
}

/* 某个目录名的展示元数据（手工整理的标签 / 配色，或推导得出）。 */
export function folderMeta(folder: string): { label: string; color: string } {
  const curated = FOLDER_META[folder];
  if (curated) return curated;
  return {
    label: prettyFolder(folder),
    color: FALLBACK_PALETTE[hashString(folder) % FALLBACK_PALETTE.length]!,
  };
}

/**
 * 目录类型「药丸」标签的提示气泡。它解释这条原则：
 * 目录名**就是**类型 —— 该目录的模型绝不会归到另一个类型 ——
 * 以及哪些画布 COMBO 字段会列出该目录下的文件。
 */
export function getFolderTooltip(folder: string): string {
  const fields = FOLDER_TO_FIELDS[folder] ?? [];
  const firstFields = fields.slice(0, 4).join(" / ");
  const more = fields.length > 4 ? ` 等 ${fields.length} 个` : "";
  const fieldHint =
    fields.length > 0
      ? `同步后，画布上 ${firstFields}${more} 字段的 COMBO 下拉会列出此目录的文件。`
      : "此目录当前没有对应画布 COMBO 字段。";
  return `目录 "${folder}" 本身就是一个独立的模型类型，其下的模型只归属该目录，不会被归类到其他类型。${fieldHint}`;
}
