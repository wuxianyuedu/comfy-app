/* ── 工作流库 → 工坊的「对外参数封装」 ──
 *
 * 工坊（镜头生图 / 视频生成）不该把工作流库里的全部参数摊给用户：一个
 * ComfyUI 工作流可能暴露几十个 widget（steps / cfg / sampler / 各种自定义
 * 节点参数），让编剧型用户逐个填是不合理的。ISSUE #145 的口径是：工坊对外
 * 只暴露「提示词 / 尺寸 / 参考图」三样，其余参数一律用工作流图内自带的值
 * （工坊不下发）。
 *
 * 本模块只做一件事：把工坊的对外值翻译成**契约口 id → 值**，交给映射层落到
 * **作者连过线的端口**上（`applyParamMapping`，只认作者画的线）。
 *
 * **落点只认作者连的线**（用户口径：「工坊封装都靠手动连线，不靠名字约定」）：
 * 某个口（提示词 / 首帧 / 尾帧 / 参考图…）落到工作流的哪一行，由工作流库里作者
 * 拖出来的线声明 —— 与「画布节点」页签的就地运行、与封装状态派生
 * （`workshop-encapsulation-status`）走的是同一份映射
 * （`workflow-param-mapping` 的 `buildParamEntries` + `resolveMapping`）。
 *
 * 这里此前另有一套**按名字 / 节点类名猜槽位**的分类（`classifyWorkshopPin` /
 * `classifyVideoPin`）：图片口是首帧还是尾帧看 `LoadImageFirstFrame` 这类类名、
 * 看 pin 名里有没有「首帧」；尺寸落在宽还是高看名字里有没有 `width`。猜错的时候
 * 用户无从察觉 —— 库里的线说连的是这个口，工坊却按名字把值落到别处。整套名字
 * 启发式已删除：**没有线就是未配置**，如实进 `unmatched`。
 *
 * 无 React、无 IO（规范 §17.2 第②层），因此可直接单测。
 */

import {
  normalizeSizeSpec,
  sceneFromMode,
  sizeSpecToWxH,
} from "~/lib/media/size-presets";
import {
  applyParamMapping,
  buildParamEntries,
  parseParamMapping,
  resolveMapping,
} from "~/lib/workflow/workflow-param-mapping";
import type {
  WorkflowIOEntry,
  WorkflowIOMap,
} from "~/lib/workflow/workflow-io-types";

/** 工坊这一次生成要落下去的对外参数（全部可选）。
 *
 *  视频模式与生图模式共用同一个入口，只是用到的字段不同：
 *  文生视频只给 prompt / size，图生视频额外给 firstFrame，首尾帧再给 lastFrame。
 *
 *  **尺寸只按 `size-presets` 的两种表达给**（比例 + 分辨率 / 比例 + 百万像素 +
 *  倍数），不填 "WxH" 字符串：宽 / 高由本层按场景尺寸表**算**出来（目标工作流
 *  要 width+height 时）—— 字符串反解回比例会落在两个预设之间，用户表现就是
 *  「选了 1k 却算出个怪尺寸」。
 *
 *  这些值是**工坊的业务语义**（镜头图 / 首帧 / 尾帧各是什么），与「落到工作流的
 *  哪一行」是两件事：后者由作者在工作流库里的连线声明。 */
export interface WorkshopExposedValues {
  prompt?: string;
  negativePrompt?: string;
  /** 尺寸：比例 + 分辨率 或 比例 + 百万像素 + 倍数（见 `lib/size-presets`）。
   *  本层落到哪个尺寸端口由作者连线决定，值按该端口的形态派（宽高 / 比例标签 /
   *  百万像素 / 分辨率档 / 对齐倍数）。 */
  size?: SizeSpecValue;
  /** 参考图文件名（已上传到 ComfyUI 输入目录）。
   *  按契约口顺序（`reference-image` / `reference-image-2`…）给值，各自落到作者
   *  连的那一行；未连线的槽不落。 */
  referenceImages?: string[];
  /** 视频：首帧文件名。缺省时回退到 referenceImages[0]。 */
  firstFrame?: string;
  /** 视频：尾帧文件名（首尾帧工作流用）。 */
  lastFrame?: string;
  /** 视频：时长（秒）。落在作者连到「时长」口、且按秒表达的那个端口上
   *  （`duration` / `seconds` / `时长`）。 */
  duration?: number;
  /** 视频：帧数。落在按帧表达的时长端口上（`length` / `num_frames` / `帧数`）。
   *
   *  与 `duration` 是同一个「时长」口的两种落点单位：调用方按 fps 折算好再给
   *  （见 VideoStudio 的 framesFor），这里不猜 fps。 */
  frames?: number;
}

/** 尺寸表达（结构上与 `lib/size-presets` 的 `SizeSpec` 一致）。
 *
 *  在类型上**不**从 size-presets 取 `SizeSpec`：本模块的入参来自调用方拼装的
 *  plain object（工坊表单 / 服务端编排），用结构子集能少一层耦合；规范化由
 *  `normalizeSizeSpec` 在运行期做。 */
interface SizeSpecValue {
  ratio?: unknown;
  clarity?: unknown;
  multiple?: unknown;
}

/** 一次封装的结果。 */
export interface EncapsulatedInputs {
  /** 下发给 generate.generate 的 workflowInputs（**只含作者连过线的口**）。 */
  workflowInputs: { nodeId: string; name: string; value: unknown }[];
  /** 用户给了值、但落不到任何端口的口（未连线 / 作者显式断开 / 端口已消失）。
   *  以前这里会按名字猜一个端口兜住，现在如实上报 —— 没连线就是「未配置」。 */
  unmatched: string[];
}

/** 该时长端口按「帧」还是按「秒」表达。
 *
 *  这一条**必须**看端口名：两种单位在类型上都是数字，没有别的判据（工坊的契约
 *  只有一个「时长」口，落点由作者连线声明；单位是端口自己的事）。 */
function durationPinUsesFrames(e: WorkflowIOEntry): boolean {
  const text = `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();
  if (/duration|seconds?|secs?|秒/.test(text)) return false;
  return /frames?|num_?frames|frame_?count|length|帧数/.test(text);
}

/** 时长值 → 该时长端口**自己声明的**候选（只有 COMBO 端口需要这一步）。
 *
 *  写一个不在候选里的值，ComfyUI 只会静默回落到第一个选项（用户看到的是
 *  「改了时长没生效」）。所以：
 *  1. 端口没声明候选（普通数字口）→ 原样返回；
 *  2. 候选里有逐字命中的 → 用它（回写候选本身的类型，别把 "16" 写进去当字符串）；
 *  3. 候选全是数字但没逐字命中 → 取最接近的一档（时长是连续量，落到相邻档位是
 *     可预期的；直接丢掉反而让用户看到「给了 5 秒却还是默认长度」）；
 *  4. 候选里有非数字项 → 不猜，返回 undefined，调用方退回端口默认值。 */
function matchDurationOption(
  entry: WorkflowIOEntry,
  value: number,
): number | string | undefined {
  const options = Array.isArray(entry.options)
    ? entry.options.filter(
        (option): option is string => typeof option === "string",
      )
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

/** 「时长」口这一次要落的值。
 *
 *  单位由**落点端口**声明（见 `durationPinUsesFrames`）；没落点时不折算（值反正
 *  落不下去，`applyParamMapping` 会如实报 unmatched），只挑调用方给的那一个。 */
function durationValueFor(args: {
  io: WorkflowIOMap;
  resolved: Record<string, string | null>;
  values: WorkshopExposedValues;
}): number | undefined {
  const { io, resolved, values } = args;
  const target = resolved.duration;
  const port = target ? io[target] : undefined;
  if (!port) return values.duration ?? values.frames;
  const wantsFrames = durationPinUsesFrames(port);
  const raw = wantsFrames
    ? (values.frames ?? values.duration)
    : (values.duration ?? values.frames);
  if (raw === undefined) return undefined;
  const matched = matchDurationOption(port, raw);
  return typeof matched === "number" ? matched : undefined;
}

/** 工坊的对外值 → **契约口 id → 值**（映射层的入参形状）。
 *
 *  契约口 id 见 `workflow-exposed-params` 的 `exposedParamsForMode`：
 *  正向提示词（prompt）、反向提示词（negative）、尺寸（size）、
 *  首帧（first-frame）、尾帧（last-frame）、参考图（reference-image，可带序号）、
 *  时长（duration）—— 这些键与作者连线的键空间一致，映射层据此查落点。 */
function toContractValues(args: {
  io: WorkflowIOMap;
  mode: string | null;
  values: WorkshopExposedValues;
  resolved: Record<string, string | null>;
  entries: readonly { id: string; cls: string }[];
}): Record<string, unknown> {
  const { io, mode, values, resolved, entries } = args;
  const out: Record<string, unknown> = {};

  if (values.prompt !== undefined) out.prompt = values.prompt;
  if (values.negativePrompt !== undefined) out.negative = values.negativePrompt;

  /* 尺寸：工坊给的是「比例 + 档位（+ 倍数）」，映射层按**落点子口身份**派成各自
   *  认的形状（宽 / 高 / 比例标签 / 像素量 / 分辨率档 / 倍数）—— 换算只此一处，
   *  写成 "WxH" 是为了让两边的口径完全一致（映射层只吃这一种尺寸串）。 */
  if (values.size !== undefined) {
    out.size = sizeSpecToWxH(
      normalizeSizeSpec(values.size),
      sceneFromMode(mode),
    );
  }

  /* 图片：契约口 `first-frame` / `last-frame` / `reference-image(-n)` 各自落哪一行
   *  由作者连线声明，这里只按工坊的业务语义给值。
   *
   *  首帧缺省回退第一张参考图（镜头图当首帧）—— 这是**工坊的调用契约**（视频通道
   *  只有一路镜头图），不是「按位置猜工作流的槽位」：值仍只落到作者连给首帧口的
   *  那一行上。 */
  const refs = values.referenceImages ?? [];
  const firstFrame = values.firstFrame ?? refs[0];
  if (firstFrame !== undefined) out["first-frame"] = firstFrame;
  if (values.lastFrame !== undefined) out["last-frame"] = values.lastFrame;
  /* 参考图按契约顺序一一对应（第一张不带序号）。 */
  const referenceIds = entries
    .filter((entry) => entry.cls === "reference-image")
    .map((entry) => entry.id);
  referenceIds.forEach((id, index) => {
    const ref = refs[index];
    if (ref !== undefined) out[id] = ref;
  });

  const duration = durationValueFor({ io, resolved, values });
  if (duration !== undefined) out.duration = duration;

  return out;
}

/** 契约口 id → 对外值里对应的参考图槽位（`reference-image` = 0，`-2` = 1…）。
 *  非参考图口返回 -1。 */
function referenceSlotOf(id: string): number {
  if (id === "reference-image") return 0;
  const matched = /^reference-image-(\d+)$/.exec(id);
  if (!matched) return -1;
  return Math.max(0, Number(matched[1]) - 1);
}

/** 读某个**契约口**在对外值里的当前内容（图片口是文件名，文本口是文本）。
 *
 *  契约口 id 与对外值字段不是同一套名字：口叫 `negative`，字段叫
 *  `negativePrompt`；口叫 `reference-image-2`，值是 `referenceImages[1]`。
 *  读写各写一遍会让「表单上显示的那一口」与「真正下发下去的值」对不上，
 *  所以两个方向共用这一份映射（尺寸 / 时长各有自己的控件，不走这里）。 */
export function exposedValueOf(
  values: WorkshopExposedValues,
  id: string,
): string {
  if (id === "prompt") return values.prompt ?? "";
  if (id === "negative") return values.negativePrompt ?? "";
  if (id === "first-frame") return values.firstFrame ?? "";
  if (id === "last-frame") return values.lastFrame ?? "";
  const slot = referenceSlotOf(id);
  if (slot < 0) return "";
  return values.referenceImages?.[slot] ?? "";
}

/** 把某个契约口的内容写回对外值（不可变返回；认不出的口原样返回）。 */
export function withExposedValue(
  values: WorkshopExposedValues,
  id: string,
  next: string,
): WorkshopExposedValues {
  if (id === "prompt") return { ...values, prompt: next };
  if (id === "negative") return { ...values, negativePrompt: next };
  if (id === "first-frame") return { ...values, firstFrame: next };
  if (id === "last-frame") return { ...values, lastFrame: next };
  const slot = referenceSlotOf(id);
  if (slot < 0) return values;
  const refs = [...(values.referenceImages ?? [])];
  refs[slot] = next;
  return { ...values, referenceImages: refs };
}

/** 提交前清洗：**空字符串一律当「没给」**。
 *
 *  工坊的封装口径是「没给的口用工作流图内的默认值」（见 `buildEncapsulatedInputs`），
 *  而空串是**给了一个空值** —— 负向提示词那一格清空后再跑，会把工作流里作者写好的
 *  负向提示词抹成空。流程测试的表单是「全部口都摆出来」的，用户没碰过的口天然是
 *  空串，所以这一层清洗必须在提交口做一次。 */
export function pruneEmptyExposedValues(
  values: WorkshopExposedValues,
): WorkshopExposedValues {
  const out: WorkshopExposedValues = {};
  const text = (v: string | undefined) =>
    v !== undefined && v.trim() !== "" ? v : undefined;
  const prompt = text(values.prompt);
  if (prompt !== undefined) out.prompt = prompt;
  const negative = text(values.negativePrompt);
  if (negative !== undefined) out.negativePrompt = negative;
  const firstFrame = text(values.firstFrame);
  if (firstFrame !== undefined) out.firstFrame = firstFrame;
  const lastFrame = text(values.lastFrame);
  if (lastFrame !== undefined) out.lastFrame = lastFrame;
  const refs = (values.referenceImages ?? []).filter(
    (ref): ref is string => typeof ref === "string" && ref.trim() !== "",
  );
  if (refs.length > 0) out.referenceImages = refs;
  if (values.size !== undefined) out.size = values.size;
  if (values.duration !== undefined) out.duration = values.duration;
  if (values.frames !== undefined) out.frames = values.frames;
  return out;
}

/** 组装工坊对外参数 → workflowInputs（**只落作者连过线的端口**）。
 *
 *  规则：
 *   • 作者画过线的口：用户给了值就落到那条线指向的端口；线说了算；
 *   • 没画线的口：**不认用户值**（没有落点可落，不替作者猜）—— 工作流图内自带的
 *     默认值照旧生效，与「未连线的口就用工作流自己的默认值」一致；
 *   • 用户给了值却落不下去（未连线 / 断开 / 端口已消失）：记进 `unmatched`，
 *     不凭空造端口。
 *
 *  @param io       工作流详情里的 IO 映射（服务端已 enrich）。
 *  @param paramMap 作者的连线表（`paramMap` 原始形状，内部走 `parseParamMapping`）。
 *  @param mode     当前模式码；连线按模式分开存放，未开启模式传 null。
 *  @param values   工坊这次要落下去的对外参数。
 */
export function buildEncapsulatedInputs(args: {
  io: WorkflowIOMap | null | undefined;
  paramMap: unknown;
  mode: string | null | undefined;
  values: WorkshopExposedValues;
}): EncapsulatedInputs {
  const { io, paramMap, mode, values } = args;
  if (!io || typeof io !== "object") {
    return { workflowInputs: [], unmatched: [] };
  }
  const effectiveMode = mode ?? null;
  const entries = buildParamEntries(io, undefined, { mode: effectiveMode });
  const mapping = parseParamMapping(paramMap);
  const resolved = resolveMapping(entries, io, mapping, effectiveMode);
  const { inputs, unmatched } = applyParamMapping({
    io,
    entries,
    mapping,
    values: toContractValues({
      io,
      mode: effectiveMode,
      values,
      resolved,
      entries,
    }),
    mode: effectiveMode,
  });
  /* 「这个模式压根不暴露这个口」映射层看不见（它只遍历契约条目）：工坊给了图片 /
   *  时长这类值、而契约里没有对应口时在这里补报 —— 否则用户会以为值已经下发下去
   *  了（T2I 收到一张参考图就是这种情形）。 */
  const reported = new Set(unmatched);
  const hasEntry = (id: string) => entries.some((entry) => entry.id === id);
  const refs = values.referenceImages ?? [];
  if (
    (values.firstFrame !== undefined || refs.length > 0) &&
    !hasEntry("first-frame")
  ) {
    reported.add("first-frame");
  }
  if (values.lastFrame !== undefined && !hasEntry("last-frame")) {
    reported.add("last-frame");
  }
  if (
    (values.duration !== undefined || values.frames !== undefined) &&
    !hasEntry("duration")
  ) {
    reported.add("duration");
  }
  /* 尺寸折叠成一条：工坊只送**一个**尺寸表达（比例 + 档位 + 倍数），工作流用
   *  「宽高」还是「比例 + 像素量」由它自己决定 —— 接住其中一路就算接住（另一路
   *  没落点不算问题，图内默认值补上）。所以只在**一路都没落上**时报一次 `size`，
   *  报子口级会让「只暴露 width/height 的工作流」多出四条噪音。 */
  const sizeIds = entries
    .filter((entry) => entry.id.startsWith("size-"))
    .map((entry) => entry.id);
  if (sizeIds.length > 0 && values.size !== undefined) {
    const landed = sizeIds.some(
      (id) => resolved[id] !== undefined && !reported.has(id),
    );
    sizeIds.forEach((id) => reported.delete(id));
    if (!landed) reported.add("size");
  }
  return { workflowInputs: inputs, unmatched: [...reported] };
}
