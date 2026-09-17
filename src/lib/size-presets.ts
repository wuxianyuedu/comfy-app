/* ── 尺寸预设表（比例 × 分辨率 / 比例 + 百万像素 + 倍数）──
 *
 * 项目里所有「指定尺寸」的地方都用同一套口径表达，两种类别等价可换算：
 *   · 比例 + 分辨率     —— 比例（16:9 …）× 分辨率档（1k / 2k / 4k）
 *   · 比例 + 百万像素 + 倍数 —— 比例 × 总像素档（1M / 2M / 4M）× 宽高对齐倍数（8/16/32/64）
 *
 * 为什么要有「分辨率表」而不是现算：1k / 2k / 4k 在不同场景下不是同一个数
 * —— 图片场景（AI 出图）1k 长边按 1024 走，视频场景（显示器 / 视频行业标准）
 * 1k 是 1280×720、2k 是 2560×1440。同一档位两套值，只能查表。
 * 表本身允许用户改（见 size-preset-store），本模块只出**默认值**与纯换算。
 *
 * 本模块无 React、无副作用（规范 17 §17.2 第①层），可直接单测。 */

/** 尺寸所属场景：图片（AI 出图口径）/ 视频（显示器与视频行业标准口径）。 */
export type SizeScene = "image" | "video";

/** 一个比例预设：`label` 是 UI 上的显示名（含方位后缀），`ratio` = 宽 / 高。 */
export interface SizeRatioPreset {
  label: string;
  ratio: number;
}

/** 比例预设（8 档）。宽高两侧都列出，避免用户手算倒数比例。 */
export const SIZE_RATIO_PRESETS: SizeRatioPreset[] = [
  { label: "1:1 正方", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "16:9 横屏", ratio: 16 / 9 },
  { label: "21:9 超宽", ratio: 21 / 9 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "9:16 竖屏", ratio: 9 / 16 },
];

/** 分辨率档位（长边口径）。 */
export const RESOLUTION_TIERS = ["1k", "2k", "4k"] as const;
export type ResolutionTier = (typeof RESOLUTION_TIERS)[number];

/** 百万像素档位（总像素，单位 M）。 */
export const MEGAPIXEL_TIERS = [1, 2, 4] as const;
export type MegapixelTier = (typeof MEGAPIXEL_TIERS)[number];

/** 宽高对齐倍数候选：宽高都要落在这个网格上。 */
export const ALIGN_MULTIPLE_OPTIONS = [8, 16, 32, 64] as const;
export type AlignMultiple = (typeof ALIGN_MULTIPLE_OPTIONS)[number];
export const DEFAULT_ALIGN_MULTIPLE: AlignMultiple = 64;

/** 尺寸下界 / 上界（与 `numericBounds` 给 width/height 的范围一致）。 */
export const MIN_SIZE = 64;
export const MAX_SIZE = 4096;

export interface SizeDims {
  width: number;
  height: number;
}

/** 单场景的「比例 → 各分辨率档的宽高」表。 */
export type SceneResolutionTable = Record<
  string,
  Record<ResolutionTier, SizeDims>
>;

/** 全场景尺寸表。 */
export interface SizePresetTable {
  image: SceneResolutionTable;
  video: SceneResolutionTable;
}

const dims = (width: number, height: number): SizeDims => ({ width, height });

/* ── 默认表 ──
 * 图片场景：AI 出图 / 通用场景，长边约 1024 / 2048 / 3840~4096。
 * 视频场景：显示器 / 视频行业标准，1K 俗称 = 1280×720、2K = 2560×1440、
 *          4K UHD = 3840×2160；超宽档按行业常见值单列。 */
const DEFAULT_IMAGE_TABLE: SceneResolutionTable = {
  "1:1 正方": {
    "1k": dims(1024, 1024),
    "2k": dims(2048, 2048),
    "4k": dims(3840, 3840),
  },
  "4:3": {
    "1k": dims(1024, 768),
    "2k": dims(2048, 1536),
    "4k": dims(4096, 3072),
  },
  "3:2": {
    "1k": dims(1024, 683),
    "2k": dims(2048, 1365),
    "4k": dims(4096, 2731),
  },
  "16:9 横屏": {
    "1k": dims(1024, 576),
    "2k": dims(2048, 1152),
    "4k": dims(3840, 2160),
  },
  "21:9 超宽": {
    "1k": dims(1195, 512),
    "2k": dims(2560, 1080),
    "4k": dims(5120, 2160),
  },
  "3:4": {
    "1k": dims(768, 1024),
    "2k": dims(1536, 2048),
    "4k": dims(3072, 4096),
  },
  "2:3": {
    "1k": dims(683, 1024),
    "2k": dims(1365, 2048),
    "4k": dims(2731, 4096),
  },
  "9:16 竖屏": {
    "1k": dims(576, 1024),
    "2k": dims(1152, 2048),
    "4k": dims(2160, 3840),
  },
};

const DEFAULT_VIDEO_TABLE: SceneResolutionTable = {
  "1:1 正方": {
    "1k": dims(1024, 1024),
    "2k": dims(2048, 2048),
    "4k": dims(3840, 3840),
  },
  "4:3": {
    "1k": dims(1280, 960),
    "2k": dims(2048, 1536),
    "4k": dims(4096, 3072),
  },
  "3:2": {
    "1k": dims(1280, 854),
    "2k": dims(2560, 1707),
    "4k": dims(3840, 2560),
  },
  "16:9 横屏": {
    "1k": dims(1280, 720),
    "2k": dims(2560, 1440),
    "4k": dims(3840, 2160),
  },
  "21:9 超宽": {
    "1k": dims(1280, 540),
    "2k": dims(2560, 1080),
    "4k": dims(5120, 2160),
  },
  "3:4": {
    "1k": dims(960, 1280),
    "2k": dims(1536, 2048),
    "4k": dims(2880, 3840),
  },
  "2:3": {
    "1k": dims(854, 1280),
    "2k": dims(1707, 2560),
    "4k": dims(2560, 3840),
  },
  "9:16 竖屏": {
    "1k": dims(720, 1280),
    "2k": dims(1440, 2560),
    "4k": dims(2160, 3840),
  },
};

export const DEFAULT_SIZE_PRESET_TABLE: SizePresetTable = {
  image: DEFAULT_IMAGE_TABLE,
  video: DEFAULT_VIDEO_TABLE,
};

/** 场景的显示名。 */
export const SIZE_SCENE_LABELS: Record<SizeScene, string> = {
  image: "图片",
  video: "视频",
};

/** 从模式码推场景（T2V / I2V / FLF2V … 这类以 V 收尾的是视频模式）。
 *
 *  刻意只看模式码：工作流库那层「内容分类」是展示维度，不是生成模式判据
 *  （与 `workflow-encapsulation` 的 `isVideoMode` 同一口径）。 */
export function sceneFromMode(mode: string | null | undefined): SizeScene {
  const code = (mode ?? "").trim().toUpperCase();
  if (!code) return "image";
  if (code.includes("VIDEO")) return "video";
  if (code.endsWith("V")) return "video";
  return "image";
}

/** 与目标比例最接近的比例预设（表行键）。 */
export function nearestRatioPreset(ratio: number): SizeRatioPreset {
  const target = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  return SIZE_RATIO_PRESETS.reduce(
    (best, preset) =>
      Math.abs(preset.ratio - target) < Math.abs(best.ratio - target)
        ? preset
        : best,
    SIZE_RATIO_PRESETS[0]!,
  );
}

/** 比例预设 label → 比值；未知 label 回退 1:1。 */
export function ratioOfLabel(label: string): number {
  return (
    SIZE_RATIO_PRESETS.find((preset) => preset.label === label)?.ratio ?? 1
  );
}

/** 表行键 → 短标签（"16:9 横屏" → "16:9"）。 */
export function shortRatio(label: string): string {
  return label.split(/\s+/)[0] ?? label;
}

/** 查表：某场景下「某比例 × 某分辨率档」的宽高。
 *
 *  比例按**最接近的预设行**取（手写的自定义比例也拿得到一档可用的值），
 *  表里缺行时回退到 1:1 行，再缺就按长边现算，保证永远返回有限的宽高。 */
export function resolutionDims(
  scene: SizeScene,
  ratio: number,
  tier: ResolutionTier,
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): SizeDims {
  const row = table[scene]?.[nearestRatioPreset(ratio).label];
  const hit = row?.[tier];
  if (hit && hit.width > 0 && hit.height > 0) return { ...hit };
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const longEdge = tier === "4k" ? 3840 : tier === "2k" ? 2048 : 1024;
  return safe >= 1
    ? dims(longEdge, Math.max(1, Math.round(longEdge / safe)))
    : dims(Math.max(1, Math.round(longEdge * safe)), longEdge);
}

/** 长边像素（横屏取宽、竖屏取高）。 */
export function longEdgeOf(size: SizeDims): number {
  return Math.max(size.width, size.height);
}

/** 总像素。 */
export function totalPixelsOf(size: SizeDims): number {
  return size.width * size.height;
}

/** 宽高 → 百万像素（默认保留 3 位小数，够表达 1024×576 = 0.59M 这档差异）。 */
export function megapixelsOf(size: SizeDims, digits = 3): number {
  const raw = totalPixelsOf(size) / 1_000_000;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const factor = 10 ** digits;
  return Math.round(raw * factor) / factor;
}

/** 宽高 → 能把两侧都整除的最大候选倍数；都除不尽时退到最小档 8。 */
export function alignMultipleOf(size: SizeDims): AlignMultiple {
  for (let i = ALIGN_MULTIPLE_OPTIONS.length - 1; i >= 0; i -= 1) {
    const m = ALIGN_MULTIPLE_OPTIONS[i]!;
    if (size.width % m === 0 && size.height % m === 0) return m;
  }
  return ALIGN_MULTIPLE_OPTIONS[0];
}

/** 把任意数规范到候选倍数（就近取，小于最小档回退默认 64）。 */
export function normalizeAlignMultiple(multiple: number): AlignMultiple {
  if (!Number.isFinite(multiple) || multiple < ALIGN_MULTIPLE_OPTIONS[0]) {
    return DEFAULT_ALIGN_MULTIPLE;
  }
  return ALIGN_MULTIPLE_OPTIONS.reduce((best, option) =>
    Math.abs(option - multiple) < Math.abs(best - multiple) ? option : best,
  );
}

/** 宽高吸附到 `multiple` 网格并钳制到 [MIN_SIZE, MAX_SIZE]。 */
export function snapSize(size: SizeDims, multiple: AlignMultiple): SizeDims {
  const snap = (value: number) =>
    Math.max(
      MIN_SIZE,
      Math.min(MAX_SIZE, Math.round(value / multiple) * multiple),
    );
  return { width: snap(size.width), height: snap(size.height) };
}

/** 百万像素 + 倍数 + 比例 → 宽高（两侧落倍数网格，总像素预算按比例分配）。
 *
 *  `totalPixels = w * h` 与 `w / h = ratio` 联立：
 *    h = sqrt(totalPixels / ratio)，w = totalPixels / h。 */
export function megapixelDims(
  ratio: number,
  megapixels: number,
  multiple: AlignMultiple = DEFAULT_ALIGN_MULTIPLE,
): SizeDims {
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const total =
    (Number.isFinite(megapixels) && megapixels > 0 ? megapixels : 1) *
    1_000_000;
  const rawHeight = Math.sqrt(total / safeRatio);
  const rawWidth = total / rawHeight;
  return snapSize(
    { width: rawWidth, height: rawHeight },
    normalizeAlignMultiple(multiple),
  );
}

/** 比例 + 分辨率 → 比例 + 百万像素 + 倍数（两种尺寸类别之间的换算）。
 *
 *  用户口径：界面上选的是「比例 + 分辨率」，而目标工作流要的是
 *  「比例 + 百万像素 + 倍数」时，按这一条换算后再下发：
 *   · 百万像素 = 该档位查表所得宽高的实际总像素（不是幂次近似）；
 *   · 倍数     = 能同时整除两侧的最大候选倍数（都除不尽时取 8）。

 *  唯一解，可直接单测。 */
export function toMegapixelSpec(
  scene: SizeScene,
  ratio: number,
  tier: ResolutionTier,
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): { megapixels: number; multiple: AlignMultiple; size: SizeDims } {
  const size = resolutionDims(scene, ratio, tier, table);
  return {
    megapixels: megapixelsOf(size),
    multiple: alignMultipleOf(size),
    size,
  };
}

/* ══ 清晰度档目录 ══════════════════════════════════════════════════════
 *
 * 「像素」大类下的两个子类：分辨率（1k / 2k / 4k，查场景表）与百万像素
 * （1M / 2M / 4M，总像素预算）。两边的**档位表**都在本模块，界面（studio 的
 * 选择器 / 工坊的尺寸选择器）只读这份目录，不许各自再写一份字面量。 */

export type ClarityKind = "resolution" | "megapixel";

export interface SizeClarityPreset {
  kind: ClarityKind;
  /** 显示名（"1k" / "2M"），也是 `SizeSpec.clarity` 的取值。 */
  label: string;
  /** 分辨率档：档位名。 */
  tier?: ResolutionTier;
  /** 百万像素档：总像素档位（1 = 1M）。 */
  megapixels?: number;
}

export const SIZE_CLARITY_PRESETS: SizeClarityPreset[] = [
  ...RESOLUTION_TIERS.map((tier) => ({
    kind: "resolution" as const,
    label: tier,
    tier,
  })),
  ...MEGAPIXEL_TIERS.map((tier) => ({
    kind: "megapixel" as const,
    label: `${tier}M`,
    megapixels: tier,
  })),
];

/** 两个子类在界面上的显示名（分组标题用同一份，避免两处漂移）。 */
export const CLARITY_SUBGROUP_LABELS: Record<ClarityKind, string> = {
  resolution: "分辨率",
  megapixel: "百万像素",
};

/** 清晰度档 label → 预设；未知 label 回退第一档（1k）。 */
export function clarityPresetOfLabel(label: string): SizeClarityPreset {
  return (
    SIZE_CLARITY_PRESETS.find((preset) => preset.label === label) ??
    SIZE_CLARITY_PRESETS[0]!
  );
}

/** 清晰度档 label 属于哪个子类（未知按分辨率处理）。 */
export function clarityKindOfLabel(label: string): ClarityKind {
  return clarityPresetOfLabel(label).kind;
}

/** 分辨率档 label（"1k"）→ 档位；不是分辨率档返回 null。 */
export function resolutionTierOfLabel(label: string): ResolutionTier | null {
  const preset = SIZE_CLARITY_PRESETS.find((item) => item.label === label);
  return preset?.tier ?? null;
}

/** 百万像素档 label（"2M"）→ 档位数值（2）；不是百万像素档返回 null。 */
export function megapixelTierOfLabel(label: string): number | null {
  const preset = SIZE_CLARITY_PRESETS.find((item) => item.label === label);
  return preset?.megapixels ?? null;
}

/* ══ 尺寸表达（全项目唯一口径）═════════════════════════════════════════
 *
 * 尺寸只用这两种等价形式表达，别处不许再发明第三种（尤其不许再传 "WxH"
 * 字符串当**输入** —— 那串东西反解回比例会落在两个预设之间，用户表现为
 * 「选了 1k 却算出个怪尺寸」）：
 *   · 比例 + 分辨率          —— `clarity` 给 1k / 2k / 4k，宽高查场景表；
 *   · 比例 + 百万像素 + 倍数  —— `clarity` 给 1M / 2M / 4M，`multiple` 给倍数。
 * 目标要是「宽 + 高」时，用 `sizeSpecDims` 由上面任一种**算**出来（派生值，
 * 不是第二种表达）。 */

export interface SizeSpec {
  /** 比例预设 label（`SIZE_RATIO_PRESETS[].label`，如 "16:9 横屏" / "3:4"）。 */
  ratio: string;
  /** 清晰度档 label（`SIZE_CLARITY_PRESETS[].label`，如 "1k" / "2M"）。 */
  clarity: string;
  /** 百万像素档的宽高对齐倍数；分辨率档不读它（宽高由场景表给定）。 */
  multiple: AlignMultiple;
}

/** 默认尺寸：竖屏 1k（3:4，图片场景表 → 768×1024）。 */
export const DEFAULT_SIZE_SPEC: SizeSpec = {
  ratio: "3:4",
  clarity: "1k",
  multiple: DEFAULT_ALIGN_MULTIPLE,
};

/** 容错：把任意（老草稿 / 外部 JSON / 短比例标签）收窄成合法 `SizeSpec`。
 *
 *  比例接受预设 label（"16:9 横屏"）与**短标签**（"16:9"）两种写法 —— 外部调用
 *  方（MCP / 接口）按直觉给的是短标签，落到最接近的预设行即可；缺项与识别不出的
 *  值回退默认。 */
export function normalizeSizeSpec(
  raw:
    | { ratio?: unknown; clarity?: unknown; multiple?: unknown }
    | null
    | undefined,
): SizeSpec {
  const ratioLabel = normalizeRatioLabel(raw?.ratio);
  const clarityLabel =
    typeof raw?.clarity === "string" &&
    SIZE_CLARITY_PRESETS.some((preset) => preset.label === raw.clarity)
      ? raw.clarity
      : DEFAULT_SIZE_SPEC.clarity;
  const multiple =
    typeof raw?.multiple === "number"
      ? normalizeAlignMultiple(raw.multiple)
      : DEFAULT_SIZE_SPEC.multiple;
  return { ratio: ratioLabel, clarity: clarityLabel, multiple };
}

/** 比例写法 → 预设 label：预设 label 原样、短标签（"16:9"）落到最接近的预设行、
 *  识别不出回退默认。 */
export function normalizeRatioLabel(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_SIZE_SPEC.ratio;
  const text = raw.trim();
  const exact = SIZE_RATIO_PRESETS.find((preset) => preset.label === text);
  if (exact) return exact.label;
  const ratio = parseRatioFromText(text);
  if (ratio === null) return DEFAULT_SIZE_SPEC.ratio;
  const preset = nearestRatioPreset(ratio);
  /* 差得太远（如 "42:1"）不硬掰到标准比例 —— 回退默认，让调用方给个像样的比例；
   * 邻近的写法（"2.39:1" → 21:9、"1.85:1" → 16:9）则照常吸附。 */
  return Math.abs(preset.ratio - ratio) / ratio <= 0.25
    ? preset.label
    : DEFAULT_SIZE_SPEC.ratio;
}

/** 该尺寸表达属于哪个子类。 */
export function sizeSpecKind(spec: SizeSpec): ClarityKind {
  return clarityKindOfLabel(spec.clarity);
}

/** 比例 label → 比值。 */
export function sizeSpecRatio(spec: SizeSpec): number {
  return ratioOfLabel(spec.ratio);
}

/** 比例短标签（"16:9 横屏" → "16:9"）—— 与工作流 `aspect_ratio` 的候选值同形。 */
export function sizeSpecAspect(spec: SizeSpec): string {
  return shortRatio(spec.ratio);
}

/** 尺寸表达 → 宽高（两种类别都收敛到这里算）。 */
export function sizeSpecDims(
  spec: SizeSpec,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): SizeDims {
  const ratio = sizeSpecRatio(spec);
  const tier = resolutionTierOfLabel(spec.clarity);
  if (tier) return resolutionDims(scene, ratio, tier, table);
  return megapixelDims(
    ratio,
    megapixelTierOfLabel(spec.clarity) ?? 1,
    normalizeAlignMultiple(spec.multiple),
  );
}

/** 尺寸表达 → "宽x高"。**只**给仍只认 WxH 的老接口（远端 API 通道）与
 *  远端接口用；工作流库的工作流不吃字符串。 */
export function sizeSpecToWxH(
  spec: SizeSpec,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): string {
  const { width, height } = sizeSpecDims(spec, scene, table);
  return `${width}x${height}`;
}

/** 尺寸表达 → 总像素量（单位：百万像素）。
 *
 *  分辨率档按**该档宽高的实际总像素**给（不是幂次近似）—— 目标工作流要的是
 *  「比例 + 百万像素 + 倍数」时，只有实际值才能让它算出同一组宽高。 */
export function sizeSpecMegapixels(
  spec: SizeSpec,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): number {
  const preset = clarityPresetOfLabel(spec.clarity);
  if (preset.kind === "resolution")
    return megapixelsOf(sizeSpecDims(spec, scene, table));
  return preset.megapixels ?? 1;
}

/** 尺寸表达 → 宽高对齐倍数（分辨率档取能整除该档两侧的最大候选）。 */
export function sizeSpecMultiple(
  spec: SizeSpec,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): AlignMultiple {
  if (sizeSpecKind(spec) === "resolution") {
    return alignMultipleOf(sizeSpecDims(spec, scene, table));
  }
  return normalizeAlignMultiple(spec.multiple);
}

/** 尺寸表达 → 远端通道认的「比例 + 百万像素 + 倍数」三元组。
 *
 *  只认这个形状的是 OpenAI 兼容图像的通道（`aspect_ratio` / `megapixels` /
 *  `multiple` 三个字段名），与只认 `"WxH"` 的老接口是两套口径，同源在这里
 *  算 —— 两边各拼一次就会漂移（比例取短标签、百万像素取实际总像素还是幂次
 *  近似，任一处不同就是「设置页显示 A、请求发的是 B」）。 */
export function sizeSpecToRelay(
  spec: SizeSpec,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): { aspectRatio: string; megapixels: string; multiple: AlignMultiple } {
  return {
    aspectRatio: sizeSpecAspect(spec),
    megapixels: String(sizeSpecMegapixels(spec, scene, table)),
    multiple: sizeSpecMultiple(spec, scene, table),
  };
}

/** 分辨率档的长边像素；百万像素档没有这个概念，返回 undefined。 */
export function sizeSpecLongEdge(
  spec: SizeSpec,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): number | undefined {
  if (sizeSpecKind(spec) !== "resolution") return undefined;
  return longEdgeOf(sizeSpecDims(spec, scene, table));
}

/** 生成按钮旁的紧凑摘要（"3:4 / 1k"，百万像素档追加倍数 "16:9 / 2M / 64"）。
 *  刻意不带折算出来的 WxH：那是个会误导的近似值，也让两处显示不一致。 */
export function sizeSpecSummary(spec: SizeSpec): string {
  const base = `${sizeSpecAspect(spec)} / ${spec.clarity}`;
  return sizeSpecKind(spec) === "megapixel"
    ? `${base} / ${normalizeAlignMultiple(spec.multiple)}`
    : base;
}

/** 宽高 → 最接近的清晰度档 label（反解：历史数据 / 旧字段回读时用）。 */
export function clarityLabelOfDims(
  width: number,
  height: number,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): string {
  if (!(width > 0) || !(height > 0)) return DEFAULT_SIZE_SPEC.clarity;
  const ratio = width / height;
  let best = SIZE_CLARITY_PRESETS[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const preset of SIZE_CLARITY_PRESETS) {
    const dims = preset.tier
      ? resolutionDims(scene, ratio, preset.tier, table)
      : megapixelDims(ratio, preset.megapixels ?? 1, DEFAULT_ALIGN_MULTIPLE);
    const dist = Math.abs(dims.width - width) + Math.abs(dims.height - height);
    if (dist < bestDist) {
      best = preset;
      bestDist = dist;
    }
  }
  return best.label;
}

/** 宽高 → 尺寸表达（比例取最接近的预设行，倍数取能整除两侧的最大候选）。 */
export function sizeSpecFromDims(
  width: number,
  height: number,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): SizeSpec {
  if (!(width > 0) || !(height > 0)) return { ...DEFAULT_SIZE_SPEC };
  return {
    ratio: nearestRatioPreset(width / height).label,
    clarity: clarityLabelOfDims(width, height, scene, table),
    multiple: alignMultipleOf({ width, height }),
  };
}

/** 解析 "832x1216" → 宽高；无法识别返回 null。 */
export function parseSizeText(text: unknown): SizeDims | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const match = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(text.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  return { width, height };
}

/** 旧数据（"832x1216" 这类 WxH 字符串 / 草稿 JSON）→ 尺寸表达；识别不出回退默认。
 *
 *  只服务**读旧值**：尺寸的新写法就是 `SizeSpec`，不再有字符串表达。 */
export function sizeSpecFromText(
  raw: unknown,
  scene: SizeScene = "image",
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): SizeSpec {
  const dims = parseSizeText(raw);
  if (!dims) return { ...DEFAULT_SIZE_SPEC };
  return sizeSpecFromDims(dims.width, dims.height, scene, table);
}

/** 容错入口：尺寸表达的任意历史写法 → 合法 `SizeSpec`。
 *
 *  读**旧数据**一律走这里：localStorage 里的画布节点、数据库文本列存的
 *  `"1280x720"`、老请求体里的 `size` 字段 —— 新版一律写 `SizeSpec`，识别不出的
 *  值（含 `undefined` / 脏 JSON）回退默认，不抛错。 */
export function toSizeSpec(raw: unknown): SizeSpec {
  if (typeof raw === "string") return sizeSpecFromText(raw);
  if (raw && typeof raw === "object") {
    return normalizeSizeSpec(raw);
  }
  return { ...DEFAULT_SIZE_SPEC };
}

/** 宽高 → 某个 `aspect_ratio` 端口该写的候选值（工坊 / 画布派值用）。
 *
 *  这类端口是 COMBO，写进去的值必须逐字命中它的 `options`（如 `"16:9 (Widescreen)"`），
 *  否则 ComfyUI 静默回落到第一个选项。因此：`options` 里有同比例的项就用它；
 *  没有 `options`（IO 未富化）时按本模块的标准短标签给；相对差超过 2% 的面积
 *  不算命中（如 1000x999 不该被写成 "16:9"）。 */
export function aspectLabelForDims(
  width: number,
  height: number,
  options?: readonly string[],
): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  const target = width / height;
  const ranked = [...SIZE_RATIO_PRESETS].sort(
    (a, b) => Math.abs(a.ratio - target) - Math.abs(b.ratio - target),
  );
  for (const preset of ranked) {
    if (Math.abs(preset.ratio - target) / target > 0.02) continue;
    const label = shortRatio(preset.label);
    if (!options || options.length === 0) return label;
    const hit = options.find((option) => {
      if (option === label) return true;
      const optionRatio = parseRatioFromText(option);
      return (
        optionRatio !== null &&
        Math.abs(optionRatio - preset.ratio) / preset.ratio < 0.02
      );
    });
    if (hit) return hit;
  }
  return null;
}

/** 从自由文本里解出宽高比（`"16:9 (Widescreen)"` → 16/9）；解不出返回 null。 */
export function parseRatioFromText(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;
  return w / h;
}

/** 某场景的表相对默认值是否被改过（配置界面据此显示「已改」与恢复入口）。 */
export function sceneIsModified(
  scene: SizeScene,
  table: SizePresetTable,
): boolean {
  const current = table[scene];
  const fallback = DEFAULT_SIZE_PRESET_TABLE[scene];
  for (const preset of SIZE_RATIO_PRESETS) {
    for (const tier of RESOLUTION_TIERS) {
      const a = current[preset.label]?.[tier];
      const b = fallback[preset.label]?.[tier];
      if (!a || !b) return true;
      if (a.width !== b.width || a.height !== b.height) return true;
    }
  }
  return false;
}

/** 由宽高反解最接近的分辨率档（含场景），识别不出时返回 null。 */
export function resolutionTierOf(
  scene: SizeScene,
  width: number,
  height: number,
  table: SizePresetTable = DEFAULT_SIZE_PRESET_TABLE,
): ResolutionTier | null {
  if (!(width > 0) || !(height > 0)) return null;
  const row = table[scene]?.[nearestRatioPreset(width / height).label];
  if (!row) return null;
  let best: ResolutionTier | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const tier of RESOLUTION_TIERS) {
    const hit = row[tier];
    const dist = Math.abs(hit.width - width) + Math.abs(hit.height - height);
    if (dist < bestDist) {
      best = tier;
      bestDist = dist;
    }
  }
  return best;
}
