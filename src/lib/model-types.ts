// Centralized model-type (directory) metadata for the Comfy-APP model library.
//
// Design principle: **each ComfyUI model directory IS its own
// independent type.**  A directory's on-disk files belong ONLY to that
// directory's type — there is never a case where directory X's models must be
// attributed to another type.  Concretely, the `Model.type` value stored in
// the database is simply the directory name verbatim (e.g. "checkpoints",
// "loras", "adetailer", "blip").  This removes the old "why is adetailer
// labelled Ultralytics / Checkpoint?" confusion: the label the user sees IS
// the directory name.
//
// SQLite has no enums, so `type` is a free String; we keep `ModelType` as a
// string alias purely for documentation.

export type ModelType = string;

/** Pretty-print a directory name: snake / kebab → Title Case. */
export function prettyFolder(folder: string): string {
  return folder
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * Map a ComfyUI COMBO widget field name to the directory name(s) whose
 * on-disk files should be unioned into the canvas dropdown.  Because each
 * directory is its own type, the value IS the directory name verbatim.
 *
 * The keys are the canonical ComfyUI loader field names; the arrays list the
 * real `folder_paths` directories those fields read from.
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

/** Reverse map: directory name → field names that read from it (for tooltips). */
const FOLDER_TO_FIELDS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const [field, folders] of Object.entries(FIELD_TO_FOLDERS)) {
    for (const f of folders) (m[f] ??= []).push(field);
  }
  return m;
})();

/**
 * Resolve which directory name(s) a COMBO field maps to: exact lookup first,
 * then a normalized substring fallback so variant field names still resolve.
 * Returns directory names (which ARE the model types).
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

    [/animatediff|motion_model/, ["animatediff_models", "animatediff_motion_lora"]],

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


/** Curated display metadata for the well-known ComfyUI directories. */
const FOLDER_META: Record<string, { label: string; color: string }> = {
  checkpoints: { label: "Checkpoint", color: "text-violet-700 dark:text-violet-300 bg-violet-500/15" },
  loras: { label: "LoRA", color: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/15" },
  vae: { label: "VAE", color: "text-sky-700 dark:text-sky-300 bg-sky-500/15" },
  clip: { label: "CLIP", color: "text-teal-700 dark:text-teal-300 bg-teal-500/15" },
  clip_vision: { label: "CLIP Vision", color: "text-teal-700 dark:text-teal-300 bg-teal-500/15" },
  text_encoders: { label: "Text Encoder", color: "text-teal-700 dark:text-teal-300 bg-teal-500/15" },
  unet: { label: "UNet", color: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/15" },
  diffusion_models: { label: "Diffusion Models", color: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/15" },
  diffusers: { label: "Diffusers", color: "text-indigo-700 dark:text-indigo-300 bg-indigo-500/15" },
  controlnet: { label: "ControlNet", color: "text-amber-700 dark:text-amber-300 bg-amber-500/15" },
  embeddings: { label: "Embedding", color: "text-pink-600 bg-pink-500/15" },
  upscale_models: { label: "Upscale", color: "text-rose-700 dark:text-rose-300 bg-rose-500/15" },
  ipadapter: { label: "IP-Adapter", color: "text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-500/15" },
  style_models: { label: "Style", color: "text-orange-700 dark:text-orange-300 bg-orange-500/15" },
  hypernetworks: { label: "Hypernetwork", color: "text-lime-600 bg-lime-500/15" },
  gligen: { label: "GLIGEN", color: "text-purple-700 dark:text-purple-300 bg-purple-500/15" },
  photomaker: { label: "PhotoMaker", color: "text-orange-700 dark:text-orange-300 bg-orange-500/15" },
  instantid: { label: "InstantID", color: "text-orange-700 dark:text-orange-300 bg-orange-500/15" },
  animatediff_models: { label: "AnimateDiff", color: "text-blue-700 dark:text-blue-300 bg-blue-500/15" },
  animatediff_motion_lora: { label: "AnimateDiff LoRA", color: "text-blue-700 dark:text-blue-300 bg-blue-500/15" },
  insightface: { label: "InsightFace", color: "text-red-700 dark:text-red-300 bg-red-500/15" },
  ultralytics: { label: "Ultralytics", color: "text-red-700 dark:text-red-300 bg-red-500/15" },
  sam: { label: "SAM", color: "text-red-700 dark:text-red-300 bg-red-500/15" },
  liveportrait: { label: "LivePortrait", color: "text-yellow-700 dark:text-yellow-300 bg-yellow-500/15" },
  pose: { label: "Pose", color: "text-slate-700 dark:text-slate-300 bg-slate-500/15" },
  adetailer: { label: "ADetailer", color: "text-red-700 dark:text-red-300 bg-red-500/15" },
  blip: { label: "BLIP", color: "text-teal-700 dark:text-teal-300 bg-teal-500/15" },
  background_removal: { label: "Background Removal", color: "text-cyan-700 dark:text-cyan-300 bg-cyan-500/15" },
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


/** Display metadata for a directory name (curated label / color or derived). */
export function folderMeta(folder: string): { label: string; color: string } {
  const curated = FOLDER_META[folder];
  if (curated) return curated;
  return {
    label: prettyFolder(folder),
    color: FALLBACK_PALETTE[hashString(folder) % FALLBACK_PALETTE.length]!,
  };
}

/**
 * Tooltip for a directory's type pill. Explains the principle:
 * the directory name IS the type — its models are never attributed to another
 * type — and which canvas COMBO fields will list this directory's files.
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
