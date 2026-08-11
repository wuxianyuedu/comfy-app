/* ComfyUI port type system — port colors, labels, and inference helpers.
 *
 * The colour and naming scheme is taken from ComfyUI's own litegraph.js
 * `LGraphCanvas.link_colors` and `node-type` display strings.  We use it to
 * colour every connection dot and edge the same way the official frontend
 * does so our flow canvas reads as a faithful 1:1 reproduction.
 *
 * Use the helpers exported here in two places:
 *   1. `WorkflowCanvasEditor` — to colour the per-row port dots, the
 *      `← <srcTitle>` label, and the edges.
 *   2. Future: linting / validation when a user tries to wire incompatible
 *      types together.
 */

/* ── Port colour per data type (matches ComfyUI's litegraph palette) ── */
export const PORT_COLORS: Record<string, string> = {
  MODEL:         "#7C5CFF",
  CONDITIONING:  "#FF6B6B",
  LATENT:        "#9B59FF",
  IMAGE:         "#3FBF7F",
  VAE:           "#FFA15C",
  CLIP:          "#FFD93D",
  CONTROL_NET:   "#3F8FDF",
  MASK:          "#1F9F1F",
  STYLE_MODEL:   "#C7A93D",
  UPSCALE_MODEL: "#236C36",
  SAM_MODEL:     "#A93D3D",
  GLIGEN:        "#FF6B6B",
  AUDIO:         "#A93D3D",
  VOICE:         "#A93D3D",
  MOTION_DATA:   "#1F77B4",
  MESH:          "#1F77B4",
  POSE:          "#1F77B4",
  BBOX:          "#A93D3D",
  SEGS:          "#A93D3D",
  INT:           "#3CA018",
  FLOAT:         "#3CA018",
  NUMBER:        "#3CA018",
  STRING:        "#3CA018",
  COMBO:         "#3CA018",
  BOOLEAN:       "#3CA018",
  /* fallback: muted gray */
  UNKNOWN:       "#7C7C8A",
};

export const DEFAULT_PORT_COLOR = "#7C7C8A";

/** Look up a port colour; falls back to the default. */
export function portColor(type: string | undefined | null): string {
  if (!type) return DEFAULT_PORT_COLOR;
  return PORT_COLORS[type] ?? DEFAULT_PORT_COLOR;
}

/** Look up the right-side type label.
 *
 *  Per the 2026-08-04 pass the type column is now driven by the raw data
 *  itself: `portLabel(t)` returns the raw type string verbatim so users
 *  always see what ComfyUI itself reports (e.g. `COMBO` / `STRING` /
 *  `INT` / `SIGMAS`), preserving variable-name casing exactly.  An
 *  earlier Chinese-translation map was removed because it caused every
 *  COMBO row to read "枚举" — collapsing all six option-types of a
 *  DaSiWa / KJNodes node into one identical-looking tag.
 *
 *  Defensive: caller-side fall-backs (`portLabel(t) || t`) still recover
 *  gracefully when this returns an empty string for an unknown type. */
export function portLabel(type: string | undefined | null): string {
  if (!type) return "";
  return String(type).trim();
}

/* ── Per-class output types.  ComfyUI's API exposes these via
 *    /object_info, but for the canvas we only need the output *order*
 *    per slot, which is the most-stable property of a node class.  When
 *    the live /object_info is unavailable, this static fallback lets us
 *    still colour edges correctly. */
const OUTPUT_TYPES: Record<string, string[]> = {
  /* Loaders */
  CheckpointLoaderSimple:          ["MODEL", "CLIP", "VAE"],
  CheckpointLoader:                ["MODEL", "CLIP", "VAE"],
  UNETLoader:                      ["MODEL"],
  UNetLoader:                      ["MODEL"],
  CLIPLoader:                      ["CLIP"],
  DualCLIPLoader:                  ["CLIP", "CLIP"],
  TripleCLIPLoader:                ["CLIP", "CLIP", "CLIP"],
  VAELoader:                       ["VAE"],
  ControlNetLoader:                ["CONTROL_NET"],
  DiffControlNetLoader:            ["CONTROL_NET"],
  StyleModelLoader:                ["STYLE_MODEL"],
  GLIGENLoader:                    ["GLIGEN"],
  UpscaleModelLoader:              ["UPSCALE_MODEL"],
  LoraLoader:                      ["MODEL", "CLIP"],
  LoraLoaderModelOnly:             ["MODEL"],
  LoRAStacker:                     ["MODEL"],
  HypernetworkLoader:              ["MODEL"],
  /* Samplers */
  KSampler:                        ["LATENT"],
  KSamplerAdvanced:                ["LATENT"],
  KSamplerSelect:                  ["LATENT"],
  SamplerCustom:                   ["LATENT", "VAE"],
  SamplerCustomAdvanced:           ["LATENT", "VAE"],
  SamplerDpmppEulerAncestralCFG:   ["LATENT"],
  /* Latent */
  EmptyLatentImage:                ["LATENT"],
  EmptyLatentAudio:                ["AUDIO"],
  EmptyImage:                      ["IMAGE"],
  VAEDecode:                       ["IMAGE"],
  VAEDecodeTiled:                  ["IMAGE"],
  VAEEncode:                       ["LATENT"],
  VAEEncodeTiled:                  ["LATENT"],
  VAEEncodeForInpaint:             ["LATENT"],
  LatentRotate:                    ["LATENT"],
  LatentFlip:                      ["LATENT"],
  LatentComposite:                 ["LATENT"],
  LatentCompositeMasked:           ["LATENT"],
  SetLatentNoiseMask:              ["LATENT"],
  LatentCrop:                      ["LATENT"],
  LatentBlend:                     ["LATENT"],
  LatentFromBatch:                 ["LATENT"],
  RepeatLatentBatch:               ["LATENT"],
  LatentBatch:                     ["LATENT"],
  LatentInterpolate:               ["LATENT"],
  LatentUpfactor:                  ["LATENT"],
  LatentUpscale:                   ["LATENT"],
  LatentUpscaleBy:                 ["LATENT"],
  /* Image */
  LoadImage:                       ["IMAGE", "MASK"],
  LoadImageMask:                   ["IMAGE", "MASK"],
  SaveImage:                       [],
  PreviewImage:                    [],
  ImageScale:                      ["IMAGE"],
  ImageScaleBy:                    ["IMAGE"],
  ImageScaleToTotalPixels:         ["IMAGE"],
  ImageUpscaleWithModel:           ["IMAGE"],
  ImageBatch:                      ["IMAGE"],
  ImageRepeat:                     ["IMAGE"],
  ImageFromBatch:                  ["IMAGE"],
  ImagePadForOutpaint:             ["IMAGE", "MASK"],
  ImageComposite:                  ["IMAGE"],
  ImageCompositeMasked:            ["IMAGE"],
  ImageBlend:                      ["IMAGE"],
  ImageInvert:                     ["IMAGE"],
  ImageRGBToYUV:                   ["IMAGE", "MASK"],
  ImageYUVToRGB:                   ["IMAGE"],
  ImageColorToMask:                ["MASK"],
  ImageColorToMaskV2:              ["MASK"],
  ImageMaskToImage:                ["IMAGE"],
  ImageToMask:                     ["MASK"],
  MaskToImage:                     ["IMAGE"],
  SolidMask:                       ["MASK"],
  InvertMask:                      ["MASK"],
  CropMask:                        ["MASK"],
  MaskComposite:                   ["MASK"],
  FeatherMask:                     ["MASK"],
  GrowMask:                        ["MASK"],
  ThresholdMask:                   ["MASK"],
  /* Conditioning */
  CLIPTextEncode:                  ["CONDITIONING"],
  CLIPTextEncodeSDXL:              ["CONDITIONING", "CONDITIONING"],
  CLIPTextEncodeSDXLRefiner:       ["CONDITIONING"],
  ConditioningCombine:             ["CONDITIONING"],
  ConditioningAverage:             ["CONDITIONING"],
  ConditioningConcat:              ["CONDITIONING"],
  ConditioningSetArea:             ["CONDITIONING"],
  ConditioningSetAreaStrength:     ["CONDITIONING"],
  ConditioningSetMask:             ["CONDITIONING"],
  ControlNetApply:                 ["CONDITIONING"],
  ControlNetApplyAdvanced:         ["CONDITIONING", "CONDITIONING"],
  ApplyStyleModel:                 ["CONDITIONING"],
  ApplyControlNet:                 ["CONDITIONING"],
  /* Misc */
  ConditioningZeroOut:             ["CONDITIONING"],
  ConditioningTimestepRange:       ["CONDITIONING"],
  /* Audio (some ComfyUI audio extensions) */
  VAEDecodeAudio:                  ["AUDIO"],
  SaveAudio:                       [],
  LoadAudio:                       ["AUDIO"],
  /* Wan / I2V / T2V  ── typical WanVideoWrapper node names */
  WanVideoSampler:                 ["LATENT"],
  WanVideoDecode:                  ["IMAGE"],
  WanVideoImageToVideoEncode:      ["LATENT"],
  WanVideoTextEncode:              ["CONDITIONING"],
  WanVideoModelLoader:             ["MODEL", "CLIP", "VAE"],
  WanVideoT5TextEncode:            ["CONDITIONING"],
};

/** Get the data type produced by a class's nth output slot. */
export function inferOutputType(classType: string, slot: number): string {
  const types = OUTPUT_TYPES[classType];
  if (types && slot >= 0 && slot < types.length) return types[slot];
  /* Heuristic fallback for custom nodes the static table doesn't list
   *  (EmptySD3LatentImage, ModelSamplingAuraFlow, ResolutionSelector, …).
   *  Match on the class name itself, which is highly stable across
   *  ComfyUI's wild ecosystem of community nodes. */
  const c = classType.toLowerCase();
  if (slot === 0) {
    if (c.startsWith("empty") && c.includes("latent")) return "LATENT";
    if (c.startsWith("empty") && c.includes("image")) return "IMAGE";
    if (c.startsWith("empty") && c.includes("audio")) return "AUDIO";
    if (c.startsWith("empty")) return "LATENT";
    if (c.includes("modelsampling") || c.includes("modelloader") ||
        c.includes("patchmodel") || c.includes("ipadapter") ||
        c.includes("rescalemodel") || c.includes("modelsubpatch") ||
        c === "modelmerge" || c.startsWith("modelload") ||
        c.startsWith("modelsamp"))
      return "MODEL";
    if (c.includes("dualclip") || c.includes("tripleclip")) return "CLIP";
    if (c.includes("clip") && !c.includes("textencode") && !c.includes("applyclip")) return "CLIP";
    if (c.includes("vae") && c.includes("decode")) return "IMAGE";
    if (c.includes("vae") && c.includes("encode")) return "LATENT";
    if (c.includes("vae")) return "VAE";
    if ((c.includes("controlnet") || c.includes("applycontrol")) && c.includes("apply")) return "CONDITIONING";
    if (c.includes("controlnet")) return "CONTROL_NET";
    if (c.includes("upscale") && c.includes("model")) return "UPSCALE_MODEL";
    if (c.includes("upscale")) return "IMAGE";
    if (c.includes("style") && c.includes("model")) return "STYLE_MODEL";
    if (c.includes("style") && c.includes("apply")) return "CONDITIONING";
    if (c.includes("ksampler") || (c.includes("sampler") && !c.includes("custom"))) return "LATENT";
    if (c.includes("textencode") || c.includes("conditioning")) return "CONDITIONING";
    if (c.includes("loadimage") || c.includes("loadmask")) return "IMAGE";
    if (c.includes("imagescale") || c.includes("imagebatch") || c.includes("imagecomposite") || c.startsWith("image")) return "IMAGE";
    if (c.includes("latent")) return "LATENT";
    if (c.includes("audio") || c.includes("sound")) return "AUDIO";
  }
  return "UNKNOWN";
}

/* ── Per-class *input* type table.  This is a small but high-signal
 *    lookup for the most-used nodes; fall through to heuristic
 *    `inferInputTypeByName` for everything else. */
const INPUT_TYPES: Record<string, Record<string, string>> = {
  KSampler: {
    model:        "MODEL",
    positive:     "CONDITIONING",
    negative:     "CONDITIONING",
    latent_image: "LATENT",
    seed:         "INT",
    steps:        "INT",
    cfg:          "FLOAT",
    denoise:      "FLOAT",
    sampler_name: "COMBO",
    scheduler:    "COMBO",
    control:      "CONTROL_NET",
  },
  KSamplerAdvanced: {
    model:        "MODEL",
    positive:     "CONDITIONING",
    negative:     "CONDITIONING",
    latent_image: "LATENT",
  },
  CLIPTextEncode: {
    clip: "CLIP",
    text: "STRING",
  },
  CLIPTextEncodeSDXL: {
    clip_g:    "CLIP",
    clip_l:    "CLIP",
    width:     "INT",
    height:    "INT",
    text_g:    "STRING",
    text_l:    "STRING",
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
    type:      "COMBO",
  },
  DualCLIPLoader: {
    clip_name1:  "COMBO",
    clip_name2:  "COMBO",
    type:        "COMBO",
  },
  VAELoader: {
    vae_name: "COMBO",
  },
  ControlNetLoader: {
    control_net_name: "COMBO",
  },
  VAEDecode: {
    samples: "LATENT",
    vae:     "VAE",
  },
  VAEEncode: {
    pixels: "IMAGE",
    vae:    "VAE",
  },
  EmptyLatentImage: {
    width:      "INT",
    height:     "INT",
    batch_size: "INT",
  },
  LoadImage: {
    image:     "COMBO",
    upload:    "IMAGE",
  },
  SaveImage: {
    filename_prefix: "STRING",
    images:          "IMAGE",
  },
  LoraLoader: {
    model:           "MODEL",
    clip:            "CLIP",
    lora_name:       "COMBO",
    strength_model:  "FLOAT",
    strength_clip:   "FLOAT",
  },
  ControlNetApply: {
    conditioning:    "CONDITIONING",
    control_net:     "CONTROL_NET",
    image:           "IMAGE",
    strength:        "FLOAT",
  },
  ConditioningCombine: {
    conditioning_1: "CONDITIONING",
    conditioning_2: "CONDITIONING",
  },
  ConditioningAverage: {
    conditioning_to:  "CONDITIONING",
    conditioning_from: "CONDITIONING",
    conditioning_to_strength: "FLOAT",
  },
  ImageScale: {
    image:      "IMAGE",
    upscale_method: "COMBO",
    width:      "INT",
    height:     "INT",
    crop:       "COMBO",
  },
  ImageUpscaleWithModel: {
    upscale_model: "UPSCALE_MODEL",
    image:         "IMAGE",
  },
  LatentUpscale: {
    samples:     "LATENT",
    upscale_method: "COMBO",
    width:       "INT",
    height:      "INT",
    crop:        "COMBO",
  },
  SetLatentNoiseMask: {
    samples: "LATENT",
    mask:    "MASK",
  },
};

/** Determine the data type of an input slot on a class.  Falls back to a
 *  heuristic over the input name.  Returns "UNKNOWN" if we really can't
 *  tell — the renderer shows a generic gray dot in that case. */
export function inferInputType(
  classType: string,
  inputName: string,
  value?: any
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

/** Heuristic over the input name alone. */
export function inferInputTypeByName(name: string): string {
  const n = name.toLowerCase();
  if (n === "model" || n.includes("model")) return "MODEL";
  if (n === "clip" || n === "clip_g" || n === "clip_l" || n === "clip_name") return "CLIP";
  if (n === "vae" || n === "vae_name") return "VAE";
  if (n === "positive" || n === "negative" || n === "conditioning" || n.startsWith("cond")) return "CONDITIONING";
  if (n === "latent" || n === "latent_image" || n === "samples" || n.endsWith("_latent")) return "LATENT";
  if (n === "image" || n === "images" || n === "pixels" || n === "output_image") return "IMAGE";
  if (n === "mask" || n.endsWith("_mask")) return "MASK";
  if (n === "control_net" || n.endsWith("_controlnet")) return "CONTROL_NET";
  if (n === "upscale_model" || n === "model_name") return "UPSCALE_MODEL";
  if (n === "audio" || n === "waveform") return "AUDIO";
  /* Widget types by suffix */
  if (n === "seed") return "INT";
  if (n === "steps" || n === "step") return "INT";
  if (n === "cfg" || n === "denoise" || n === "strength" || n === "scale" || n.includes("strength")) return "FLOAT";
  if (n === "width" || n === "height" || n === "batch_size" || n.endsWith("_size") || n.endsWith("_count")) return "INT";
  if (n === "sampler_name" || n === "scheduler" || n === "method" || n.endsWith("_method")) return "COMBO";
  if (n.endsWith("_name") || n === "filename_prefix" || n === "ckpt_name") return "COMBO";
  if (n === "text" || n.endsWith("_text") || n === "prompt" || n === "negative_prompt") return "STRING";
  if (n === "noise_mask" || n === "return_with_leftover_noise") return "COMBO";
  if (n === "start_at_step" || n === "end_at_step" || n === "return_with_leftover_noise") return "COMBO";
  return "UNKNOWN";
}

/* ── Multiline STRING detection (2026-08-10 R18) ────────────────────────────
 *
 *  ComfyUI's native STRING widget is rendered as a textarea (multiline) when
 *  the upstream Python `INPUT_TYPES()` for the node sets `multiline: True`
 *  on that input.  Examples:
 *
 *      "text":      (IO.STRING, {"multiline": True, "dynamic_prompts": True})
 *      "text_g":    (IO.STRING, {"multiline": True})
 *      "filename_prefix": ("STRING", {"default": "ComfyUI"})   ← single line
 *
 *  The frontend widget renderer reads this flag from `node.widgets[i].config
 *  .multiline` — but our project's saved rawJson is almost always API format
 *  (the user is required to "Save (API Format)" so the workflow remains
 *  usable), and API format drops `widgets[]` / `inputs[]`, so the flag
 *  arrives at us as nothing.
 *
 *  Curate layer mitigation (route.ts:400, MULTILINE_HINT) only fills the
 *  workflowIO enrichment key — it never reaches the WfNode / WfSubgraphNode
 *  widgetEntries renderer, which is what users actually see when the canvas
 *  zooms into a workflow.  So we backfill here:
 *
 *    1.  Static known-multi map  (hand-curated for ComfyUI's own nodes)
 *    2.  Excluded single-line list (filename_prefix etc. — look like text
 *        inputs but are short labels, not prompts)
 *    3.  Name heuristic  (mirrors MULTILINE_HINT in route.ts so workflowIO
 *        and widgetEntries agree)
 *    4.  Length heuristic (long strings clearly meant to be paragraphs)
 *
 *  Returns true when the input should render as a textarea.  Consumers:
 *    • WfNode  — `isStringWidget` (canvas-edit widget section)
 *    • WfSubgraphNode  — same (subgraph wrapper inputs)
 *    • Already wired up in DynamicWorkflowForm via `controlForEntry`'s
 *      workflowIO.multiline field — we keep this helper as the source of
 *      truth so both paths converge.
 */
const MULTILINE_INPUTS: Record<string, Set<string>> = {
  CLIPTextEncode: new Set(["text"]),
  CLIPTextEncodeSDXL: new Set(["text_g", "text_l"]),
  CLIPTextEncodeSDXLRefiner: new Set(["text", "text_1"]),
  // rgthree / common custom packs that ship textbook multiline prompt inputs.
  "Power Lora Loader (rgthree)": new Set(["model_str", "lora_str"]),
  // Anything added here MUST be ComfyUI's own node input — never a custom
  // pack whose field names change every release.
};

/** ComfyUI STRING inputs that LOOK like text but stay single-line in the
 *  native UI.  Excluded explicitly so the name heuristic below never
 *  wrongly upgrades them. */
const SINGLE_LINE_NAMES: Set<string> = new Set([
  "filename_prefix",
  "ckpt_name",
  "model_name",
  "lora_name",
]);

/** Mirror of route.ts:400 — kept in sync so DynamicWorkflowForm (workflowIO
 *  path) and WfNode widgetEntries agree on what counts as a prompt. */
const MULTILINE_NAME_HINT = /(prompt|text|caption|描述|提示)/i;

export function inferIsMultiline(
  classType: string | undefined,
  name: string,
  defaultValue?: unknown
): boolean {
  /* Single-line exclusion first — `filename_prefix` is a STRING but
   * ComfyUI renders it as a one-line input.  Beats both the static table
   * and the name heuristic. */
  if (SINGLE_LINE_NAMES.has(name)) return false;

  /* 1. Static known-multi map. */
  if (classType && MULTILINE_INPUTS[classType]?.has(name)) return true;

  /* 3. Name heuristic — covers custom nodes whose (classType, name) we
   *    don't statically know, but whose label / name reads as text. */
  if (MULTILINE_NAME_HINT.test(name)) return true;

  /* 4. Length heuristic — a long current default is a strong signal this
   *    slot is used as a paragraph rather than a label.  Mirrors the R6
   *    threshold in `controlForEntry` (> 40 chars). */
  if (typeof defaultValue === "string" && defaultValue.length > 40) return true;

  return false;
}

/** Given a connection target, return the *output* type that the source
 *  supplies, by combining class + slot.  Used for colouring edges and the
 *  small type label on the right side of a connection row. */
export function edgeType(
  srcClass: string | undefined,
  srcSlot: number
): string {
  if (!srcClass) return "UNKNOWN";
  return inferOutputType(srcClass, srcSlot);
}

/** Same as `edgeType` but the value-style fallback: when source class
 *  is unknown, infer from the input *name* the wire is feeding into. */
export function edgeTypeByInputName(name: string): string {
  return inferInputTypeByName(name);
}
