/* ── 对外参数 → 工作流节点参数的「映射」模型 ──
 *
 * ISSUE #145 把工作流库里的自定义工作流封装成"只对外暴露提示词/尺寸/参考图"。
 * 但对外参数（工坊侧）与工作流内部真正的 pin 之间，需要一个**作者可编辑**的
 * 对应关系：同一个「提示词」对外口可能落在 CLIPTextEncode.text 或自定义节点的
 * prompt 槽；「尺寸」可能是一对 width/height，也可能是一个 resolution_preset。
 *
 * 本模块只做三件纯事（无 React、无 IO，规范 §17.2 第②层）：
 *   1. `buildParamEntries`  把服务端富化的 workflowIO 归并成「按节点分组的对外
 *      参数条目」——同一节点上的多个 pin 是**同一个对外参数**（提示词 = 一个
 *      节点的一个参数），而不是两行；
 *   2. `autoMapEntries`     给每个对外参数条目**自动**挑一个目标端口（默认连线
 *      状态）。判定顺序即优先级，与工坊封装（workflow-encapsulation）同口径；
 *   3. `applyParamMapping`  把映射落到运行时载荷上（`workflowInputs` 三元组）。
 *
 * 落库位置：沿用既有的 `paramMap` JSON 列，`source` 命名空间下**只按模式**存放
 * 作者连过的线，键写作 `source.mode:<模式>`（值 = `{ <entryId>: ioKey | null }`）。
 *
 * 为什么没有「与模式无关的覆盖」：留一个通用层只会让「这条覆盖到底哪个模式在
 * 生效」变成需要推理的问题，两套键空间互相覆盖也正是丢覆盖的历史根因。因此没有
 * 选中模式时**写入是空操作**，每条覆盖都归属一个模式。
 *
 * 本模块**只产出数据**：条目的落点默认由 `autoMapEntries` 按名字自动判定，
 * 运行期由 `applyParamMapping` 按这张表严格落值。工作流库「画布节点」页签上的
 * 三列 React Flow 节点（卡片列 / 宿主卡片 / 输出卡片列）是同一份数据的视图
 * （`workflow-library-param-cards` + `WorkflowLibraryCanvas`）—— 拖线即编辑
 * 落点，映射没有第二套界面。
 */

import {
  resolveEntryDefault,
  type WorkflowIOEntry,
  type WorkflowIOMap,
} from "~/lib/workflow-io-types";
import {
  exposedParamDisplayLabel,
  exposedParamsForMode,
} from "~/lib/workflow-exposed-params";
import { megapixelsForSize } from "~/lib/workshop/workflow-encapsulation";
import { aspectLabelForDims } from "~/lib/size-presets";

/* ── 对外参数分类 ──
 * 与工坊封装的 WorkshopPinClass 子集 + `other`（尺寸/参考图/提示词之外，
 * 作者自行勾选的对外输入，例如 steps / cfg / 种子）。
 *
 * `other` **不参与对外参数契约**：那是工作流内部参数（步数 / CFG / 采样器…），
 * 对外只按模式给统一的那几个口子 —— 见 `~/lib/workflow-exposed-params`。 */
export type ParamClass =
  | "prompt"
  | "negative"
  /** 契约口径的聚合值：对外只报一个「尺寸」，工作流内部落到宽度 / 高度 /
   *  宽高比 / 像素量 中的哪一种由端口本身决定（见 SIZE_CLASSES）。 */
  | "size"
  | "size-width"
  | "size-height"
  | "size-aspect"
  | "size-megapixels"
  | "reference-image"
  | "first-frame"
  | "last-frame"
  | "duration"
  | "other";

/** 统一「尺寸」在契约里的落点形态 —— 一个对外参数可以落在其中任一类端口上。 */
export const SIZE_CLASSES: readonly ParamClass[] = [
  "size-width",
  "size-height",
  "size-aspect",
  "size-megapixels",
];

/** 一个「对外参数」（= 契约里的一个统一口子，落到工作流的某个端口上）。
 *
 *  `id` 是契约内的稳定键（`prompt` / `size` / `first-frame`…），**不含工作流
 *  信息** —— 同一个「提示词」在所有工作流里都是同一个键，落点由映射表决定。 */
export interface ParamEntry {
  /** 契约内的稳定键（`ExposedParamClass` 或带序号的参考图口）。 */
  id: string;
  /** 该口子落到的端口所属节点（旧聚类路径带；契约路径由候选端口派生，
   *  见 `hostNodeId`）。 */
  nodeId: string;
  /** 承载这个对外参数的**宿主节点 id** —— 库内映射线的宿主端与连线的合法性判定
   *  都以它为准。
   *
   *  契约路径下 `nodeId` 是空串（契约条目与工作流无关），但线仍要落在「这个口
   *  真正落到的那一行所在的节点」上：此前各处一律读 `nodeId`，于是契约路径下
   *  线指向空节点、连线闸门恒定失败 —— 用户表现为「对外参数端点拉不了线」。
   *  宿主 id 从候选端口派生（落点所在节点优先，其次首个候选），是同一份事实的
   *  最近可用近似。 */
  hostNodeId: string;
  nodeTitle: string;
  cls: ParamClass;
  /** 展示名：契约里的统一名（与具体工作流无关）。 */
  label: string;
  /** 该契约口子在当前工作流里的候选端口（ioKey 保持 workflowIO 的原始键）。
   *  自动判定从中挑一个作为默认落点；作者也可以在画布上改成别的端口。 */
  pins: { ioKey: string; name: string; type: string; defaultValue: unknown }[];
}

/** 端口所属的节点 id（ioKey 形如 `<nodeId>::<kind>::<name>`）。
 *
 *  端口名本身**可能含 `::`**，所以只切前两段取节点 id —— 后两段不参与解析。
 *  放在本模块（而不是一个更上层的模块）是因为 `buildParamEntries` 派生宿主节点
 *  id 时也要用它，反向依赖会成环。 */
export function nodeIdOfIoKey(ioKey: string): string {
  const parts = ioKey.split("::");
  return parts.length >= 2 ? parts[0]! : ioKey;
}

/** 分类默认名（作者未改名时用来填充「对外参数名」列）。
 *
 *  对外口（`size` / `reference-image` / …）的措辞取自
 *  `workflow-exposed-params` 的展示名表 —— 无模式语境走的就是这条旧聚类路径，
 *  同一张卡片列在两种语境下说两套话会让用户以为换了口径（ISSUE #596）。
 *  只有 `size-*` 这四个「落点形态」与 `other` 是本路径独有的内部名
 *  （对外聚合为「尺寸」之后它们不该出现在任何**对外**清单里，卡片上出现时
 *  说明这条口子还没被契约收编）。 */
const CLASS_FALLBACK_LABEL: Record<ParamClass, string> = {
  prompt: exposedParamDisplayLabel("prompt"),
  negative: exposedParamDisplayLabel("negative"),
  size: exposedParamDisplayLabel("size"),
  "size-width": "宽度",
  "size-height": "高度",
  "size-aspect": "宽高比",
  "size-megapixels": "像素量",
  "reference-image": exposedParamDisplayLabel("reference-image"),
  "first-frame": exposedParamDisplayLabel("first-frame"),
  "last-frame": exposedParamDisplayLabel("last-frame"),
  duration: exposedParamDisplayLabel("duration"),
  other: "参数",
};

/** 条目名 + 显示名（小写）。
 *
 *  **判据只有这一处事实来源：作者自己写下的名字**（端口名 + 显示名）。这里刻意
 *  不看 `role` 之类的图内推导，也不看节点类名 —— 对外有哪些参数由契约表决定，
 *  工作流只决定每一口落到哪一行（见 `buildParamEntries`）。 */
function searchText(e: WorkflowIOEntry): string {
  return `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();
}

const IMAGE_TYPES = new Set(["IMAGE", "MASK", "IMAGEUPLOAD"]);

/* ── 分类判定 ──
 * 顺序即优先级：负面先于正向，首/尾帧先于普通参考图，尺寸类先于提示词
 * （避免 "width" 之类被泛化的文本启发式抢走）。与工坊封装同口径。 */
const FIRST_FRAME_HINT =
  /first[_\s-]?frame|首帧|起始帧|第一帧|image_?1|start_?image/;
const LAST_FRAME_HINT = /last[_\s-]?frame|尾帧|结束帧|末帧|image_?2|end_?image/;

function isImagePin(e: WorkflowIOEntry): boolean {
  const type = (e.type ?? "").toUpperCase();
  if (IMAGE_TYPES.has(type)) return true;
  return /upload|image|参考图|首帧|尾帧|first_?frame|last_?frame/.test(
    searchText(e),
  );
}

/** 导出给工坊封装复用：把已有对外条目的分类映射到 ParamClass。 */
export function classifyPin(e: WorkflowIOEntry): ParamClass {
  if (e?.direction !== "input" || e.kind !== "widget") return "other";
  const text = searchText(e);
  if (isImagePin(e)) {
    if (LAST_FRAME_HINT.test(text)) return "last-frame";
    if (FIRST_FRAME_HINT.test(text)) return "first-frame";
    return "reference-image";
  }
  if (/negative|负向|负面|反向/.test(text)) return "negative";
  /* 尺寸名必须"干净"——`prompt_width_of_thing` 这类把 width 当词根的名字不算
   * 尺寸口（真实工作流里 width/height 从不带其它业务词）。 */
  if (
    /^(width|base_width|w|宽度|横向)$/.test(text.trim()) ||
    /宽度|横向/.test(text)
  ) {
    return "size-width";
  }
  if (
    /^(height|base_height|h|高度|纵向)$/.test(text.trim()) ||
    /高度|纵向/.test(text)
  ) {
    return "size-height";
  }
  if (/aspect_?ratio|宽高比|纵横比|比例/.test(text)) return "size-aspect";
  if (/megapixel|百万像素|\b像素\b/.test(text)) return "size-megapixels";
  /* 时长 / 帧数：先排掉 fps（帧率不是时长），再认 duration / length / frames
   * 与中文「时长 / 秒数 / 帧数」。视频模式的「时长」口按此落到这类端口上。 */
  if (
    !/fps|frame_?rate|帧率|每秒帧/.test(text) &&
    /duration|length|num_?frames|frame_?count|frames?|时长|秒数|帧数/.test(text)
  ) {
    return "duration";
  }
  if (/prompt|提示词|描述词|描述/.test(text)) return "prompt";
  /* 无类型但默认值很长（>40 字符）的文本一般是提示词框 —— 与工作流库的控件
   * 推导启发式（workflow-encapsulation / workflow-detail-io）保持一致，
   * 否则 CLIPTextEncode 的 `text` 这类"名字不含 prompt"的口会被判成普通参数。 */
  if (
    (e.type ?? "").toUpperCase() === "STRING" &&
    typeof e.defaultValue === "string" &&
    e.defaultValue.length > 40
  ) {
    return "prompt";
  }
  return "other";
}

/** 端口分类 → 契约里的统一参数口子（`null` = 不是对外参数，属工作流内部）。 */
function contractParamFor(cls: ParamClass): string | null {
  if (cls === "other") return null;
  if (isSizeClass(cls)) return "size";
  return cls;
}

/** 该分类是否属于「尺寸」语义（含契约聚合值 `"size"` 本身）。 */
function isSizeClass(cls: ParamClass): boolean {
  return cls === "size" || SIZE_CLASSES.includes(cls);
}

/** 手工拖线的**类型闸门**：该契约口能不能落到这个端口上。
 *
 *  判据与自动落点同源 —— 条目**接受的端口分类**（`candidateClasses`：`size`
 *  对应宽 / 高 / 宽高比 / 像素量，其余各自一类）里必须包含这个端口自己的分类
 *  （`classifyPin`）。自动落点本来就按这套谓词挑端口，手工拖线若不过这道闸门，
 *  就会出现「提示词拖到宽高比也连上了」：写进去的映射运行期根本取不到值，用户
 *  看到的是一条假线（提示词口只有一个 STRING 口，宽高比是 COMBO 尺寸口）。 */
export function pinAcceptsEntry(
  cls: ParamClass,
  ioEntry: WorkflowIOEntry | null | undefined,
): boolean {
  if (!ioEntry) return false;
  const target = classifyPin(ioEntry);
  if (target === "other") return false;
  return candidateClasses(cls).includes(target);
}

/** 某个条目接受哪些端口分类（`"size"` 对应宽/高/宽高比/像素量四种）。 */
export function candidateClasses(cls: ParamClass): readonly ParamClass[] {
  return isSizeClass(cls) ? SIZE_CLASSES : [cls];
}

/** 该契约口子接受的端口分类。 */
function classesForContractParam(param: string): readonly ParamClass[] {
  if (param === "size") return SIZE_CLASSES;
  if (/^reference-image($|-)/.test(param)) return ["reference-image"];
  return [param as ParamClass];
}

/* ── 输出端口 ──
 *
 * 对外参数卡片右侧的端口读作「这个口落到工作流的哪一行」。此前它是一颗**单一**的
 * 无属性圆点，而多候选口子（尺寸 = 宽 / 高 / 宽高比 / 像素量）在未连线时会把候选
 * 逐条列成「输出端口行」—— 于是「尺寸」卡片画出 4 行候选、却只有 1 颗圆点，读作
 * 「尺寸只有一个出口，另外几个候选没端口」（ISSUE #355 复审）。
 *
 * 现在的口径：**输出端口 = 候选落点本身**，一个候选一颗圆点，圆点就是连到那一行
 * 的起点 —— 未连线时四颗点（宽/高/宽高比/像素量各一颗），连线后只剩被落到的那
 * 一颗。类型取自端口自己的声明（同一个「尺寸」口落到 `width` 是 INT、落到
 * `resolution_preset` 就是 COMBO），不看契约名硬编码。
 *
 * 每颗圆点带自己的 handle id：它就是该端口的 **React Flow handle id（= pin 名）**
 * —— 落库与运行期用的 ioKey 经 `ioKeyForHandle` 翻回来（两个键空间不能混，
 * 见 ISSUE #374）。未连线的候选没有连线，handle 仍是端口名，连上即落库。
 */

/** 单条输出端口的展示形态（纯数据，视图只负责画）。 */
export interface ParamOutputPort {
  /** 端口自身的名字（落到哪个 pin）。 */
  name: string;
  /** 声明类型（大写，如 STRING / INT / COMBO）；未知为 `*`。 */
  type: string;
  /** 是否已经落到了工作流里真实存在的端口。 */
  connected: boolean;
  /** 该端口对应的 ioKey（工作流内部键；`""` = 端口本身不存在，占位用）。 */
  ioKey: string;
  /** React Flow 的 handle id —— 连线的起点标识。
   *  画布上等于**该端口的 ioKey**（与宿主行 handle 同名）；库里那层只读连线按
   *  端口名找锚点，故两者都用得到。 */
  handleId: string;
  /** 是否为**当前生效落点**（连线即连到它；未连线时是自动判定会挑中的那个）。 */
  active: boolean;
}

/** 一枚标签/端口的类型展示名：声明类型原样大写，缺省 `*`。 */
export function portTypeDisplay(type: string | undefined | null): string {
  const t = (type ?? "").trim().toUpperCase();
  return t.length > 0 ? t : "*";
}

/** 未连线时的端口名：契约展示名（卡片上不谎报成一个不存在的 pin 名）。 */
function fallbackHandleId(entry: ParamEntry): string {
  return entry.id || entry.label;
}

/** 一个对外参数卡片的**输出端口**（每个候选落点一颗，见上方说明）。
 *
 *  `resolvedTarget` = 该口子当前生效的落点 ioKey（作者连过的优先，否则自动判定）：
 *  · 有落点 → 只给一颗点（连到哪就只连得到哪，避免一张卡画出多条线）；
 *  · 无落点 → 逐个列出候选端口，每颗点连同名的 handle。
 *
 *  未连线且一个候选都没有（工作流里没有可落点的端口）时给一条占位端口，卡片仍
 *  画得出端点 —— `handleId` 退到契约名，`ioKey` 为空（没有可落的地方）。 */
export function paramOutputPorts(
  entry: ParamEntry,
  io: WorkflowIOMap | null | undefined,
  resolvedTarget: string | null | undefined,
  reachableKeys?: ReadonlySet<string>,
): ParamOutputPort[] {
  const toPort = (
    ioKey: string,
    name: string,
    type: string | undefined,
    connected: boolean,
    active: boolean,
  ): ParamOutputPort => ({
    name: name || entry.label,
    type: portTypeDisplay(type),
    connected,
    ioKey,
    /* 库内连线层按「端口名」找圆点锚点（一张卡上一个候选一颗点），所以 handle id
     * 取端口名；落点本身仍是 ioKey 键空间（`ioKey` 字段），两者不能混。 */
    handleId: name || fallbackHandleId(entry),
    active,
  });

  const target = resolvedTarget ?? null;
  /* **每个候选端口一颗圆点**（不论当前有没有落点）：同一张「尺寸」卡片要把
   *  宽 / 高 / 宽高比 / 像素量各自的出口都摆出来，作者拖哪一颗就连到
   *  哪个候选（ISSUE #355：「尺寸这里不是有多个输出端口吗，现在怎么还是一个
   *  比例」）。只列「当前生效落点」那一颗的话，卡片上就只剩一根线可以拉，
   *  其余候选连端点都没有。
   *
   *  `reachableKeys` 给的是「宿主卡片上真的画得出来、连得上的那一行」的 ioKey
   *  集合（组合控件折叠成逐行参数之后，露出来的行就是全部可连行）。给定时只列
   *  这些候选 —— 端点画在一颗落不上去的句柄上，拖过去只会被闸门判成非法，用户
   *  看到的就是「点击端点拉线出现禁用标记」。集合缺省（调用方拿不到宿主表单的
   *  折叠结果）时保持原样，不擅自藏候选。
   *
   *  生效落点若不在候选里（历史数据 / 端口已从 IO 里移除）也要补一颗并标 active
   *  —— 否则「当前落点」在卡片上凭空消失，读者答不出这个口现在连着哪。 */
  const candidates =
    reachableKeys && reachableKeys.size > 0
      ? entry.pins.filter((pin) => reachableKeys.has(pin.ioKey))
      : entry.pins;
  const targetRaw = target ? io?.[target] : undefined;
  const targetInCandidates =
    !!target && candidates.some((pin) => pin.ioKey === target);
  if (candidates.length > 0) {
    const ports = candidates.map((pin) =>
      toPort(pin.ioKey, pin.name, pin.type, true, pin.ioKey === target),
    );
    if (target && targetRaw && !targetInCandidates) {
      ports.unshift(toPort(target, targetRaw.name, targetRaw.type, true, true));
    }
    return ports;
  }
  /* 连候选都没有：有生效落点时仍给那一颗（如实呈现当前落点），否则退到占位
   * 端口 —— 卡片始终画得出端点。 */
  if (target && targetRaw) {
    return [toPort(target, targetRaw.name, targetRaw.type, true, true)];
  }
  /* ③ 连候选都没有：占位端口，卡片仍画得出端点（没有可落的地方）。 */
  return [toPort("", entry.label, undefined, false, false)];
}

/** 一个对外参数当前**接到哪些端口**（默认状态可以是「一对多」）。
 *
 *  为什么不是一个端口：像「尺寸」这样的对外参数**由多个端口共同组成** ——
 *  宽高比 / 像素量由同一块组合控件录入（`inferGroups` 的 `groupedKeys`），
 *  宽 / 高同理。默认状态下这几个端口都取自这一个对外参数，画面上就该各有一条线；
 *  只画「自动判定挑中的那一个」会让「尺寸」看着只有一个出口
 *  （ISSUE #355：「尺寸现在有三个参数，就应该可以连三条线出来」）。
 *
 *  作者手工指定落点后**只画他指定的那一条**：手工落点意味着该模式下这个口只往
 *  那一个端口供值（运行期 `applyParamMapping` 同口径），其余端口回到工作流自身
 *  的默认值 —— 这时再画线就是谎报。
 *
 *  `active` 标出「自动判定挑中的那个 / 作者指定的那个」，供卡片上的实心圆点使用。 */
export function wiredTargetsForEntry(args: {
  entry: ParamEntry;
  /** workflowIO：判定候选端口是否真的存在（候选可能来自过期的 IO 快照）。 */
  io?: WorkflowIOMap | null | undefined;
  /** 当前模式下这个条目的落点（`resolveMapping` 的结果；`null` = 未连线/断开）。 */
  target: string | null | undefined;
  /** 作者是否手工改过这个口（`isDefaultMappingForEntry` 的取反）。 */
  manual: boolean;
  /** 组合控件覆盖到的端口（`inferGroups(...).groupedKeys`）；缺省时不做一对多。 */
  groupedKeys?: ReadonlySet<string>;
  /** 是否**连每一个候选端口都算一条线**（视图侧口径，与运行期无关）。
   *
   *  缺省 `false` = 只报「当前生效落点」那一个（运行期派值、编辑器连线用这个
   *  口径：手工落点意味着该口只往那一个端口供值）。给 `true` 时把该条目全部
   *  可落点逐个报出来 —— 库内画布卡片给每个候选都画了圆点（每个都能拖线改落点），
   *  线就该逐条画出来；点有、线没有，读作「这几项没接上」（ISSUE #355：「宽高比
   *  和百万像素这两项都需要能导入到工作流中，2 条线都要能连出去」）。 */
  allCandidates?: boolean;
}): { ioKey: string; active: boolean }[] {
  const { entry, io, target, manual, groupedKeys, allCandidates } = args;
  /* 视图口径：不挑「当前落点」，把候选逐个报出来（落在哪个哪个就是 active）。 */
  if (allCandidates) {
    const candidates = (
      io ? entry.pins.filter((pin) => !!io[pin.ioKey]) : entry.pins
    ).map((pin) => ({ ioKey: pin.ioKey, active: pin.ioKey === target }));
    /* 生效落点不在候选里（历史数据 / 端口已从 IO 移除）也要补一条并标 active
     *  —— 否则「当前落点」在图上凭空消失，读者答不出这个口现在连着哪。 */
    if (target && !candidates.some((c) => c.ioKey === target))
      candidates.unshift({ ioKey: target, active: true });
    return candidates;
  }
  if (!target) return [];
  if (manual) return [{ ioKey: target, active: true }];
  /* 落点落在组合控件里 → 该控件覆盖、且属于这个条目的端口全都算「接上了」。
   *  候选端口取自条目的 pins；给了 io 时只保留真的存在的那些（过期快照里的
   *  端口画不出线来）。 */
  if (groupedKeys?.has(target)) {
    const siblings = entry.pins.filter(
      (pin) => groupedKeys.has(pin.ioKey) && (!io || !!io[pin.ioKey]),
    );
    const keys =
      siblings.length > 0 ? siblings.map((pin) => pin.ioKey) : [target];
    if (!keys.includes(target)) keys.unshift(target);
    return keys.map((ioKey) => ({ ioKey, active: ioKey === target }));
  }
  return [{ ioKey: target, active: true }];
}

/** 某个条目在某个 ioKey 上「用哪个 handle 连」——库内画布卡片按**端口名**给
 *  圆点打锚点（`paramOutputPorts` 的 `handleId`），所以连线也必须按端口名对齐
 *  那一颗点，否则同一个条目下多条线会全部落到第一颗点上。 */
export function wireHandleIdForIoKey(
  io: WorkflowIOMap | null | undefined,
  entry: ParamEntry,
  ioKey: string,
): string {
  return (
    io?.[ioKey]?.name ??
    entry.pins.find((pin) => pin.ioKey === ioKey)?.name ??
    ioKey
  );
}

/** 该对外参数在某个模式下的**默认落点端口**（`auto`）。
 *
 *  默认连线的端点排在候选第一位，颜色与实心点一致；作者改过落点后第一颗就是
 *  他连的那颗。缺省（没有模式语境）时退到候选首项。 */
export function defaultOutputPortIndex(
  ports: readonly ParamOutputPort[],
): number {
  const index = ports.findIndex((port) => port.active);
  return index >= 0 ? index : 0;
}

/** 把 IO 条目聚合成**统一对外参数**条目（顺序 = 契约顺序，与工作流无关）。
 *
 *  此前这里是「按节点 + 分类」聚类 —— 结果是一份**跟着工作流走**的清单：同一个
 *  「提示词」在不同工作流里叫 `text` / `positive_prompt` / `value_1`，卡片列表于是
 *  变成工作流内部参数名的大杂烩（`value` / `value_2` / `resolution_preset`…）。
 *  现在条目来自契约表（`exposedParamsForMode`）：对外有哪些参数只跟模式有关，
 *  工作流只决定「每个统一参数落到哪一行端口」。
 *
 *  · `mode` 给出时按契约过滤：契约里没有的口子（步数 / CFG / 采样器…）一律不出现；
 *  · **契约口一律常驻**：契约列了哪些对外参数就返回哪些，工作流能不能承接是
 *    **落点**问题（`pins` 为空 ⇒ 如实显示成「未配置」），不是「这一口存不存在」
 *    的问题。这里不判断工作流的能力；
 *  · 不传 `mode` 时保持旧的「按节点 + 分类」聚类（供没有模式语境的调用方使用）。
 */
export function buildParamEntries(
  io: WorkflowIOMap | null | undefined,
  labels?: Record<string, string>,
  options?: { mode?: string | null },
): ParamEntry[] {
  if (options != null && "mode" in options) {
    return buildContractEntries(io, labels, options.mode ?? null);
  }
  return buildLegacyEntries(io, labels);
}

/** 契约驱动的条目构造（有模式语境时的唯一路径）。 */
function buildContractEntries(
  io: WorkflowIOMap | null | undefined,
  labels: Record<string, string> | undefined,
  mode: string | null,
): ParamEntry[] {
  const pinsByClass = classifyPins(io);

  const out: ParamEntry[] = [];
  for (const def of exposedParamsForMode(mode)) {
    const pins = classesForContractParam(def.id).flatMap(
      (cls) => pinsByClass.get(cls) ?? [],
    );
    if (out.some((entry) => entry.id === def.id)) continue;
    const override = pins.map((pin) => labels?.[pin.ioKey]).find(Boolean);
    out.push({
      id: def.id,
      /* 落点由映射表决定，`nodeId` 不带宿主节点（分组展示不需要它）。 */
      nodeId: "",
      /* 卡片挂载 / 连线需要宿主节点 id：取候选端口所属的节点（首个候选）。
       * 契约条目跨节点的情况不存在（一个口子落到一个节点的某一行），首个候选
       * 即最近可用近似。 */
      hostNodeId: nodeIdOfIoKey(pins[0]?.ioKey ?? ""),
      nodeTitle: "",
      cls: def.cls,
      label: override ?? def.label,
      pins,
    });
  }
  return out;
}

/** 工作流里**可对外落点**的输入口，按分类归拢（同一分类可命中多个端口）。
 *
 *  这是「这个工作流能承接什么」的**唯一**判定处，只回答一个事实问题：某个
 *  对外参数现在能落到哪几行上。它不参与「对外有哪些参数」的决策 —— 那是契约表
 *  的事（`exposedParamsForMode`），判据里不含任何推导。 */
function classifyPins(
  io: WorkflowIOMap | null | undefined,
): Map<ParamClass, ParamEntry["pins"]> {
  const pinsByClass = new Map<ParamClass, ParamEntry["pins"]>();
  for (const [ioKey, raw] of Object.entries(io ?? {})) {
    const entry = raw as WorkflowIOEntry | undefined;
    if (entry?.direction !== "input" || entry.kind !== "widget") continue;
    const cls = classifyPin(entry);
    if (cls === "other") continue;
    const list = pinsByClass.get(cls) ?? [];
    list.push({
      ioKey,
      name: entry.name,
      type: entry.type ?? "*",
      defaultValue: entry.defaultValue,
    });
    pinsByClass.set(cls, list);
  }
  return pinsByClass;
}

/** 无模式语境下的旧聚类（按节点 + 分类）—— 只有拿不到模式的调用方会走这里。 */
function buildLegacyEntries(
  io: WorkflowIOMap | null | undefined,
  labels?: Record<string, string>,
): ParamEntry[] {
  const byNode = new Map<string, { entry: ParamEntry; order: number }>();
  let order = 0;
  for (const [ioKey, raw] of Object.entries(io ?? {})) {
    const entry = raw as WorkflowIOEntry | undefined;
    if (entry?.direction !== "input" || entry.kind !== "widget") continue;
    const cls = classifyPin(entry);
    const key = `${entry.nodeId}|${cls}`;
    const pin = {
      ioKey,
      name: entry.name,
      type: entry.type ?? "*",
      defaultValue: entry.defaultValue,
    };
    const existing = byNode.get(key);
    if (existing) {
      existing.entry.pins.push(pin);
      if (entry.displayOrder !== undefined)
        existing.order = Math.min(existing.order, order);
      continue;
    }
    const override = labels?.[ioKey];
    byNode.set(key, {
      order,
      entry: {
        id: key,
        nodeId: entry.nodeId,
        hostNodeId: entry.nodeId,
        nodeTitle: entry.nodeTitle ?? "",
        cls,
        label: override ?? entry.label ?? CLASS_FALLBACK_LABEL[cls],
        pins: [pin],
      },
    });
    order += 1;
  }
  return [...byNode.values()]
    .sort((a, b) => a.order - b.order)
    .map((item) => item.entry);
}

/* ── 自动映射 ──
 * 每个对外参数条目自动挑一个目标端口。工坊封装的启发式只认「提示词 / 尺寸 /
 * 参考图」三样，这里补齐「其他」分类：优先落在**该节点上已有默认值**的标量口
 * （作者勾出来就是想让它可调），否则退回该节点上第一个标量口。 */
const AUTO_MAPPABLE: Record<ParamClass, (e: WorkflowIOEntry) => boolean> = {
  prompt: (e) => /prompt|提示词|描述词/i.test(searchText(e)),
  negative: (e) => /negative|负向|负面|反向/i.test(searchText(e)),
  /* 聚合值本身不参与逐端口判定（真正跑的是 SIZE_CLASSES 里的四个分类）。 */
  size: () => false,
  "size-width": (e) =>
    /^(width|base_width|w|宽度|横向)$/.test(searchText(e).trim()),
  "size-height": (e) =>
    /^(height|base_height|h|高度|纵向)$/.test(searchText(e).trim()),
  "size-aspect": (e) => /aspect_?ratio|宽高比|纵横比|比例/.test(searchText(e)),
  "size-megapixels": (e) => /megapixel|百万像素|\b像素\b/.test(searchText(e)),
  "reference-image": (e) => isImagePin(e),
  "first-frame": (e) => isImagePin(e),
  "last-frame": (e) => isImagePin(e),
  duration: (e) =>
    !/fps|frame_?rate|帧率|每秒帧/.test(searchText(e)) &&
    /duration|length|num_?frames|frame_?count|frames?|时长|秒数|帧数/.test(
      searchText(e),
    ),
  other: () => true,
};

/** 一个端口是否可直接接标量值（连线型端口不可作为对外参数的落点）。 */
function isScalarPin(i: { type: string }): boolean {
  const t = (i.type ?? "").toUpperCase();
  if (!t || t === "*") return true;
  return !new Set([
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
  ]).has(t);
}

/** 自动映射：每个对外参数 → 目标端口（默认连线状态，可被手工覆盖）。 */
export function autoMapEntries(
  entries: readonly ParamEntry[],
  io: WorkflowIOMap | null | undefined,
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const entry of entries) {
    let chosen: string | null = null;
    /* 契约聚合口子（`size`）本身不是一个分类：候选端口来自它接受的若干分类
     *  （宽 / 高 / 宽高比 / 像素量），逐个按各自的名字启发式判定。 */
    const predicates = candidateClasses(entry.cls).map(
      (cls) => AUTO_MAPPABLE[cls] ?? (() => false),
    );
    for (const pin of entry.pins) {
      const raw = io?.[pin.ioKey];
      if (!raw || !isScalarPin(pin)) continue;
      if (predicates.some((predicate) => predicate(raw))) {
        chosen = pin.ioKey;
        break;
      }
    }
    /* 分类启发式没命中（脚本/自定义工作流的 pin 名不按套路来）时，退回到
     * 「该节点上第一个已有默认值的标量口」——默认连线状态仍然可用，
     * 而不是空着让作者从零手工连。 */
    if (!chosen) {
      const withDefault = entry.pins.find((pin) => {
        const raw = io?.[pin.ioKey];
        return (
          raw &&
          isScalarPin(pin) &&
          resolveEntryDefault(raw, null) !== undefined
        );
      });
      chosen = (withDefault ?? entry.pins.find(isScalarPin))?.ioKey ?? null;
    }
    map[entry.id] = chosen;
  }
  return map;
}

/* ── 历史键的兼容读取 ──
 *
 * 统一参数表的键曾经是 `<节点 id>|<分类>`（`5|size-width`）——那是「按工作流
 * 聚类」时代的产物。现在键变成契约口子（`size` / `prompt`…），作者当年连过的
 * 线若只按新键去查会落空，表现就是「改了落点没生效」（不报错，静默回到自动）。
 * 因此解析映射时把旧键一并当作候选：只读、不写，落库一律用新键。 */
function legacyEntryIds(entry: ParamEntry): string[] {
  const nodeIds = new Set<string>();
  if (entry.nodeId) nodeIds.add(entry.nodeId);
  for (const pin of entry.pins) {
    const raw = pin.ioKey.split("::")[0];
    if (raw) nodeIds.add(raw);
  }
  const classes = candidateClasses(entry.cls);
  const out: string[] = [];
  for (const nodeId of nodeIds) {
    for (const klass of classes) out.push(`${nodeId}|${klass}`);
  }
  return out;
}

/** 某个条目在当前模式下的手工线（新键优先，其次历史键）。 */
function manualTargetForEntryRaw(
  manual: Record<string, string | null> | undefined,
  entry: ParamEntry,
): { found: boolean; target: string | null } {
  if (!manual) return { found: false, target: null };
  if (Object.prototype.hasOwnProperty.call(manual, entry.id)) {
    return { found: true, target: manual[entry.id] ?? null };
  }
  for (const legacy of legacyEntryIds(entry)) {
    if (Object.prototype.hasOwnProperty.call(manual, legacy)) {
      return { found: true, target: manual[legacy] ?? null };
    }
  }
  return { found: false, target: null };
}

/* ── 映射的应用（运行期） ── */

/** `source` 命名空间里按模式存放手工线时的键前缀（`mode:T2I`）。 */
export const MODE_KEY_PREFIX = "mode:";

/** 逐模式映射：模式码 → (对外参数 id → 目标 ioKey)。空对象 = 各模式用同一张图。 */
export type ParamMappingByMode = Record<string, Record<string, string | null>>;

export interface ParamMapping {
  /** 作者画的线，按模式分开（`{ [mode]: { [entryId]: ioKey | null } }`）。 */
  manualByMode?: ParamMappingByMode;
  /** 服务端富化时算出的**默认连线状态**（`entryId → ioKey`）。
   *
   *  它不是持久化字段，也不参与序列化：读取时由 `buildParamEntries` +
   *  `autoMapEntries` 现算一份填进来。存在的意义是让「解析 / 应用 / 展示」
   *  三处共用同一份自动映射结果 —— 自动映射依赖 workflowIO，而后者由调用方
   *  单独持有，统一在这里收口可以避免各层各算一遍、算出不一致的默认线。 */
  auto?: Record<string, string | null>;
  /** 作者改过的「对外参数名」（ioKey → 名字）。 */
  labels?: Record<string, string>;
}

/** 解析某一模式下生效的「对外参数 id → 目标 ioKey」表。
 *
 *  优先级：该模式作者画的线（含显式 `null` = 断开） > 默认连线状态（自动映射）。
 *  `manualByMode` 的形状是 `{ [mode]: { [entryId]: ioKey | null } }` —— 按
 *  **模式**归拢，与落库的 `source.mode:<模式>` 一一对应；查一次即得该模式下
 *  所有被作者改过的线。 */
export function resolveMapping(
  entries: readonly ParamEntry[],
  io: WorkflowIOMap | null | undefined,
  mapping: ParamMapping | null | undefined,
  mode?: string | null,
): Record<string, string | null> {
  const auto = mapping?.auto ?? autoMapEntries(entries, io);
  const out: Record<string, string | null> = { ...auto };
  const manual: Record<string, string | null> = mode
    ? (mapping?.manualByMode?.[mode] ?? {})
    : {};
  for (const entry of entries) {
    const hit = manualTargetForEntryRaw(manual, entry);
    if (hit.found) out[entry.id] = hit.target;
  }
  return out;
}

/** 某个对外参数在指定模式下作者画的线；没有则返回 `undefined`。
 *  `null` 表示作者显式断开，必须与「没有手工线」区分开。
 *  没有模式时一律返回 `undefined` —— 不存在脱离模式的手工线（见文件头注释）。 */
export function manualTargetFor(
  mapping: ParamMapping | null | undefined,
  entryId: string,
  mode?: string | null,
): string | null | undefined {
  if (!mode) return undefined;
  const byEntry = mapping?.manualByMode?.[mode];
  if (byEntry && Object.prototype.hasOwnProperty.call(byEntry, entryId)) {
    return byEntry[entryId] ?? null;
  }
  return undefined;
}

/** 从持久化的 `paramMap` 反序列化映射。
 *
 *  只认 `source.mode:<模式> = { <entryId>: ioKey | null }` 这一种形状（与
 *  serializeParamMapping 一一对应）。没有 `mode:` 前缀的键（通用手工线的历史
 *  形状，如 `source.<entryId>`）一律**丢弃**：那些无模式的线在新模型里没有
 *  生效语境，留着只会让「这条线哪个模式用」无从判定。
 *
 *  畸形数据（数字 / 数组 / 非对象模式表）同样丢弃——画布容不下脏数据。 */
export function parseParamMapping(paramMap: unknown): ParamMapping {
  const out: ParamMapping = { manualByMode: {}, labels: {} };
  if (!paramMap || typeof paramMap !== "object" || Array.isArray(paramMap))
    return out;
  const sourceRaw = (paramMap as Record<string, unknown>).source;
  if (!sourceRaw || typeof sourceRaw !== "object" || Array.isArray(sourceRaw))
    return out;
  for (const [key, value] of Object.entries(
    sourceRaw as Record<string, unknown>,
  )) {
    if (!key.startsWith(MODE_KEY_PREFIX)) continue;
    const mode = key.slice(MODE_KEY_PREFIX.length);
    if (!mode) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const byEntry: Record<string, string | null> = {};
    for (const [entryId, target] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof target === "string") byEntry[entryId] = target;
      /* 显式的 null = 作者把这条线断开了，属于合法状态。 */
      else if (target === null) byEntry[entryId] = null;
    }
    if (Object.keys(byEntry).length > 0) out.manualByMode![mode] = byEntry;
  }
  return out;
}

/** 把映射序列化回 `paramMap` 可落库的形状。
 *
 *  按模式归拢写 `source.mode:<模式> = { <entryId>: ioKey | null }`；`null`
 *  表示该模式下作者显式断开，必须一起落库，否则刷新后会被自动映射复活。
 *  `source` 之外的键原样保留（paramMap 里还有 positiveNode 等其它命名空间）。 */
export function serializeParamMapping(
  mapping: ParamMapping,
  paramMap: Record<string, unknown>,
): Record<string, unknown> {
  const source: Record<string, unknown> = {};
  for (const [mode, byEntry] of Object.entries(mapping.manualByMode ?? {})) {
    const targets: Record<string, string | null> = {};
    for (const [id, target] of Object.entries(byEntry ?? {})) {
      if (typeof target !== "string" && target !== null) continue;
      targets[id] = target;
    }
    if (Object.keys(targets).length > 0)
      source[`${MODE_KEY_PREFIX}${mode}`] = targets;
  }
  return { ...paramMap, source };
}

/* ── 默认连线状态的判定（画布上的「恢复默认」与默认线） ── */

/** 某个对外参数在指定模式下**是否还是默认连线状态**（作者没画过线）。
 *
 *  用于画布节点上的「恢复默认」：只该在作者改过线时可用，否则按钮点了没变化。 */
export function isDefaultMapping(
  mapping: ParamMapping | null | undefined,
  entryId: string,
  mode?: string | null,
): boolean {
  return manualTargetFor(mapping, entryId, mode) === undefined;
}

/** 同 `manualTargetFor`，但按**条目**查（含历史键兼容读取）。
 *
 *  画布上的卡片拿到的是一条 `ParamEntry` 而不是一个裸 id，用它查才能把
 *  「当年按 `<节点>|<分类>` 落库的线」也算进来 —— 否则作者改过的落点在契约改版
 *  后会静默回到自动判定。 */
export function manualTargetForEntry(
  mapping: ParamMapping | null | undefined,
  entry: ParamEntry,
  mode?: string | null,
): string | null | undefined {
  if (!mode) return undefined;
  const hit = manualTargetForEntryRaw(mapping?.manualByMode?.[mode], entry);
  return hit.found ? hit.target : undefined;
}

/** 同 `isDefaultMapping`，但按条目查（含历史键兼容读取）。 */
export function isDefaultMappingForEntry(
  mapping: ParamMapping | null | undefined,
  entry: ParamEntry,
  mode?: string | null,
): boolean {
  return manualTargetForEntry(mapping, entry, mode) === undefined;
}

/** 该模式下是否有任何对外参数被作者改过线（画布级的「恢复默认」开关依据）。 */
export function hasManualWiring(
  mapping: ParamMapping | null | undefined,
  mode?: string | null,
): boolean {
  if (!mode) return false;
  return Object.keys(mapping?.manualByMode?.[mode] ?? {}).length > 0;
}

/** 清掉指定模式下作者画的全部线，其余模式原样保留。
 *  落库后 `source.mode:<模式>` 整条消失，该模式的每个对外参数回到默认连线状态。 */
export function clearModeWiring(
  mapping: ParamMapping | null | undefined,
  mode?: string | null,
): ParamMapping {
  const out: ParamMapping = {
    manualByMode: { ...(mapping?.manualByMode ?? {}) },
    labels: { ...(mapping?.labels ?? {}) },
  };
  if (out.auto) out.auto = mapping?.auto;
  if (mode) delete out.manualByMode![mode];
  return out;
}

/** 从已有的 workflowIO 反查某个端口的对外参数 id（用于把旧数据接进新模型）。 */
export function entryIdForPin(
  io: WorkflowIOMap | null | undefined,
  ioKey: string,
): string | null {
  const raw = io?.[ioKey];
  if (!raw) return null;
  return contractParamFor(classifyPin(raw));
}

/** 映射落点（`resolved` 的值，= ioKey）→ 画布渲染侧那条端口的 **React Flow
 *  handle id**。
 *
 *  ⚠️ 现状：画布渲染侧**直接用 ioKey 当 handle id**（见 WidgetInputRow 的
 *  `handleId`）。`pin 名` 这个旧口径在「两个节点
 *  有同名 pin」时会让边接到同名 handle 的第一处 —— 表现就是「线连到了别的节点
 *  上」。库里那层（`wireHandleIdForIoKey`）按 pin 名给卡片圆点取 handle id，
 *  画布手势一律走 ioKey。
 *
 *  两个键空间必须分清（ISSUE #374）：
 *   · ioKey（`<nodeId>::<kind>::<name>`）是 workflowIO 的字典键，运行期
 *     `io[target]` 回查靠它，落库的 `paramMap.source.mode:<模式>` 也存它；
 *   · handle id 是节点卡片上 `<Handle id=…>` 的 DOM id，画布渲染统一取
 *     **pin 名**（= `WorkflowIOEntry.name`）。
 *  谁拿错一方都查不到：React Flow 在 `handleBounds` 里找不到边引用的 id 时，
 *  会丢弃整条边并逐条打 error#008（用户看到的是「线画不出来」）；拿端口名去
 *  查条目表则必然落空，表现为手势被静默拒绝。
 *
 *  `ioKey` 末尾的 `name` 段不保证可切分（pin 名本身可能含 `::`），所以一律
 *  经 `io` 反查 `entry.name`，而不是对字符串做 split。查不到（条目已被移除 /
 *  io 未就绪）时返回 null，调用方据此不画线。 */
export function handleIdForIoKey(
  io: WorkflowIOMap | null | undefined,
  ioKey: string | null | undefined,
): string | null {
  if (!ioKey) return null;
  const name = io?.[ioKey]?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/** `handleIdForIoKey` 的逆：某个节点上的 **handle id（pin 名）** → ioKey。
 *
 *  画布手势拿到的 `connection.targetHandle` 是渲染侧的 pin 名，而落库与运行期
 *  都用 ioKey，写入前必须翻回来（ISSUE #374）。同名端口取**第一个**命中的
 *  ioKey（`buildParamEntries` 已按 nodeId 聚类，同节点同名 pin 属于异常数据，
 *  任取其一都可稳定复现）。 */
export function ioKeyForHandle(
  io: WorkflowIOMap | null | undefined,
  nodeId: string,
  handleId: string | null | undefined,
): string | null {
  if (!nodeId || !handleId) return null;
  for (const [ioKey, entry] of Object.entries(io ?? {})) {
    if (entry?.nodeId === nodeId && entry.name === handleId) return ioKey;
  }
  return null;
}

/** 目标端口 → 源节点 id 的覆盖表（落库到 paramMap.source）。
 *  消费方（后端 buildCustomWorkflow）据此把「该端口的实参来自哪个对外参数」
 *  解析出来，从而不覆盖工作流图上原有的连线。null 表示作者显式断开了这条线。 */
export function buildSourceOverrides(
  entries: readonly ParamEntry[],
  io: WorkflowIOMap | null | undefined,
  mapping: ParamMapping | null | undefined,
  mode?: string | null,
): Record<string, string | null> {
  const resolved = resolveMapping(entries, io, mapping, mode);
  const out: Record<string, string | null> = {};
  for (const entry of entries) {
    if (!Object.prototype.hasOwnProperty.call(resolved, entry.id)) continue;
    out[entry.id] = resolved[entry.id] ?? null;
  }
  return out;
}

export interface MappedInput {
  nodeId: string;
  name: string;
  value: unknown;
}

/** 运行期节点 id：库内 `nodeId` 是「勾选所在视图的节点 id」。
 *
 *  · 顶层勾选：`nodeId` 就是顶层节点 id（`4`），原样下发；
 *  · 子图内部勾选：`nodeId` 是内部节点 id（`1670`），而 comfy-cli 展开子图后
 *    真实节点 id 是宿主 id + 内部 id 的拼接（`4:1670`）——此时用落库的
 *    `hostNodeId` 拼出 `host:inner`。
 *
 *  之所以要把宿主 id 一起存下来，而不是运行期「拿裸 id 去所有子图定义里扫
 *  一遍」：后者在同名内部 id 或子图定义缺失时会静默失效（表现为「改了参数
 *  没生效」），拼出来的 id 才是确定性事实。 */
export function runtimeNodeId(entry: {
  nodeId: string;
  hostNodeId?: string;
}): string {
  /* 已经是拼接形式（旧数据或嵌套场景已带冒号）→ 不重复拼。 */
  if (entry.nodeId.includes(":") || !entry.hostNodeId) return entry.nodeId;
  return `${entry.hostNodeId}:${entry.nodeId}`;
}

/** 把**一个对外值**派生成某个端口自己认的形状（「尺寸」这类一对外参数接多端口时用）。
 *
 *  外部给出的「尺寸」是 `"832x1216"` 这样的像素串；落到工作流的 `width` 上就是
 *  832，落到 `aspect_ratio` 上就得是它自己声明的那个比例标签，落到 `megapixels`
 *  上则是 0.9 这样的百万像素数。各落点形状不同、值也不同 —— 直接照抄像素串会
 *  被 ComfyUI 判成非法选项（表现为「改了没生效」）。
 *
 *  非「尺寸」的口子原样透传（提示词 / 首帧这类值在所有落点上同形）。
 *  端口形状算不出（比例不在候选里等）时返回 `undefined`，调用方按默认值兜底。 */
function sizeValueForPin(
  io: WorkflowIOMap | null | undefined,
  entry: ParamEntry,
  ioKey: string,
  supplied: unknown,
): unknown {
  if (entry.cls !== "size") return supplied;
  const raw = io?.[ioKey];
  if (!raw) return supplied;
  const dims = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(String(supplied).trim());
  if (!dims) return supplied;
  const width = Number(dims[1]);
  const height = Number(dims[2]);
  switch (classifyPin(raw)) {
    case "size-width":
      return width;
    case "size-height":
      return height;
    case "size-aspect": {
      const label = aspectLabelForDims(width, height, raw.options);
      return label ?? undefined;
    }
    case "size-megapixels": {
      const mp = megapixelsForSize(width, height, raw.defaultValue);
      return mp ?? undefined;
    }
    default:
      /* 落点不是尺寸类端口（工作流的自定义 pin）：原样透传，由工作流自己解释。 */
      return supplied;
  }
}

/** 把映射落到运行时载荷：对外值 → `workflowInputs` 三元组。
 *
 *  · 有映射：只覆盖被映射的那个口（作者显式画的线说了算，避免把整节点默认值
 *    硬塞进去盖掉图内其它逻辑）；
 *  · 没映射（未连线）：该节点全部标量口按默认值兜底 —— 与旧
 *    `toWorkflowInputsPayload` 的「暴露 pin 全量下发」行为等价，
 *    按节点聚类后不会重复下发；用户已显式给值的对外口不参与兜底。 */
export function applyParamMapping(args: {
  io: WorkflowIOMap | null | undefined;
  entries: readonly ParamEntry[];
  mapping: ParamMapping | null | undefined;
  values: Record<string, unknown>;
  mode?: string | null;
  /** 组合控件覆盖到的端口（`inferGroups(...).groupedKeys`）。
   *
   *  带「尺寸」这类一对外参数对多端口的口子时必传：默认状态下它接到的是
   *  组合控件覆盖的那几个端口，值要逐端口派生成各自认的形状（宽高比 / 像素量）。
   *  不传时按单端口处理（老调用方行为不变）。 */
  groupedKeys?: ReadonlySet<string>;
}): { inputs: MappedInput[]; unmatched: string[] } {
  const { io, entries, mapping, values, mode, groupedKeys } = args;
  const resolved = resolveMapping(entries, io, mapping, mode);
  /* 作者手工连了线的对外口（含"手工断开"）与纯自动映射要分开对待：
   *   · 手工：用户值只落到那个端口，该节点其余端口不再兜底（作者的线说了算）；
   *   · 自动（默认连线状态）：与"没连线"同义 —— 用户值落自动挑中的端口，
   *     其余端口照旧默认值兜底，语义等价于旧的「暴露 pin 全量下发」。 */
  const inputs: MappedInput[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();

  const push = (ioKey: string, value: unknown) => {
    if (value === undefined || seen.has(ioKey)) return;
    const raw = io?.[ioKey];
    if (!raw) return;
    seen.add(ioKey);
    inputs.push({ nodeId: runtimeNodeId(raw), name: raw.name, value });
  };

  /* ① 用户给了值的统一口子：落到它连着的那个端口。没连线（或作者显式断开）
   *    → 如实记进 unmatched，绝不凭空挑一个端口顶上去。
   *
   *    `values` 有两个来源：工坊侧按**契约 id**（`prompt` / `size`）给值；运行期
   *    表单按 **ioKey** 给值（DynamicWorkflowForm 的行键）。两者都要接住 ——
   *    只认一种就会让另一种静默失效（表现为「改了没生效」）。 */
  for (const entry of entries) {
    const byContract = values[entry.id];
    const byPinKeys = entry.pins
      .map((pin) => values[pin.ioKey])
      .find((value) => value !== undefined);
    const supplied = byContract ?? byPinKeys;
    if (supplied === undefined) continue;
    /* 一个对外参数可能接到**多个端口**（「尺寸」的宽高比 / 像素量由同一
     * 块控件录入，默认状态下几个端口都取自这一个口）。这时要把同一个对外值
     * 派生成每个端口各自认的形状，逐个下发 —— 只往「自动判定挑中的那一个」写，
     * 用户在图上连出来的另外两条线就从外部拿不到值（ISSUE #355：「尺寸那三项
     * 每一项都需要从外部获取值」）。 */
    const targets = wiredTargetsForEntry({
      entry,
      io,
      target: resolved[entry.id],
      manual: !isDefaultMappingForEntry(mapping, entry, mode),
      groupedKeys,
    });
    let pushed = false;
    for (const wired of targets) {
      if (!io?.[wired.ioKey]) continue;
      const perPort = sizeValueForPin(io, entry, wired.ioKey, supplied);
      if (perPort === undefined) continue;
      push(wired.ioKey, perPort);
      pushed = true;
    }
    if (!pushed) unmatched.push(entry.id);
  }

  /* ② 未连线/仅自动映射的统一口子：按默认值兜底（「用户不改就用工作流默认值」）。
   *    作者手工连了线的口跳过 —— 用户值已经写在那个端口上，再塞默认值只会打架。 */
  for (const entry of entries) {
    if (!isDefaultMappingForEntry(mapping, entry, mode)) continue;
    for (const pin of entry.pins) {
      const raw = io?.[pin.ioKey];
      if (!raw || !isScalarPin(pin)) continue;
      const fallback = resolveEntryDefault(raw, mode);
      if (fallback !== undefined) push(pin.ioKey, fallback);
    }
  }

  return { inputs, unmatched };
}

/* ── 对外参数卡片的视觉常量（纯派生，无 React / 无 IO） ──
 *
 * 卡片本体 `WorkflowParamCard` 与两侧卡片列（`WorkflowParamCardColumn` /
 * `WorkflowOutputParamCardColumn`）共用这几个尺寸。谁都不许自己再写一套字面量：
 * 卡片高度与圆点位置各写一份，线就会连到卡片外面去。
 *
 * **画布几何（节点 id 前缀 / 卡片坐标 / 卡片高度推算）已随编辑器卡片一起删除**：
 * 卡片现在只出现在工作流库详情的「画布节点」页签，位置与三列布局由 React Flow
 * 的节点坐标（`workflow-library-wire-graph` 的 `layoutLibraryNodes`）承担，
 * 这里不需要第二套几何。
 */

/** 卡片头（标题）行高。 */
export const PARAM_NODE_HEADER_H = 26;
/** 端口行行高。 */
export const PARAM_NODE_ROW_H = 22;
/** 卡片上下留白。 */
export const PARAM_NODE_PAD_Y = 8;

/** 输出端口区的行高 —— 与端口行同口径（视觉上就是一行带类型徽标的端口）。 */
export const PARAM_NODE_OUTPUT_ROW_H = PARAM_NODE_ROW_H;

/** 卡片右侧那颗**输出端点小圆点**的直径。 */
export const PARAM_NODE_DOT_SIZE = 12;

/** 圆点相对输出端口行右沿的偏移（负值 = 半颗圆点探出卡片）。
 *
 *  输出端口行带 `px-2`（8px）内边距，而行是端点定位的锚 —— 要让圆心正好骑跨
 *  卡片右缘（与项目画布的 PortHandle「半圆在外」一致），偏移必须是
 *  `-(行内边距 + 半颗圆点)`。输入列与输出列都用这个值，圆点不会一边贴边、
 *  一边内缩。 */
export const PARAM_NODE_DOT_OFFSET = -(
  PARAM_NODE_PAD_Y +
  PARAM_NODE_DOT_SIZE / 2
);
