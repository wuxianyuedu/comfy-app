/* ── 共享的工作流 IO 模型 ──
 *
 * 「这个自定义工作流到底接受 / 产出什么」的**唯一事实源**，两个消费方共用：
 *   • CreatePanel 的「自定义工作流」面板（src/components/studio/CreatePanel.tsx）
 *   • 画布上的 `workflow` 节点（src/components/studio/project-canvas/CanvasNode.tsx）
 *
 * 数据来源口径（与用户定死的）：**只能**取画布编辑器 IO 编辑模式里作者亲手勾选的
 * `workflowIO` 集合。我们从不扫图去猜参数 —— 作者没勾的 pin 就不是对外参数。
 * 服务端在数据到达之前，会为每个条目补上 ComfyUI 数据类型与当前值
 * （见 src/app/api/workflows/[id]/route.ts 的「workflowIO 富化」段）。
 */

import { runtimeNodeId } from "~/lib/workflow/workflow-param-mapping";
import {
  CLARITY_SUBGROUP_LABELS,
  DEFAULT_ALIGN_MULTIPLE,
  SIZE_CLARITY_PRESETS,
  SIZE_RATIO_PRESETS,
  clarityKindOfLabel,
  megapixelDims,
  megapixelTierOfLabel,
  normalizeAlignMultiple,
  resolutionDims,
  resolutionTierOfLabel,
  type ClarityKind,
  type SizePresetTable,
  type SizeScene,
} from "~/lib/media/size-presets";
import {
  collectModeCodes,
  isVisibleInMode,
  resolveEntryDefault,
  resolveEntryRequired,
  resolveEntrySeedMode,
  type WorkflowIOEntry,
  type WorkflowIOMap,
  type WorkflowIOModeOverride,
} from "~/lib/workflow/workflow-io-types";

export type { WorkflowIOEntry, WorkflowIOMap, WorkflowIOModeOverride };
/* 尺寸口径（倍数候选 / 比例表）与场景表同源，统一从 `lib/size-presets` 出口，
 * 既有的 `from "./workflow-io"` 调用方无需改 import。 */
export {
  DEFAULT_ALIGN_MULTIPLE,
  normalizeAlignMultiple,
  type AlignMultiple,
  type ResolutionTier,
  type SizePresetTable,
  type SizeScene,
} from "~/lib/media/size-presets";
export {
  collectModeCodes,
  isVisibleInMode,
  resolveEntryDefault,
  resolveEntryRequired,
  resolveEntrySeedMode,
};

/** 动态表单该为某个条目渲染哪种控件。 */
export type ControlKind =
  | "textarea"
  | "text"
  | "int"
  | "float"
  | "switch"
  | "image"
  | "link" // non-editable connection type (MODEL / CLIP / LATENT / …)
  | "select"; // COMBO with a resolved candidate list (DarkSelect dropdown)

/** 只可能经连线到来的 ComfyUI 类型 —— 无法由用户直接输入。 */
const LINK_ONLY = new Set([
  "MODEL",
  "CLIP",
  "VAE",
  "CONDITIONING",
  "LATENT",
  "CONTROL_NET",
  "SAMPLER",
  "SIGMAS",
  "GUIDER",
  "NOISE",
  "CLIP_VISION",
  "STYLE_MODEL",
  "UPSCALE_MODEL",
]);

/** 「图像以**文件**形式喂入」而非经连线的类型。
 *
 *  `IMAGE` / `MASK` 是 ComfyUI 的数据类型；`IMAGEUPLOAD` 则是 ComfyUI 自己的
 *  前端盖在文件选择槽位上的 widget 类型（`LoadImage` 的 `upload`、
 *  视频辅助节点的首帧选择器等）。两者都必须渲染上传控件 ——
 *  否则喂图就只能靠连线，而作者刻意暴露出来的文件选择 pin 会显示成一行死控件。 */
const IMAGE_TYPES = new Set(["IMAGE", "MASK", "IMAGEUPLOAD"]);

/** 下游该派生出**视频**节点的输出类型。 */
const VIDEO_TYPES = new Set([
  "VIDEO",
  "VHS_FILENAMES",
  "VHS_VIDEOINFO",
  "VHS_AUDIO",
  "AUDIO",
]);

/** 当某个 workflowIO 条目没有显式的 ComfyUI 类型时（例如保存 IO 映射时
 *  ComfyUI 离线），尝试从 pin 名 / 标签 / 默认值把控件种类**捞回来** ——
 *  让 width/height/steps/seed 等仍渲染成数字步进器，
 *  让 aspect_ratio 这类 COMBO 形态的 pin 仍渲染成下拉或文本，而不是一律纯文本。
 *
 *  这条兜底修的是「DimensionControl 消失」那次回归：没有它，
 *  每个没类型的 widget 都落到 "text"，width/height 就……
 *  pairs are never grouped and the 比例+清晰度 picker never renders. */
function inferControlFromName(e: WorkflowIOEntry): ControlKind | null {
  if (typeof e.defaultValue === "number") {
    return Number.isInteger(e.defaultValue) ? "int" : "float";
  }
  const search = `${e.name} ${e.label ?? ""}`.toLowerCase();
  if (
    e.name.toLowerCase() === "aspect_ratio" ||
    /\baspect_ratio\b/.test(search)
  ) {
    return Array.isArray(e.options) && e.options.length > 0 ? "select" : "text";
  }
  if (
    e.name.toLowerCase() === "megapixels" ||
    /megapixel|百万像素/.test(search)
  )
    return "float";
  if (
    /\b(width|height|size|resolution|steps|seed|cfg|denoise|strength|scale|weight|batch|count|frames|length|duration|multiple|倍数)\b/.test(
      search,
    )
  ) {
    return "int";
  }
  return null;
}

/** 在那些用**非标准类型**声明上传槽位的自定义节点上（例如 `upload`
 *  被标成 `STRING`），这些 pin **名字**表示「选一个本地文件」。
 *
 *  刻意只按名字判：ComfyUI 的 `LoadImage` 里 `image`（COMBO，上传后的文件名）
 *  与 `upload`（IMAGEUPLOAD，选择器）并存。光看 `image` 这个名字**绝不能**
 *  变成上传按钮 —— 它是**结果**槽。 */
export function isUploadPinName(e: { name?: string }): boolean {
  return /upload|file_?picker/.test((e.name ?? "").toLowerCase());
}

/** 给 pin 的类型芯片用的、实事求是的文字。
 *
 *  用户口径：「type 是什么就显示什么类型」—— 徽章必须打印 pin 真实声明的
 *  ComfyUI 类型（`IMAGEUPLOAD` / `MASK` / `INT` …）。只有元数据里根本没有类型
 *  （ComfyUI 离线时保存的 IO）才回退到控件推导出的类型，
 *  绝不把 `COMBO` 之类已有类型改写成别的名义 ——
 *  那会让「STRING 的行显示 INT」这类错位无从解释。 */
export function typeDisplay(type: string | undefined, fallback = "*"): string {
  const t = (type ?? "").trim().toUpperCase();
  return t.length > 0 ? t : fallback;
}

/** 决定某个暴露输入该渲染成哪种控件。 */
export function controlForEntry(e: WorkflowIOEntry): ControlKind {
  const type = (e.type ?? "*").toUpperCase();
  if (LINK_ONLY.has(type)) return "link";
  if (IMAGE_TYPES.has(type)) return "image";
  /* 上传位按 pin 名兜底：自定义节点常把「选择文件上传」槽声明成 STRING
   *  （甚至不带类型），只看 type 会把这一整行退化成文本框 —— 用户勾了
   *  `upload` 却只能手动敲文件名。声明成 STRING 的上传位没有别的语义，
   *  直接给上传控件；`image` 这类结果槽不在此列（见 isUploadPinName）。 */
  if (isUploadPinName(e)) return "image";
  if (type === "BOOLEAN" || type === "BOOL") return "switch";
  if (type === "INT") return "int";
  if (type === "FLOAT" || type === "NUMBER") return "float";
  /* 解析出候选清单的 COMBO → 渲染真正的 <select>（DarkSelect）。
   *  没有候选（ComfyUI 不可达 / 无法枚举）时回落到普通文本控件，
   *  表单永远不至于打不开。 */
  if (type === "COMBO") {
    if (Array.isArray(e.options) && e.options.length > 0) return "select";
    return "text";
  }
  if (type === "STRING") {
    if (e.multiline) return "textarea";
    /* 当前值很长，是「这是提示词框」的强信号 ——
     * 即使服务端的名字启发式没认出来也照样判对。 */
    if (typeof e.defaultValue === "string" && e.defaultValue.length > 40)
      return "textarea";
    return "text";
  }
  if (type === "*") {
    if (e.multiline) return "textarea";
    /* 当前值很长，是「这是提示词框」的强信号。 */
    if (typeof e.defaultValue === "string" && e.defaultValue.length > 40)
      return "textarea";
    const inferred = inferControlFromName(e);
    if (inferred) return inferred;
    return "text";
  }
  /* 已声明但未在白名单里的类型（自定义节点的 `AUDIO` / `VIDEO` / 厂商私有
   *  枚举…）：只要控件位带着标量就仍以文本可编辑，避免整行退化成「只接受
   *  连线」的哑端口 —— 那是「用户勾了却改不了」的观感来源。 */
  if (typeof e.defaultValue === "string" || typeof e.defaultValue === "number")
    return "text";
  /* 彻底无法定类型的 pin（既不是标量，也没有上传语义）→ 走连线。 */
  return "link";
}

/** 按众所周知的 ComfyUI widget 名给出合理的数值上下界。 */
export function numericBounds(e: WorkflowIOEntry): {
  min: number;
  max: number;
  step: number;
  decimalPlaces: number;
} {
  const name = `${e.name} ${e.label ?? ""}`.toLowerCase();
  const isFloat = (e.type ?? "").toUpperCase() === "FLOAT";
  if (/seed|noise_seed/.test(name))
    return { min: 0, max: 4294967295, step: 1, decimalPlaces: 0 };
  if (name.includes("steps"))
    return { min: 1, max: 200, step: 1, decimalPlaces: 0 };
  if (/^cfg|cfg$|guidance/.test(name))
    return { min: 0, max: 30, step: 0.5, decimalPlaces: 1 };
  if (/denoise|strength|weight|scale|ratio/.test(name))
    return { min: 0, max: 2, step: 0.05, decimalPlaces: 2 };
  if (/width|height|size|resolution/.test(name))
    return { min: 64, max: 4096, step: 64, decimalPlaces: 0 };
  if (/batch|count|frames|length/.test(name))
    return { min: 1, max: 512, step: 1, decimalPlaces: 0 };
  return isFloat
    ? { min: 0, max: 1000, step: 0.1, decimalPlaces: 2 }
    : { min: 0, max: 1_000_000, step: 1, decimalPlaces: 0 };
}

/** 两条记录是不是同一个 pin —— 撞名判定必须先排除「条目自己」。
 *
 *  不能只看对象身份：同一行在渲染时会按当前模式派生出拷贝
 *  （`{...entry, seedMode}`，见 DynamicWorkflowFormView 的 renderRow；
 *  GroupedControls 折叠态的行同样是现造的拷贝）。拷贝与原件是「同一个 pin
 *  的两份记录」，用身份比较会被判成「另一个撞名的条目 → 回退 name」，于是
 *  **每一行都与自己撞名**，显示名一律掉回原始 pin 名 —— 封装槽位就是
 *  `value_1`，这正是切一次 seed 行为名字就变回 `value_1` 的根因（ISSUE #349）。
 *
 *  判据按可靠度递降：对象身份 → `ioKey` → 「节点 + 方向 + 槽位名」三元组。
 *  三元组就是 ioKey 的拼法，因此任何一份拷贝都认得出来。 */
function isSamePin(a: WorkflowIOEntry, b: WorkflowIOEntry): boolean {
  if (a === b) return true;
  const aKey = (a as { ioKey?: string }).ioKey;
  const bKey = (b as { ioKey?: string }).ioKey;
  if (aKey !== undefined && bKey !== undefined) return aKey === bKey;
  return (
    a.nodeId === b.nodeId && a.direction === b.direction && a.name === b.name
  );
}

/** 名字是不是 ComfyUI 给子工作流槽位自动编号出的机器别名（`value_1` / 裸序号）。
 *
 *  与 workflow-editor/io-exposure 的 isWrapperAliasName 同形，但在共享层就地
 *  实现：它只回答「撞名时能不能拿这个名字当区分标记」，不需要知道宿主类名。 */
function isMachineAliasName(name: string | undefined): boolean {
  const slot = name?.trim();
  if (!slot) return false;
  return /^value_\d+$/.test(slot) || /^\d+$/.test(slot);
}

/** 某个暴露 pin 的最优显示标签。
 *
 * 用户口径：画布的 IO 编辑器优先用 `label` 字段，作者看到的才是
 * `positive_prompt` / `negative_prompt`，而不是光秃秃的 ComfyUI 键
 * （`text` / `text_1`）。当调用方还传入了「一起显示的完整条目清单」
 * （`allEntries`）时，标签相同的条目会退到消歧后缀，
 * 两个 pin 在视觉上仍然分得开（例如两个……）。
 * pins both labeled "图像" → shown as `inputImage` / `outputImage`).
 *
 * 两条硬性约束（ISSUE #349）：
 *   ① 「条目自己」不算撞名 —— 同一 pin 在渲染时会有派生拷贝（按模式叠加
 *      seedMode / required、组合控件折叠态现造的行），身份必须认得出它们是
 *      同一个 pin，否则每行都跟自己撞名、名字掉回原始 pin 名；
 *   ② 区分标记**绝不用机器别名** —— 封装槽位的 `name` 是 ComfyUI 自动编号的
 *      `value_1`，把它当显示名正是用户报的「名字变回 value_1」。这种情形改用
 *      宿主节点标题（作者看得懂）区分；连标题都没有时保留作者命名，宁可两行
 *      同名，也不把平台编号产物当名字显示。
 *
 * 不传 `allEntries` 时，函数返回的仍是全应用早已依赖的 `label || name` 行为，
 * CreatePanel / CanvasNode 里的既有调用方不受影响。 */
export function ioLabel(
  e: WorkflowIOEntry,
  allEntries?: readonly WorkflowIOEntry[],
): string {
  const candidate = e.label?.trim() ?? e.name;
  if (allEntries && allEntries.length > 1) {
    for (const entry of allEntries) {
      if (isSamePin(entry, e)) continue;
      const other = entry.label?.trim() ?? entry.name;
      if (other !== candidate) continue;
      /* 撞名：换一个能区分的标记。机器别名（封装槽位 `value_N` / 裸序号）是
       *  平台编号产物，不是给用户看的名字，宁可退回宿主标题也不显示它。 */
      if (!isMachineAliasName(e.name)) return e.name;
      const title = e.nodeTitle?.trim();
      if (title && title !== candidate) return `${candidate} · ${title}`;
      return candidate;
    }
  }
  return candidate;
}

/** 用户口径：参数行的顺序**由消费方自己定** —— 每一行都是独立的块，
 *  按存在哪些 IO pin 动态显示或隐藏，**不强制排序**。这里依赖 IO 映射的自然
 *  插入顺序（Object.entries 的顺序），它与用户在 IO 编辑模式里编写工作流时
 *  看到的一致。输出按标签字母序排，只作为「多个输出插入位置相同」时的
 *  稳定断开器。
 *  context.
 *
 *  See §"动态更新" in the design source-of-truth (Ardot 714503087315759):
 *    > 「每一块都是可以动态根据是否有对应的参数需要显示来动态更新的，
 *    >  参数可多可少，但是样式就是这样」
 *  每行的样式由设计固定；顺序不固定。 */

/** 把 IO 映射拆分并排序成 UI 真正需要的三个桶。
 *
 *  连线输入（kind === "param"）是「只认类型」的端口 —— 不可编辑，
 *  只能从别的节点输出接过来消费。widget 输入（kind === "widget"）带可编辑的值
 *  （下拉 / 数字 / 布尔 / 多行字符串）。输出之所以在画布上与连线输入同组，
 *  是因为两者都是「I/O 端点」—— 工作流与外界对接的地方；
 *  而 widget 输入是作者在工作流跑之前调的参数。
 *
 *  `inputs` 保留成 wireInputs + widgetInputs 的扁平拼接，
 *  让还没区分这两组的消费方继续能用。 */
export function splitWorkflowIO(io: WorkflowIOMap | undefined | null): {
  /** 没有 widget 的输入 —— 必须从别的节点输出接过来。ComfyUI 里这类是
   *  「只认类型」的端口（positive_prompt、MODEL、CLIP 等），
   *  渲染成只读芯片。 */
  wireInputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[];
  /** 带 widget 值的输入（下拉 / 数字 / 布尔 / 多行字符串等）——
   *  用户不连线也能直接编辑。 */
  widgetInputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[];
  /** 向后兼容的扁平化：[wireInputs, widgetInputs]，顺序稳定。 */
  inputs: (WorkflowIOEntry & { ioKey: string; control: ControlKind })[];
  outputs: (WorkflowIOEntry & { ioKey: string })[];
} {
  const wireInputs: (WorkflowIOEntry & {
    ioKey: string;
    control: ControlKind;
  })[] = [];
  const widgetInputs: (WorkflowIOEntry & {
    ioKey: string;
    control: ControlKind;
  })[] = [];
  const outputs: (WorkflowIOEntry & { ioKey: string })[] = [];
  for (const [ioKey, entry] of Object.entries(io ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.direction === "output") {
      outputs.push({ ...entry, ioKey });
    } else {
      const enriched = { ...entry, ioKey, control: controlForEntry(entry) };
      /* `kind === "widget"` 是用户勾选节点可编辑参数时，画布侧开关写下的信号。
       *  其余情况（kind !== "widget"）一律当作只走连线 ——
       *  与画布渲染一致：那些行会渲染 🔌 芯片。
       *  `controlForEntry` → "link".  存储自新格式起即正确区分
       *  widget / param,客户端直接按 kind 分流,无需任何旧数据特判。 */
      if (entry.kind === "widget") widgetInputs.push(enriched);
      else wireInputs.push(enriched);
    }
  }
  /* 应用用户设定的 displayOrder。缺失（undefined）时按 +Infinity 处理，
   *  不动 IO 映射的自然插入顺序 —— 没有顺序的既有工作流渲染结果与从前完全一样。
   *  稳定排序保住了 displayOrder 相同项之间的相对次序
   *  （例如一个刚勾上的项与一个手动排过位的项并排时）。
   *  三组（wire / widget / output）各自独立排序 ——
   *  画布侧的 IO 预览始终「连线 + widget 输入在上、输出在下」，
   *  用户也只在这些组内部调序，这正是预览面板的设计意图。 */
  const byDisplayOrder = (
    itemA: { displayOrder?: number },
    itemB: { displayOrder?: number },
  ) => {
    const ao = itemA.displayOrder;
    const bo = itemB.displayOrder;
    if (ao === bo) return 0;
    if (ao === undefined) return 1;
    if (bo === undefined) return -1;
    return ao - bo;
  };
  wireInputs.sort(byDisplayOrder);
  widgetInputs.sort(byDisplayOrder);
  outputs.sort(byDisplayOrder);
  return {
    wireInputs,
    widgetInputs,
    inputs: [...wireInputs, ...widgetInputs],
    outputs,
  };
}

/** 按当前模式过滤掉 `modes[mode].visible === false` 的行。未开启模式时原样返回，
 *  既有调用方行为完全不变。
 *
 *  刻意只在「展示层」过滤：`defaultInputValues` 依旧给被隐藏的参数播种模式默认值，
 *  因此提交给 ComfyUI 的 payload 不会因为某个参数在当前模式不可见就缺字段——
 *  隐藏只是不打扰用户，不代表这个值不需要下发给工作流。 */
export function filterVisibleInMode<
  T extends { modes?: Record<string, WorkflowIOModeOverride> },
>(entries: T[], mode?: string | null): T[] {
  if (!mode) return entries;
  return entries.filter((entry) => isVisibleInMode(entry, mode));
}

/**
 * 这个工作流的结果该接到画布上哪种下游节点？
 * 判据优先看暴露出来的 OUTPUT pin（用户自己的勾选），
 * 再回落工作流声明的 taskType，最后回落图像节点。
 */
export function outputTargetKind(
  io: WorkflowIOMap | undefined | null,
  taskType?: string | null,
): "image" | "video" {
  const { outputs } = splitWorkflowIO(io);
  for (const output of outputs) {
    const type = (output.type ?? "").toUpperCase();
    if (VIDEO_TYPES.has(type)) return "video";
  }
  for (const output of outputs) {
    if (IMAGE_TYPES.has((output.type ?? "").toUpperCase())) return "image";
  }
  const tt = (taskType ?? "").toLowerCase();
  if (tt.includes("video") || tt === "t2v" || tt === "i2v" || tt === "flfvideo")
    return "video";
  return "image";
}

/** 用富化出来的 `defaultValue` 播种一份值映射。
 *
 *  多模式：传入 `mode` 时走两级回退「模式默认值 → 通用默认值」
 *  （`resolveEntryDefault`），未开启模式时与旧行为完全一致。
 *  注意：这里**不过滤**被隐藏的参数——它们同样需要拿到模式默认值，否则提交
 *  给 ComfyUI 的 payload 会缺字段。隐藏只影响展示层（filterVisibleInMode）。 */
export function defaultInputValues(
  io: WorkflowIOMap | undefined | null,
  mode?: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const { inputs } = splitWorkflowIO(io);
  for (const entry of inputs) {
    if (entry.control === "link") continue;
    /* 有模式语境时按模式覆盖层取（`modes[mode].defaultValue` 压过图内默认值）；
     *  没有模式时就是图内读出的 `defaultValue`。 */
    const resolved = resolveEntryDefault(entry, mode);
    if (resolved !== undefined) out[entry.ioKey] = resolved;
    else if (entry.control === "switch") out[entry.ioKey] = false;
    else if (entry.control === "int" || entry.control === "float")
      out[entry.ioKey] = numericBounds(entry).min;
    else if (entry.control === "textarea" || entry.control === "text")
      out[entry.ioKey] = "";
  }
  return out;
}

/**
 * 把已存的值合并到新推导出的默认值之上。工作流里已经不存在的键
 * （pin 被取消勾选 / 工作流重新导入过）会被丢掉 ——
 * 陈旧的值永远不会被 POST 进一个不接受它的节点。
 */
export function reconcileInputValues(
  io: WorkflowIOMap | undefined | null,
  stored: Record<string, unknown> | undefined,
  mode?: string | null,
): Record<string, unknown> {
  const base = defaultInputValues(io, mode);
  if (!stored) return base;
  for (const key of Object.keys(base)) {
    if (stored[key] !== undefined) base[key] = stored[key];
  }
  return base;
}

/**
 * 默认值刷新（保覆盖）：把新播种出来的默认值并回当前表单值。
 *
 * 语义（ISSUE #288）：IO 编辑里改了默认值后回到工作流库，**未被用户覆盖**的
 * 参数要跟着刷新到新默认值；**已被用户改过**的参数保持用户填的值。
 *
 * 「有没有被覆盖」只能靠 `当前值 === 上次播种的默认值` 判定——表单值本身不带
 * 来源标记。因此 `baseline` 必须是上一次真正播种下去的那张默认值表：若改用
 * 「按当前 IO 现算一份默认值」当基准，作者刚改的默认值会被误判成用户覆盖，
 * 界面永远刷不到新值（这正是本 issue 要修的现象）。
 *
 * @param current  当前表单值
 * @param baseline 上一次播种下去的默认值表（首次播种传 null → 直接全量采用）
 * @param fresh    按最新 IO 播种出来的默认值表
 * @returns 合并后的新值表；没有任何键需要变更时返回 null（调用方可跳过 setState）
 */
export function mergeRefreshedDefaults(
  current: Record<string, unknown>,
  baseline: Record<string, unknown>,
  fresh: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  let changed = false;
  for (const key of Object.keys(fresh)) {
    /* 基线里没有的键 = 新暴露的 pin（作者刚勾选），按「未覆盖」处理，
     * 直接采用默认值，否则它会以 undefined 留在表单里。 */
    const inBaseline = Object.prototype.hasOwnProperty.call(baseline, key);
    const untouched =
      !inBaseline || (key in current && current[key] === baseline[key]);
    out[key] = untouched ? fresh[key] : current[key];
    if (out[key] !== current[key]) changed = true;
  }
  /* 被摘掉的 pin（取消勾选 / 工作流重新导入后消失）：值表里不再保留，
   * 否则它会随 payload 发给一个已经不存在的输入。 */
  for (const key of Object.keys(current)) {
    if (!(key in out)) changed = true;
  }
  return changed ? out : null;
}

/**
 * 把扁平的 `{ ioKey: value }` 映射转成 /api/generate → buildCustomWorkflow
 * 消费的连线载荷，即显式的 (nodeId, name, value) 三元组。
 * 键会重新对照实时的 IO 映射解析一次，
 * 改过名或被删掉的 pin 永远漏不过去。
 */
export function toWorkflowInputsPayload(
  io: WorkflowIOMap | undefined | null,
  values: Record<string, unknown>,
): { nodeId: string; name: string; value: unknown }[] {
  const { inputs } = splitWorkflowIO(io);
  const payload: { nodeId: string; name: string; value: unknown }[] = [];
  for (const entry of inputs) {
    // 项目级产出：连线传入的 wire-input（link 控件）值也一并下发。
    // 这类 key 仅在用户真正连线时才会写进 values（reconcile 会丢弃无值的 link key），
    // 所以这里无需担心把无意义的 link 默认值发出去。
    const value = values[entry.ioKey];
    if (value === undefined || value === "") continue;
    /* 运行期节点 id：子图内部勾选的条目把落库的宿主 id 拼成 comfy-cli 展开后的
     * `host:inner` 形式（见 runtimeNodeId），顶层勾选原样下发。 */
    payload.push({
      nodeId: runtimeNodeId(entry),
      name: entry.name,
      value: value,
    });
  }
  return payload;
}

/**
 * 就必填校验而言，判断一个值是否「已填」。
 * `undefined` / `null` / 空字符串 / NaN 都算空；
 * 而 `false`（布尔开关）**算已填** —— 开关只有明确的「开」或「关」，没有第三种状态。
 */
export function isInputFilled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  /* 布尔 / 对象 / 数组 —— 只要「存在即为真」的都算已填。 */
  return true;
}

/**
 * 返回所有「标了必填、但还没有可用值」的 widget 输入的 ioKey。
 * CreatePanel / CanvasNode 用它做提交守卫：作者把 `positive_prompt` 标成必填后，
 * 用户就不可能带着一个缺它的工作流入队。
 * 连线（param）型输入**刻意排除** —— 它们由画布上的接线检查在别处校验
 * （未接线的必填连线仍会以「缺参数」的形式暴露出来）。
 * connection in the form's I/O 端点 strip).
 */
export function getMissingRequiredInputs(
  io: WorkflowIOMap | undefined | null,
  values: Record<string, unknown>,
  mode?: string | null,
): string[] {
  if (!io) return [];
  const out: string[] = [];
  for (const [key, entry] of Object.entries(io)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.direction !== "input") continue;
    if (!resolveEntryRequired(entry, mode)) continue;
    if (entry.kind !== "widget") continue;
    if (!isInputFilled(values[key])) out.push(key);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
 * 参数**分组**的推断。
 *
 * 自定义工作流常常暴露一组强耦合的 widget，用户更愿意把它们当成一个「范式」
 * 来调，而不是 N 个独立的输入框：
 *   • 尺寸组 —— `width` + `height`（图像工作流）。两种填法：
 *     (A) 分开编辑 W/H；(B) 选比例 + 清晰度，由表单把 W/H 算回那两个 widget。
 *   • 视频组 —— `length`（帧数）+ `aspect`（比例）+ `quality`（画质）。
 *     两种填法：(A) 逐个编辑 widget；(B) 从友好的预设里选时长 + 画质 + 比例，
 *     由预设把真实 widget 值写进去。
 *
 * 推断**纯按名字 / 标签**（与 `numericBounds` 的关键字启发式同口径），
 * 因此不需要改 schema，任何暴露了约定 pin 的工作流都能用。
 * 分组由**唯一**的消费方 `DynamicWorkflowForm` 发现，
 * 命中的 widget 随后会**从**通用逐行渲染里**摘掉**（width/height 不会出现两次）。
 * ───────────────────────────────────────────────────────────────────────── */

/** 富化后的 widget 条目，由 `splitWorkflowIO().widgetInputs` 产出。 */
export type EnrichedWidget = WorkflowIOEntry & {
  ioKey: string;
  control: ControlKind;
};

export interface DimensionGroup {
  kind: "dimension";
  groupId: string;
  /** 常规的 W/H 成对项 —— 渲染「比例 + 清晰度」选择器。 */
  width?: EnrichedWidget;
  height?: EnrichedWidget;
  /** ResolutionSelector 风格的成对项 —— 渲染「比例 + 像素」快捷选择器，
   *  直接写进那两个暴露出来的 widget。 */
  aspect?: EnrichedWidget;
  megapixels?: EnrichedWidget;
  /** 倍数（upscale multiple）—— 存在时并入「比例 + 像素」popover 的
   *  第三段，而不是散落成独立数字框。 */
  multiple?: EnrichedWidget;
}

export interface VideoGroup {
  kind: "video";
  groupId: string;
  length?: EnrichedWidget;
  aspect?: EnrichedWidget;
  quality?: EnrichedWidget;
}

export type InferredGroup = DimensionGroup | VideoGroup;

/* ── Dimension presets (比例 + 分辨率 / 比例 + 百万像素 + 倍数 → 宽高) ──
 *
 * 尺寸对外只表达成这两类等价形式：
 *   · 比例 + 分辨率         —— 1k / 2k / 4k，具体宽高按**场景**查表
 *                              （图片 = AI 出图口径，视频 = 显示器 / 视频行业标准口径）；
 *   · 比例 + 百万像素 + 倍数 —— 1M / 2M / 4M × 宽高对齐倍数 8/16/32/64。
 * 两类之间可互算（见 `lib/size-presets` 的 `toMegapixelSpec`）：目标工作流要
 * 「比例 + 百万像素 + 倍数」而用户选的是「比例 + 分辨率」时，按表换算后下发。
 *
 * `DIM_CLARITY_PRESETS` 是**档位目录**（不含具体像素）：`kind` 区分子类，
 * 具体宽高由 `dimsForRatio` 按场景现查。图片与视频的 1k/2k/4k 不是同一组值，
 * 表允许用户在「尺寸表配置」里改（见 `lib/size-preset-store`）。
 */

/** 比例预设（与 `SIZE_RATIO_PRESETS` 同源；保留旧名以免全库改 import）。 */
export const DIM_RATIO_PRESETS: { label: string; ratio: number }[] =
  SIZE_RATIO_PRESETS;

/** 「像素」大类下的两个子类：分辨率（1k/2k/4k）与百万像素（1M/2M/4M）。
 *
 *  **档位目录只有一个出处**：`lib/size-presets` 的 `SIZE_CLARITY_PRESETS`。
 *  这里保留 studio 视图一直在用的形状（`kind` + `label` + `totalPixels`）做一层
 *  再导出，避免同一份档位表在视图层再抄一遍（抄一份就必然漂移）。 */
export interface DimClarityPreset {
  kind: ClarityKind;
  /** 弹层芯片上显示的标签（如 "1k"、"1M"）。 */
  label: string;
  /** 百万像素的种类：总像素数（宽 × 高）。 */
  totalPixels?: number;
}

export const DIM_CLARITY_PRESETS: DimClarityPreset[] = SIZE_CLARITY_PRESETS.map(
  (preset) => ({
    kind: preset.kind,
    label: preset.label,
    ...(preset.megapixels !== undefined
      ? { totalPixels: preset.megapixels * 1_000_000 }
      : {}),
  }),
);

/** 「像素」大类下两个子类的显示名（与 `size-presets` 同一份）。 */
export const CLARITY_SUBGROUP_OF_KIND: Record<
  DimClarityPreset["kind"],
  string
> = CLARITY_SUBGROUP_LABELS;

export { clarityKindOfLabel, megapixelTierOfLabel, resolutionTierOfLabel };

/* ── ResolutionSelector 的快捷预设 ──
 *  有些自定义节点（如 ResolutionSelector）并不暴露原始的 width/height，
 *  而是暴露 `aspect_ratio`（COMBO，值形如 "16:9 (Widescreen)" 的标签字符串）
 *  加 `megapixels`（FLOAT，1 ≈ 100 万总像素）。
 *  尺寸选择器需要针对这种范式的显式取值映射 —— 没东西能从这两个值推出 W/H。
 *
 *  下面的 `parseRatioFromLabel` 让选择器仍能从工作流特有的标签字符串里
 *  认出**真实**比例，这样即使某个工作流的节点……
 *  spells the option differently ("16:9 宽屏", "16:9") still highlights
 *  the right chip instead of silently falling back to "自定义". */
export const ASPECT_RATIO_LABEL_PRESETS: {
  label: string;
  value: string;
  ratio: number;
}[] = [
  { label: "1:1", value: "1:1 (Square)", ratio: 1 },
  { label: "4:3", value: "4:3 (Standard)", ratio: 4 / 3 },
  { label: "3:2", value: "3:2 (Photo)", ratio: 3 / 2 },
  { label: "16:9", value: "16:9 (Widescreen)", ratio: 16 / 9 },
  { label: "21:9", value: "21:9 (Ultrawide)", ratio: 21 / 9 },
  { label: "9:16", value: "9:16 (Portrait)", ratio: 9 / 16 },
  { label: "2:3", value: "2:3 (Portrait Photo)", ratio: 2 / 3 },
];

export const MEGAPIXEL_VALUE_PRESETS: { label: string; value: number }[] = [
  { label: "1M", value: 1 },
  { label: "2M", value: 2 },
  { label: "4M", value: 4 },
];

/** 从自由形式的比例标签（"16:9 (Wide)"）里取出数值化的宽高比。
 *  字符串里没有可识别的比例时返回 null。 */
export function parseRatioFromLabel(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)/.exec(value);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;
  return w / h;
}

/** 给定目标比例 + 清晰度预设 + 场景，返回具体的 {width, height}。
 *
 *  分辨率档（resolution kind）：查「场景 × 比例 × 档位」表 —— 表里的值就是该场景
 *    1k/2k/4k 的口径（图片与视频不同），不做网格吸附，也不做区间钳制
 *    （超宽 4k 档的 5120 宽是用户明确要的值）。
 *  百万像素档（megapixel kind）：`totalPixels = w*h` 与 `w/h = ratio` 联立
 *    （h = sqrt(totalPixels / ratio)，w = totalPixels / h），再落到用户选的
 *    倍数网格上 —— 视频 / SDXL 管线通常要求宽高是 64 的倍数。
 *
 *  传数字（旧签名）时按「显式长边」处理：长边取该数字、另一边按比例推。 */
export function dimsForRatio(
  ratio: number,
  presetOrBase: DimClarityPreset | number,
  alignMultiple: number = DEFAULT_ALIGN_MULTIPLE,
  scene: SizeScene = "image",
  table?: SizePresetTable,
): { width: number; height: number } {
  /* 防退化 / 缺失的比例：NaN / 0 / 负数一律回落到 1:1 正方形，
   * 表单拿到的永远是一个有限值。 */
  const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;

  if (typeof presetOrBase === "number") {
    const horizontal = safeRatio >= 1;
    return {
      width: Math.max(
        1,
        Math.round(horizontal ? presetOrBase : presetOrBase * safeRatio),
      ),
      height: Math.max(
        1,
        Math.round(horizontal ? presetOrBase / safeRatio : presetOrBase),
      ),
    };
  }

  if (clarityKindOfLabel(presetOrBase.label) === "resolution") {
    const tier = resolutionTierOfLabel(presetOrBase.label) ?? "1k";
    return resolutionDims(scene, safeRatio, tier, table);
  }

  return megapixelDims(
    safeRatio,
    (presetOrBase.totalPixels ?? 1_000_000) / 1_000_000,
    normalizeAlignMultiple(alignMultiple),
  );
}

/** 由宽高反解最接近的清晰度档（跨分辨率 / 百万像素两个子类）。
 *
 *  用曼哈顿距离比较「该档位经 `dimsForRatio` 还原出来的宽高」与输入的差，
 *  因此正反两个方向必须传同一套 `alignMultiple` / `scene` —— 否则会落在
 *  两个档位之间（用户表现为「选了 1k，回读却高亮 2M」）。平手时按
 *  `DIM_CLARITY_PRESETS` 的声明顺序取第一个（确定性）。 */
export function pickClarityPreset(
  width: number,
  height: number,
  alignMultiple: number = DEFAULT_ALIGN_MULTIPLE,
  scene: SizeScene = "image",
  table?: SizePresetTable,
): DimClarityPreset {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return DIM_CLARITY_PRESETS[0]!;
  }
  const alignM = normalizeAlignMultiple(alignMultiple);
  const ratio = width / height;
  let best: DimClarityPreset = DIM_CLARITY_PRESETS[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const preset of DIM_CLARITY_PRESETS) {
    const { width: dw, height: dh } = dimsForRatio(
      ratio,
      preset,
      alignM,
      scene,
      table,
    );
    const dist = Math.abs(width - dw) + Math.abs(height - dh);
    if (dist < bestDist) {
      best = preset;
      bestDist = dist;
    }
  }
  return best;
}

/* ── 关键字匹配器（名字 + 标签，忽略大小写）── */
function isDimWidth(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (name.includes("width")) return true;
  if (label === "宽度" || label === "横" || label === "横向") return true;
  if (name === "宽") return true;
  return false;
}
function isDimHeight(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  /* NOTE: a bare "高" inside a 画质 label like "高清" must NOT count as the
   *  height pin — we only accept the exact Chinese shape 高度/纵向/纵 or the
   *      *  英文名字，绝不能是某个无关标签的子串。 */
  if (/height|heigth/.test(name)) return true;
  if (label === "高度" || label === "纵" || label === "纵向") return true;
  if (name === "高") return true;
  return false;
}
function isDimAspect(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (/\baspect_ratio\b/.test(name) || /\baspect\b|\bratio\b/.test(name))
    return true;
  if (label === "宽高比" || label.includes("比例") || label.includes("纵横"))
    return true;
  return false;
}
function isDimMegapixels(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = (e.label ?? "").toLowerCase();
  if (name.includes("megapixel")) return true;
  if (label.includes("百万像素") || label.includes("像素")) return true;
  return false;
}
function isDimMultiple(e: EnrichedWidget): boolean {
  const name = (e.name || "").toLowerCase();
  const label = e.label ?? "";
  if (/multiple|upscale_factor|upscale_by|upscale_amount/.test(name))
    return true;
  if (label.includes("倍数") || label.includes("倍率")) return true;
  return false;
}
function isVideoLength(e: EnrichedWidget): boolean {
  const searchText = `${e.name} ${e.label ?? ""}`.toLowerCase();
  return /length|duration|时长|帧数|frames|seconds|秒/.test(searchText);
}
function isVideoAspect(e: EnrichedWidget): boolean {
  const searchText = `${e.name} ${e.label ?? ""}`.toLowerCase();
  return /aspect|ratio|比例|纵横/.test(searchText);
}
function isVideoQuality(e: EnrichedWidget): boolean {
  const searchText = `${e.name} ${e.label ?? ""}`.toLowerCase();
  return /quality|clarity|清晰|画质/.test(searchText);
}

/** 从 widget 清单里认出「尺寸型」的分组。
 *
 *  支持两种范式：
 *    • width + height            → renders the classic "比例 + 清晰度" picker
 *    • aspect_ratio + megapixels → renders a "比例 + 像素" quick picker that
 *      直接写进那两个暴露出来的 widget（如 ResolutionSelector）。
 */
export function inferDimensionGroup(
  widgets: EnrichedWidget[],
): DimensionGroup | null {
  const widthWidgets = widgets.filter(
    (entry) =>
      (entry.control === "int" || entry.control === "float") &&
      isDimWidth(entry),
  );
  const heightWidgets = widgets.filter(
    (entry) =>
      (entry.control === "int" || entry.control === "float") &&
      isDimHeight(entry),
  );
  if (widthWidgets.length > 0 && heightWidgets.length > 0) {
    const width = widthWidgets[0]!;
    const height = heightWidgets[0]!;
    if (width.ioKey === height.ioKey) return null;
    return {
      kind: "dimension",
      groupId: `dim:${width.ioKey}|${height.ioKey}`,
      width,
      height,
    };
  }

  /* ResolutionSelector-style: the user exposed "宽高比" + "百万像素" instead
   *      *  原始的 width/height。这里**不**要求特定的控件种类：这些 pin 通常是
   *      *  COMBO/FLOAT，但 IO 整理时 ComfyUI 离线的话，它们会以无类型的 "text" 到来。 */
  const aspectWidgets = widgets.filter(isDimAspect);
  const mpWidgets = widgets.filter(isDimMegapixels);
  if (aspectWidgets.length > 0 && mpWidgets.length > 0) {
    const aspect = aspectWidgets[0]!;
    const megapixels = mpWidgets[0]!;
    if (aspect.ioKey === megapixels.ioKey) return null;
    /* 倍数（可选伴随）：存在时并入组合 popover 的第三段。 */
    const multiple = widgets.find(
      (w) =>
        w.ioKey !== aspect.ioKey &&
        w.ioKey !== megapixels.ioKey &&
        isDimMultiple(w),
    );
    return {
      kind: "dimension",
      groupId: `aspect-mp:${aspect.ioKey}|${megapixels.ioKey}${multiple ? `|${multiple.ioKey}` : ""}`,
      aspect,
      megapixels,
      multiple,
    };
  }

  return null;
}

/** 从 widget 清单里认出「时长 + 比例 + 质量」的视频分组。 */
export function inferVideoGroup(widgets: EnrichedWidget[]): VideoGroup | null {
  const len = widgets.filter(isVideoLength);
  const asp = widgets.filter(isVideoAspect);
  const quality = widgets.filter(isVideoQuality);
  if (len.length === 0) return null;
  if (asp.length === 0 && quality.length === 0) return null;
  return {
    kind: "video",
    groupId: `video:${len[0]!.ioKey}|${asp[0]?.ioKey ?? ""}|${quality[0]?.ioKey ?? ""}`,
    length: len[0],
    aspect: asp[0],
    quality: quality[0],
  };
}

/** 跑两次推断，并在视频扫描里排除尺寸 pin ——
 *  同一个 widget 永远不会同属两组。返回命中的分组，
 *  以及它们消费掉的完整 ioKey 集合（调用方据此把那些 pin 的通用逐行渲染抑制掉）。 */
export function inferGroups(widgets: EnrichedWidget[]): {
  dimension: DimensionGroup | null;
  video: VideoGroup | null;
  groupedKeys: Set<string>;
} {
  const dimension = inferDimensionGroup(widgets);
  /* 尺寸组可能是 W/H 成对，也可能是别的形态，
   *  the 宽高比 + 百万像素 pair, so collect whichever pins it actually holds
   *  而不是假定一定存在 `width`/`height`。 */
  const dimKeys = new Set<string>();
  if (dimension) {
    if (dimension.width) dimKeys.add(dimension.width.ioKey);
    if (dimension.height) dimKeys.add(dimension.height.ioKey);
    if (dimension.aspect) dimKeys.add(dimension.aspect.ioKey);
    if (dimension.megapixels) dimKeys.add(dimension.megapixels.ioKey);
    if (dimension.multiple) dimKeys.add(dimension.multiple.ioKey);
  }
  const rest = widgets.filter((widget) => !dimKeys.has(widget.ioKey));
  const video = inferVideoGroup(rest);
  const groupedKeys = new Set<string>([...dimKeys]);
  if (video) {
    if (video.length) groupedKeys.add(video.length.ioKey);
    if (video.aspect) groupedKeys.add(video.aspect.ioKey);
    if (video.quality) groupedKeys.add(video.quality.ioKey);
  }
  return { dimension, video, groupedKeys };
}
