/* ── 工作流库 → 工坊的「对外参数封装」 ──
 *
 * 工坊（镜头生图 / 视频生成）不该把工作流库里的全部参数摊给用户：一个
 * ComfyUI 工作流可能暴露几十个 widget（steps / cfg / sampler / 各种自定义
 * 节点参数），让编剧型用户逐个填是不合理的。ISSUE #145 的口径是：工坊对外
 * 只暴露「提示词 / 尺寸 / 参考图」三样，其余参数一律用工作流里的默认值
 * （`WorkflowIOEntry.defaultValue` / 作者覆盖 `value` / 模式默认值）。
 *
 * 本模块只做「分类 + 组装」两件纯事：
 *   1. `classifyWorkshopPin` 判定一个 IO 条目属于工坊哪一类对外控件，或
 *      不属于（→ 内部参数，走默认值）；
 *   2. `buildEncapsulatedInputs` 把用户的 提示词/尺寸/参考图 落到被识别的
 *      pin 上，其余 pin 用 `resolveEntryDefault` 播种，产出可直接下发给
 *      `generate.generate` 的 `workflowInputs` 三元组。
 *
 * 视频生成用的是同一套封装，只是对外表达不同（ISSUE #145 后续）：
 *   · 文生视频 —— 提示词 + 尺寸/时长；
 *   · 图生视频 —— 首帧参考图 + 提示词 + 尺寸/时长；
 *   · 首尾帧视频 —— 首帧 + 尾帧 + 提示词。
 * 差别在于「参考图落在哪个 pin」。ComfyUI 工作流里可能有三个 `LoadImage`
 * （首帧 / 尾帧 / 普通参考图），只看 pin 名分不出来，故引入 `VideoPinRole`
 * 与 `classifyVideoPin`：先按产出节点类名（LoadImageFirstFrame /
 * LoadImageLastFrame / LoadImage）判角色，再按 pin 名兜底，最后才回落到
 * 通用的「参考图」分类。视频模式码（taskType / modes）单独由 `isVideoMode`
 * 判定，不从内容类别码反推。
 *
 * 无 React、无 IO（规范 §17.2 第②层），因此可直接单测。
 */

import {
  resolveEntryDefault,
  type WorkflowIOEntry,
  type WorkflowIOMap,
} from "~/lib/workflow-io-types";

/** 工坊对外暴露的三类控件。`internal` = 不暴露，走默认值。 */
export type WorkshopPinClass =
  | "prompt"
  | "negative"
  | "size-width"
  | "size-height"
  | "size-aspect"
  | "size-megapixels"
  /** 宽高对齐倍数（8/16/32/64）—— 「比例 + 百万像素 + 倍数」这一类尺寸表达
   *  的第三段。存在时由工坊按当前选择派值，不再散落成需要用户手填的数字框。 */
  | "size-multiple"
  | "reference-image"
  | "first-frame"
  | "last-frame"
  /** 视频：时长。按端口名分两种单位 —— 秒（duration / 时长 / 秒数）与
   *  帧（length / num_frames / frames / 帧数），见 userValueFor 的取值。 */
  | "duration"
  | "internal";

/** 镜头视频生成各模式在封装口径下对外暴露的角色。 */
export type VideoPinRole =
  | "prompt"
  | "negative"
  | "size-width"
  | "size-height"
  | "first-frame"
  | "last-frame"
  | "reference-image"
  | "frames"
  | "fps"
  | "internal";

/** 工坊这一次生成要落下去的对外参数（全部可选）。
 *
 *  视频模式与生图模式共用同一个入口，只是用到的字段不同：
 *  文生视频只给 prompt / size，图生视频额外给 firstFrame，首尾帧再给 lastFrame。 */
export interface WorkshopExposedValues {
  prompt?: string;
  negativePrompt?: string;
  /** "宽x高"（如 "832x1216"）。有 width/height pin 时按 W/H 落。
   *
   *  **不用于 aspect / megapixels 端口** —— 工作流用「比例 + 像素基准」表达
   *  尺寸时改由 `aspect` / `megapixels` / `pixelLongEdge` 逐端口派值（见各字段
   *  说明）：把 WxH 反解回比例会落在两个预设之间，用户表现为「给了 1k 却算出
   *  个怪尺寸」。 */
  size?: string;
  /** 宽高比（标准比例标签，如 "16:9" / "3:4"）。落在 `aspect_ratio` 类端口上，
   *  且必须命中该端口自己声明的候选（COMBO 的 `options`）—— 命不中就退回默认值，
   *  绝不写一个非法选项进去。 */
  aspect?: string;
  /** 总像素量（单位：百万像素，1 = 1M）。落在 `megapixels` 类端口上。 */
  megapixels?: number;
  /** 宽高对齐倍数（8/16/32/64）。落在 `multiple` 类端口上，与 `megapixels`
   *  一起构成「比例 + 百万像素 + 倍数」这类尺寸表达。 */
  multiple?: number;
  /** 像素基准档的长边像素（1k = 1024 / 2k = 2048 / 4k = 4096）。落在只声明了
   *  单个「分辨率 / 长边」端口的尺寸口上（工坊的 1k/2k/4k 档）。 */
  pixelLongEdge?: number;
  /** 参考图文件名（已上传到 ComfyUI 输入目录）。
   *  按顺序填进工作流里的图片槽位；视频模式下首帧槽优先拿第一张。 */
  referenceImages?: string[];
  /** 视频：首帧文件名。缺省时回退到 referenceImages[0]。 */
  firstFrame?: string;
  /** 视频：尾帧文件名（首尾帧工作流用）。 */
  lastFrame?: string;
  /** 视频：时长（秒）。落在按秒表达的时长端口上（`duration` / `秒数` / `时长`）。 */
  duration?: number;
  /** 视频：帧数。落在按帧表达的时长端口上（`length` / `num_frames` / `帧数`）。
   *
   *  与 `duration` 是同一个「时长」口的两种落点单位：调用方按 fps 折算好再给
   *  （见 VideoStudio 的 framesFor），这里不再猜 fps。 */
  frames?: number;
}

/** 一次封装的结果。 */
export interface EncapsulatedInputs {
  /** 下发给 generate.generate 的 workflowInputs。 */
  workflowInputs: { nodeId: string; name: string; value: unknown }[];
  /** 被识别为「对外」的 ioKey → 分类，供 UI 提示 / 调试。 */
  exposed: Record<string, WorkshopPinClass>;
  /** 走默认值的 ioKey（未暴露的内部参数）。 */
  internalKeys: string[];
  /** 用户给了值、但工作流里没有对应 pin 的字段（如工作流没有提示词输入）。 */
  unmatched: (keyof WorkshopExposedValues)[];
}

/** 名称/标签统一小写后的搜索文本。 */
function searchText(e: WorkflowIOEntry): string {
  return `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();
}

const IMAGE_TYPES = new Set(["IMAGE", "MASK", "IMAGEUPLOAD"]);

/** 是否像「参考图 / 首帧」这类可上传的图片输入。 */
function isImagePin(e: WorkflowIOEntry): boolean {
  const type = (e.type ?? "").toUpperCase();
  if (IMAGE_TYPES.has(type)) return true;
  // 自定义节点常把上传槽声明成 STRING / 无类型，名字带 upload / image 也算。
  return /upload|image|参考图|首帧|尾帧|first_?frame|last_?frame/.test(searchText(e));
}

/** 是否像「负面提示词」。必须排在正向提示词之前判定。 */
function isNegativePin(e: WorkflowIOEntry): boolean {
  return /negative|负向|负面|反向/.test(searchText(e));
}

/** 是否像「正向提示词」。 */
function isPromptPin(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  if (/prompt|提示词|描述词/.test(text)) return true;
  // 无类型但默认值很长（>40 字符）的文本一般是提示词框，与工作流库
  // 的控件推导启发式保持一致。
  if (
    (e.type ?? "").toUpperCase() === "STRING" &&
    typeof e.defaultValue === "string" &&
    e.defaultValue.length > 40
  ) {
    return true;
  }
  return false;
}

/* ── 视频侧：按模式把 IO 归类到「首帧 / 尾帧 / 参考图 / 时长」 ── */

/** 产出「首帧」的节点类名（WAN / LTX 系各家命名不一致，用前缀+包含匹配）。 */
function isFirstFrameClass(classType: string): boolean {
  return /^(comfyui[-_ ]?)?loadimage.*first|^loadimage.*start_?frame|first_?frame|start_?frame/i.test(
    classType
  );
}

/** 产出「尾帧」的节点类名。 */
function isLastFrameClass(classType: string): boolean {
  return /^(comfyui[-_ ]?)?loadimage.*last|last_?frame|end_?frame/i.test(classType);
}

function isFramesPin(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  /* 先排除「每秒帧数」，它是 fps 不是时长。 */
  if (/fps|帧率|每秒帧/.test(text)) return false;
  return /(^|[^a-z])frames?([^a-z]|$)|length|duration|num_?frames|视频帧|帧数|时长|秒数/.test(text);
}

function isFpsPin(e: WorkflowIOEntry): boolean {
  return /fps|frame_?rate|帧率|每秒帧/.test(searchText(e));
}

/** 按产出节点类名 + pin 名判定一个图片槽位在视频模式下的角色。
 *
 *  判定顺序即优先级：类名（ComfyUI 里真实存在的「FirstFrame / LastFrame 上传
 *  节点」最权威）→ pin 名 / 标签（作者写了「首帧」这类业务名）→ 普通参考图。 */
export function classifyVideoPin(e: WorkflowIOEntry): VideoPinRole {
  if (e?.direction !== "input") return "internal";
  if (e.kind !== "widget") return "internal";
  const classType = (e.classType ?? "").trim();
  const text = searchText(e);

  if (isImagePin(e)) {
    if (isLastFrameClass(classType) || /last_?frame|尾帧|结束帧|末帧/.test(text)) {
      return "last-frame";
    }
    if (isFirstFrameClass(classType) || /first_?frame|首帧|起始帧|初始帧/.test(text)) {
      return "first-frame";
    }
    /* 泛化的图片加载节点（LoadImage / ImageLoader）：只声明了「一张图」，
     *  既可能是首帧也可能是参考图 —— 归到 reference-image，由调用方按模式
     *  决定要不要把首帧写进它（图生视频里它就是首帧）。 */
    return "reference-image";
  }
  if (isNegativePin(e)) return "negative";
  if (isWidthPin(e)) return "size-width";
  if (isHeightPin(e)) return "size-height";
  if (isFpsPin(e)) return "fps";
  if (isFramesPin(e)) return "frames";
  if (isPromptPin(e)) return "prompt";
  return "internal";
}

function isWidthPin(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  /* 用 `_` 也是词内字符：ComfyUI 常见 `base_width` / `width_2` 这类命名，
   * `\bwidth\b` 匹配不到，故显式容忍下划线边界。 */
  return /(^|[_\s])width([_\s]|$)|宽度|横向/.test(text);
}

function isHeightPin(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  return /(^|[_\s])heig?ht([_\s]|$)|高度|纵向/.test(text);
}

function isAspectPin(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  return /aspect_?ratio|宽高比|纵横比|比例/.test(text);
}

function isMegapixelsPin(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  return /megapixel|百万像素|\b像素\b/.test(text);
}

/** 宽高对齐倍数端口（`multiple` / `alignment` / 标签「倍数」）。
 *
 *  刻意与 `isMegapixelsPin` 分开：它是尺寸表达的第三段，工坊按当前选择派值
 *  （分辨率档时由「哪些倍数能整除两侧」反推），而不是让用户再填一个数字。 */
function isMultiplePin(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  return /(^|[_\s])multiple([_\s]|$)|alignment|倍数|倍率/.test(text);
}

/** 判定一个 IO 输入条目在工坊里属于哪一类对外控件。
 *
 *  仅对 `direction === "input"` 的条目有意义；输出与连线型输入一律 internal。
 *  判定顺序即优先级：负面提示词必须先于正向提示词，尺寸类必须先于提示词
 *  （避免 "width" 之类被泛化的文本启发式抢走）。 */
export function classifyWorkshopPin(e: WorkflowIOEntry): WorkshopPinClass {
  if (e?.direction !== "input") return "internal";
  // 连线型端口（MODEL / CLIP / LATENT…）没有可填的标量，不对外。
  if (e.kind !== "widget") return "internal";
  if (isImagePin(e)) return classifyVideoPin(e) as WorkshopPinClass;
  if (isNegativePin(e)) return "negative";
  if (isWidthPin(e)) return "size-width";
  if (isHeightPin(e)) return "size-height";
  if (isMegapixelsPin(e)) return "size-megapixels";
  if (isMultiplePin(e)) return "size-multiple";
  if (isAspectPin(e)) return "size-aspect";
  if (isDurationPin(e)) return "duration";
  if (isPromptPin(e)) return "prompt";
  return "internal";
}

/** 该端口是不是「时长」口（视频模式的对外时长落到它上面）。
 *
 *  先排掉帧率（帧率不是时长），再认 duration / length / frames / 帧数 / 秒数。 */
function isDurationPin(e: WorkflowIOEntry): boolean {
  if (isFpsPin(e)) return false;
  return /duration|length|num_?frames|frame_?count|frames?|时长|秒数|帧数/.test(
    searchText(e),
  );
}

/** 该时长端口按「帧」还是按「秒」表达（ComfyUI 各家命名不统一）。 */
function durationPinUsesFrames(e: WorkflowIOEntry): boolean {
  const text = searchText(e);
  if (/duration|seconds?|secs?|秒/.test(text)) return false;
  return /frames?|num_?frames|frame_?count|length|帧数/.test(text);
}

/** 时长值 → 该时长端口**自己声明的**候选（只有 COMBO 端口需要这一步）。
 *
 *  与比例同一条约定：写一个不在候选里的值，ComfyUI 只会静默回落到第一个选项
 *  （用户看到的是「改了时长没生效」）。所以：
 *  1. 端口没声明候选（普通数字口）→ 原样返回；
 *  2. 候选里有逐字命中的 → 用它（回写候选本身的类型，别把 "16" 写进去当字符串）；
 *  3. 候选全是数字但没逐字命中 → 取最接近的一档（时长是连续量，落到相邻档位是
 *     可预期的；直接丢掉反而让用户看到「给了 5 秒却还是默认长度」）；
 *  4. 候选里有非数字项 → 不猜，返回 undefined，由调用方退回端口默认值。 */
function matchDurationOption(
  entry: WorkflowIOEntry,
  value: number
): number | string | undefined {
  const options = Array.isArray(entry.options)
    ? entry.options.filter((option): option is string => typeof option === "string")
    : [];
  if (options.length === 0) return value;
  const wanted = String(value);
  const exact = options.find((option) => option.trim() === wanted);
  if (exact !== undefined) {
    const trimmed = exact.trim();
    const num = Number(trimmed);
    return trimmed !== "" && Number.isFinite(num) ? num : exact;
  }
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const num = Number(option.trim());
    if (option.trim() === "" || !Number.isFinite(num)) return undefined;
    const dist = Math.abs(num - value);
    if (dist < bestDist) {
      best = num;
      bestDist = dist;
    }
  }
  return best ?? undefined;
}

/* ── 视频模式判定 ──
 *
 * 工坊的视频通道有两个模式：文生视频（无首帧）与图生视频（有首帧）。
 * 模式码就是工作流库的 taskType / modes（T2V / I2V / TI2V / FLF2V / FL2V /
 * S2V …）。判定刻意只看这套码，不看工作流的 taskType 之上再包一层「内容分类」
 * （image/video）—— 那层分类是工作流库的展示维度，不是生成模式的判据。 */

/** 视频类模式码（前缀式，兼容 T2V / TI2V / FLF2V / FMF2V / S2V / V2V …）。 */
const VIDEO_MODE_RE = /^(t2v|i2v|ti2v|flf2v|fl2v|fmf2v|v2v|r2v|rv2v|vi2v|mv2v|vrc2v|ads2v|s2v|ia2v|a2v)$/i;

/** 该模式码是否属于视频生成。 */
export function isVideoMode(code: string | null | undefined): boolean {
  return typeof code === "string" && VIDEO_MODE_RE.test(code.trim());
}

/** 该模式是否自带首帧图（图生视频 / 图文生视频 / 首尾帧）。 */
export function modeUsesFirstFrame(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  return /^(i2v|ti2v|flf2v|fl2v|fmf2v|r2v|s2v|ia2v)$/i.test(code.trim());
}

/** 该模式是否需要尾帧图（首尾帧视频）。 */
export function modeUsesLastFrame(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  return /^(flf2v|fl2v|fmf2v)$/i.test(code.trim());
}

/** 解析 "832x1216" → {width,height}；无法识别返回 null。 */
export function parseSizeParam(size: string | undefined): { width: number; height: number } | null {
  if (typeof size !== "string") return null;
  const m = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(size.trim());
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

/** 把一组 IO 条目按 ioKey → 分类整理；同一分类出现多个时取首个（稳定顺序）。 */
function classifyAll(io: WorkflowIOMap): Map<string, WorkshopPinClass> {
  const out = new Map<string, WorkshopPinClass>();
  for (const [key, entry] of Object.entries(io)) {
    out.set(key, classifyWorkshopPin(entry));
  }
  return out;
}

function pickFirst(
  classified: Map<string, WorkshopPinClass>,
  cls: WorkshopPinClass
): string | undefined {
  for (const [key, value] of classified) {
    if (value === cls) return key;
  }
  return undefined;
}

/** 工坊给的比例标签 → 某个 `aspect_ratio` 端口**自己声明的**候选值。
 *
 *  这类端口是 COMBO，写进去的值必须逐字命中它的 `options`（如
 *  `"16:9 (Widescreen)"`）；写一个自由文本只会让 ComfyUI 静默回落到第一个选项
 *  —— 用户看到的是「改了比例没生效」。因此按「先精确、再归一化比对」的顺序找：
 *
 *  1. `options` 里有与标签逐字相同的项 → 用它；
 *  2. 否则比归一化后的比例值（从选项串里解 `16:9` 这类比值），取最接近的一项；
 *  3. 都没有（端口没声明候选 / 无法解析）→ 返回 undefined，交由调用方退回默认值。 */
export function matchAspectOption(
  entry: WorkflowIOEntry,
  aspect: string | undefined
): string | undefined {
  if (typeof aspect !== "string" || !aspect.trim()) return undefined;
  const wanted = aspect.trim();
  const options = Array.isArray(entry.options)
    ? entry.options.filter((option): option is string => typeof option === "string")
    : [];
  const exact = options.find((option) => option.trim() === wanted);
  if (exact !== undefined) return exact;
  /* COMBO 没声明候选（老数据 / 自定义节点）时按原样写 —— 那时没有「候选」可
   * 违反，工坊的标准标签就是最合理的猜测。 */
  if (options.length === 0) return wanted;
  const wantedRatio = parseRatioFromText(wanted);
  if (wantedRatio === null) return undefined;
  let best: string | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const ratio = parseRatioFromText(option);
    if (ratio === null) continue;
    const dist = Math.abs(ratio - wantedRatio);
    if (dist < bestDist) {
      best = option;
      bestDist = dist;
    }
  }
  return best;
}

/** 工作流是否用「尺寸」语义接住了值（宽 / 高 / 比例 / 像素量 任一类端口存在）。 */
function hasAnySizeSlot(classified: Map<string, WorkshopPinClass>): boolean {
  return (
    pickFirst(classified, "size-width") !== undefined ||
    pickFirst(classified, "size-height") !== undefined ||
    pickFirst(classified, "size-aspect") !== undefined ||
    pickFirst(classified, "size-megapixels") !== undefined
  );
}

/** 从自由文本里解出宽高比（`"16:9 (Widescreen)"` → 16/9）；解不出返回 null。 */
function parseRatioFromText(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/** 像素基准档的长边像素 → 百万像素量（给只暴露 `megapixels` 端口的工作流用）。
 *
 *  长边与总像素的换算只是一次近似：`pixelLongEdge` 是「长边像素」语义，而
 *  `megapixels` 是「总像素」语义，两者之间还差一个比例。工坊侧同时给了
 *  `aspect`，但这里刻意**不**用它推总像素 —— 端口只声明了 `megapixels` 时，
 *  它多半自己也按比例算 W/H；我们给出「长边档 ≈ 多少百万像素（按 1:1）」的
 *  保守换算，改由工作流自己按它的比例分配。1k→1、2k→4、4k→16（幂次口径）。 */
export function longEdgeToMegapixels(longEdge: number | undefined): number | undefined {
  if (typeof longEdge !== "number" || !Number.isFinite(longEdge) || longEdge <= 0) {
    return undefined;
  }
  const mp = (longEdge / 1024) ** 2;
  /* 保留两位小数，避免 4k 算出 16.000000000000004 这种噪声写进工作流。 */
  return Math.round(mp * 100) / 100;
}

/* ── "WxH" → 各尺寸端口认的形状（画布/库内连线通路用）──
 *
 * 画布上拖出来的「尺寸」线拿到的是作品里存的 WxH 串（如 "1920x1080"）。落到
 * `aspect_ratio` / `megapixels` 这类端口上时要现算成它们各自认的形状 —— 照抄
 * 像素串会被 ComfyUI 判成非法选项（表现为「改了没生效」）。
 *
 * 工坊封装本身（`buildEncapsulatedInputs`）不走这里：它直接拿「比例 + 像素基准」，
 * 不经 WxH 反解（见 `WorkshopExposedValues` 的 `aspect` / `megapixels`）。这两个
 * 派生函数只服务「外部值本身是 WxH」的画布通路。 */

/** 一档标准宽高比：把 "WxH" 还原成标签用。 */
const RATIO_PRESETS: { ratio: number; labels: string[] }[] = [
  { ratio: 1, labels: ["1:1", "1x1"] },
  { ratio: 16 / 9, labels: ["16:9"] },
  { ratio: 9 / 16, labels: ["9:16"] },
  { ratio: 4 / 3, labels: ["4:3"] },
  { ratio: 3 / 4, labels: ["3:4"] },
  { ratio: 3 / 2, labels: ["3:2"] },
  { ratio: 2 / 3, labels: ["2:3"] },
  { ratio: 21 / 9, labels: ["21:9"] },
];

/** 标准比例标签：与目标比例相对差最小、且**该 pin 真的声明了这个选项**的那个。
 *
 *  pin 没有 `options`（IO 未富化到候选表）时按内置表给标签 —— 工坊的标准比例
 *  标签与主流工作流一致；给了 options 就只认它自己那一份，绝不写表外的值。 */
export function aspectLabelForSize(
  width: number,
  height: number,
  options?: readonly string[],
): string | null {
  if (!(width > 0) || !(height > 0)) return null;
  const target = width / height;
  const ranked = [...RATIO_PRESETS].sort(
    (a, b) => Math.abs(a.ratio - target) - Math.abs(b.ratio - target),
  );
  for (const preset of ranked) {
    /* 相对差超过 2% 就不算命中该比例（如 1000x999 不该被写成 "16:9"）。 */
    if (Math.abs(preset.ratio - target) / target > 0.02) continue;
    for (const label of preset.labels) {
      if (!options || options.length === 0) return label;
      const hit = options.find(
        (option) => option === label || option.split(" ")[0] === label,
      );
      if (hit) return hit;
    }
  }
  return null;
}

/** 像素量（百万像素）：W×H / 1e6，按 pin 声明的小数精度取整。 */
export function megapixelsForSize(
  width: number,
  height: number,
  defaultValue?: unknown,
): number | null {
  if (!(width > 0) || !(height > 0)) return null;
  const raw = (width * height) / 1_000_000;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  /* 精度取默认值的小数位（`1.0` → 1 位；`1` → 0 位），工坊的 `1M` 这类
   * 声明通常写 1.0，写 1.03 进去会被 pin 判成「不在候选内」。 */
  const digits =
    typeof defaultValue === "number" && !Number.isInteger(defaultValue) ? 1 : 0;
  const factor = 10 ** digits;
  const rounded = Math.round(raw * factor) / factor;
  return rounded > 0 ? rounded : null;
}

/** 组装工坊对外参数 → workflowInputs。
 *
 *  规则：
 *   • 被识别为对外控件的 pin：用户给了值就用用户值，没给就回退 `resolveEntryDefault`
 *     （即「用户不改就用工作流默认值」，与其它参数一致）；
 *   • 其余 pin（internal）：一律用默认值；
 *   • 没有默认值、用户也没给值的 pin：跳过（不产生 `undefined` 三元组）；
 *   • 用户给了值但工作流没有对应 pin：记进 `unmatched`，不凭空造 pin。
 *
 *  @param io      工作流详情里的 IO 映射（服务端已 enrich）。
 *  @param mode    当前模式码；影响默认值两级回退（模式 → 通用）。未开启模式传 null。
 *  @param values  工坊这次要落下去的对外参数。
 */
export function buildEncapsulatedInputs(
  io: WorkflowIOMap | null | undefined,
  mode: string | null | undefined,
  values: WorkshopExposedValues
): EncapsulatedInputs {
  const workflowInputs: { nodeId: string; name: string; value: unknown }[] = [];
  const exposed: Record<string, WorkshopPinClass> = {};
  const internalKeys: string[] = [];
  const unmatched: (keyof WorkshopExposedValues)[] = [];

  if (!io || typeof io !== "object") {
    return { workflowInputs, exposed, internalKeys, unmatched };
  }

  const classified = classifyAll(io);
  const dims = parseSizeParam(values.size);
  const refs = values.referenceImages ?? [];
  const refImage = refs[0];
  const firstFrame = values.firstFrame ?? refImage;
  const lastFrame = values.lastFrame;

  /** 参考图槽位按出现顺序分给 inputImages（首帧槽优先拿第一张）。
   *  多张图/多个槽时按序号一一对应，多出来的槽不再硬塞。 */
  const slotIndex = { value: 0 };
  const nextReference = (): string | undefined => {
    const out = refs[slotIndex.value];
    slotIndex.value += 1;
    return out;
  };

  const userValueFor = (
    cls: WorkshopPinClass,
    ioEntry: WorkflowIOEntry
  ): { matched: boolean; value: unknown } => {
    switch (cls) {
      case "prompt":
        return { matched: values.prompt !== undefined, value: values.prompt };
      case "negative":
        return { matched: values.negativePrompt !== undefined, value: values.negativePrompt };
      case "size-width":
        return { matched: dims !== null, value: dims?.width };
      case "size-height":
        return { matched: dims !== null, value: dims?.height };
      /* 比例 / 像素量：工坊给的是「比例 + 像素基准」，不折成 WxH。
       *  比例必须命中该端口自己声明的候选（COMBO options），否则视为没给 ——
       *  写一个不在候选里的值只会让 ComfyUI 静默回落到第一个选项。 */
      case "size-aspect": {
        const aspect = matchAspectOption(ioEntry, values.aspect);
        return { matched: aspect !== undefined, value: aspect };
      }
      case "size-megapixels": {
        const mp = values.megapixels ?? longEdgeToMegapixels(values.pixelLongEdge);
        return { matched: mp !== undefined, value: mp };
      }
      /* 倍数：与「百万像素」同属「比例 + 百万像素 + 倍数」一类，工坊按当前
       *  选择派值（分辨率档由能整除两侧的最大候选反推）。 */
      case "size-multiple":
        return { matched: values.multiple !== undefined, value: values.multiple };
      case "first-frame":
        return { matched: firstFrame !== undefined, value: firstFrame };
      case "last-frame":
        return { matched: lastFrame !== undefined, value: lastFrame };
      case "reference-image":
        return { matched: refImage !== undefined, value: nextReference() };
      /* 时长：同一个口两种落点单位 —— 按帧表达的端口吃 `frames`，按秒表达的
       *  吃 `duration`（两者都由调用方按当前 fps 折算好，这里不猜 fps）。
       *  端口声明了候选（COMBO）时先按候选收敛，绝不写非法值进去。 */
      case "duration": {
        const wantsFrames = durationPinUsesFrames(ioEntry);
        const raw = wantsFrames ? values.frames : values.duration;
        if (raw === undefined) return { matched: false, value: undefined };
        const value = matchDurationOption(ioEntry, raw);
        return { matched: value !== undefined, value };
      }
      default:
        return { matched: false, value: undefined };
    }
  };

  for (const [key, entry] of Object.entries(io)) {
    const cls = classified.get(key) ?? "internal";
    if (cls !== "internal") {
      exposed[key] = cls;
      const { matched, value } = userValueFor(cls, entry);
      // 用户给了值就用用户值；否则与内部参数一样回退默认值。
      const finalValue =
        matched && value !== undefined ? value : resolveEntryDefault(entry, mode);
      if (finalValue !== undefined) {
        workflowInputs.push({ nodeId: entry.nodeId, name: entry.name, value: finalValue });
      }
      continue;
    }
    // internal：一律默认值。
    const fallback = resolveEntryDefault(entry, mode);
    internalKeys.push(key);
    if (fallback !== undefined) {
      workflowInputs.push({ nodeId: entry.nodeId, name: entry.name, value: fallback });
    }
  }

  // 用户给了值却没有对应 pin → 如实报告，不沉默丢弃。
  if (values.prompt !== undefined && !pickFirst(classified, "prompt")) unmatched.push("prompt");
  if (values.negativePrompt !== undefined && !pickFirst(classified, "negative"))
    unmatched.push("negativePrompt");
  /* 尺寸：宽 / 高 / 比例 / 像素量任一类端口接住就不算没落下去（工作流用哪种口径
   *  表达尺寸由它自己决定）。工坊会同时给出 WxH 与「比例 + 像素基准」，工作流
   *  只吃其中一路 —— 另一路没落点上**不算问题**，因此只在「一类尺寸端口都没有」
   *  时报一次 `size`，避免把「工作流只暴露 width/height」误报成「比例没生效」。 */
  if (!hasAnySizeSlot(classified)) {
    if (dims !== null || values.aspect !== undefined || values.megapixels !== undefined) {
      unmatched.push("size");
    }
  }
  /* 参考图：首帧槽（含普通参考图槽）都没有，才算没落下去。
   * 首尾帧工作流的 referenceImages[0] 会落到首帧槽，不该报 unmatched。 */
  const hasImageSlot =
    pickFirst(classified, "reference-image") ?? pickFirst(classified, "first-frame");
  if (refImage !== undefined && !hasImageSlot) unmatched.push("referenceImages");
  if (lastFrame !== undefined && !pickFirst(classified, "last-frame"))
    unmatched.push("lastFrame");

  return { workflowInputs, exposed, internalKeys, unmatched };
}
