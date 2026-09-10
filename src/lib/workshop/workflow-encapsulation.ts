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
  | "reference-image"
  | "first-frame"
  | "last-frame"
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
  /** "宽x高"（如 "832x1216"）。有 width/height pin 时按 W/H 落，
   *  只有 aspect/megapixels pin 时自行换算。 */
  size?: string;
  /** 参考图文件名（已上传到 ComfyUI 输入目录）。
   *  按顺序填进工作流里的图片槽位；视频模式下首帧槽优先拿第一张。 */
  referenceImages?: string[];
  /** 视频：首帧文件名。缺省时回退到 referenceImages[0]。 */
  firstFrame?: string;
  /** 视频：尾帧文件名（首尾帧工作流用）。 */
  lastFrame?: string;
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
  if (isAspectPin(e)) return "size-aspect";
  if (isPromptPin(e)) return "prompt";
  return "internal";
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
    cls: WorkshopPinClass
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
      case "first-frame":
        return { matched: firstFrame !== undefined, value: firstFrame };
      case "last-frame":
        return { matched: lastFrame !== undefined, value: lastFrame };
      case "reference-image":
        return { matched: refImage !== undefined, value: nextReference() };
      /* aspect / megapixels 没有从 "WxH" 直接可落的值——工坊的 size 是像素，
       * 这两种 pin 只能靠默认值。列为对外分类仅为让 UI 知道它们被纳入了
       * 尺寸语义，实际值仍走默认值，故 matched 恒 false。 */
      case "size-aspect":
      case "size-megapixels":
        return { matched: false, value: undefined };
      default:
        return { matched: false, value: undefined };
    }
  };

  for (const [key, entry] of Object.entries(io)) {
    const cls = classified.get(key) ?? "internal";
    if (cls !== "internal") {
      exposed[key] = cls;
      const { matched, value } = userValueFor(cls);
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
  if (dims && !pickFirst(classified, "size-width") && !pickFirst(classified, "size-height"))
    unmatched.push("size");
  /* 参考图：首帧槽（含普通参考图槽）都没有，才算没落下去。
   * 首尾帧工作流的 referenceImages[0] 会落到首帧槽，不该报 unmatched。 */
  const hasImageSlot =
    pickFirst(classified, "reference-image") ?? pickFirst(classified, "first-frame");
  if (refImage !== undefined && !hasImageSlot) unmatched.push("referenceImages");
  if (lastFrame !== undefined && !pickFirst(classified, "last-frame"))
    unmatched.push("lastFrame");

  return { workflowInputs, exposed, internalKeys, unmatched };
}
