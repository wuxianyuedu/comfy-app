/**
 * 对外参数分类与 pin 判定（`workflow-param-mapping` 的拆分件）。
 *
 * 从 `workflow-param-mapping.ts` 抽出：**分类模型**（`ParamClass` /
 * `PinFamily` / `SIZE_CLASSES` / `SIZE_SUB_IDS` / `ParamEntry` /
 * `ParamOutputPort`）与**判定 / 展示**类纯函数（`nodeIdOfIoKey` /
 * `sizeSubLabel` / `sizeGroupIds` / `pinFamily` / `familyOfClass` /
 * `isSizeClass` / `pinAcceptsEntry` / `candidateClasses` / `isSizeDetermined` /
 * `portTypeDisplay` / `sizeSubTypeDisplay` / `acceptedPinTypesFor` /
 * `classPinType` / `paramOutputPorts` / `wiredTargetsForEntry`）。
 *
 * 主文件保留**映射本身**（`buildParamEntries` 组装、`ParamMapping` 存储解析、
 * `applyParamMapping` 运行时落值、卡片布局常量），并从本模块 re-export 上述
 * 符号；消费者 import 路径不变（§12.18 复用优先）。
 *
 * 拆分动机：主文件 1098 行超过 §12.6 文件长度棘轮的阈值。分类模型是**映射**与
 * **UI** 都要用的叶子层，独立出去后主 → 本模块单向、无回环，也顺手让
 * 「参数分类」这件事有一份显式的 owner（画布卡片、wire 流、封装状态都从这里
 * 取，不再各写各的）。
 */
import { upperToken } from "~/lib/upper-token";
import type {
  WorkflowIOEntry,
  WorkflowIOMap,
} from "~/lib/workflow/workflow-io-types";
import {
  EXPOSED_PARAM_LABEL,
  exposedParamDisplayLabel,
} from "~/lib/workflow/workflow-exposed-params";

/* ── 对外参数分类 ──
 * 工坊对外口的全集 + `other`（尺寸/参考图/提示词之外，作者自行勾选的对外输入，
 * 例如 steps / cfg / 种子）。
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
  /** 分辨率档（`1k` / `2k` / `4k`）：端口自己的候选就是档位标签，值由宽高反解
   *  出档位再匹配它的候选（见 `size-presets` 的 `resolutionTierOf`）。 */
  | "size-resolution"
  /** 宽高对齐倍数（8 / 16 / 32 / 64）：**像素量档定出宽高必需** ——
   *  「比例 + 像素量」只给出总像素，要落到具体宽高还得知道两侧吸附到哪个网格。 */
  | "size-multiple"
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
  "size-resolution",
  "size-multiple",
];

/** 「尺寸」在映射层的四个**子口 id**（与 `SIZE_CLASSES` 同名）。
 *
 *  对外契约里「尺寸」仍是一个口（工坊给一个 `"832x1216"`，见
 *  `workflow-exposed-params`）；但落点形态由**作者连到哪个子口**声明 ——
 *  `width` / `aspect_ratio` / `resolution_preset` 这类名字猜形态会静默落错形状
 *  （把像素串写进比例口），所以形态不再从端口名推。 */
export const SIZE_SUB_IDS: readonly ParamClass[] = SIZE_CLASSES;

/** 某个尺寸子口的显示名（`尺寸 · 宽高比`）。
 *
 *  基础名取自契约表（`EXPOSED_PARAM_LABEL.size`，「尺寸」这四个字的唯一出处），
 *  形态词取自本模块的 `CLASS_FALLBACK_LABEL` —— 组合出来的一句话对每个子口都是
 *  唯一的，作者在卡片列上一眼能分辨自己连的是哪一形态。 */

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
   *  作者从这些候选里拖一条线选中一个作为落点。 */
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
  "size-resolution": "分辨率档",
  "size-multiple": "倍数",
  "reference-image": exposedParamDisplayLabel("reference-image"),
  "first-frame": exposedParamDisplayLabel("first-frame"),
  "last-frame": exposedParamDisplayLabel("last-frame"),
  duration: exposedParamDisplayLabel("duration"),
  other: "参数",
};

/** 某个尺寸子口的显示名（`尺寸 · 宽高比`）。
 *
 *  基础名取自契约表（`EXPOSED_PARAM_LABEL.size`，「尺寸」这四个字的唯一出处），
 *  形态词取自上面的 `CLASS_FALLBACK_LABEL` —— 组合出来的一句话对每个子口都是唯一
 *  的，作者在卡片列上一眼能分辨自己连的是哪一形态。 */
export function sizeSubLabel(cls: ParamClass): string {
  return `${EXPOSED_PARAM_LABEL.size} · ${CLASS_FALLBACK_LABEL[cls]}`;
}

/** 「尺寸」那一张卡片 ↔ 它在映射表里的键：卡片 id 是聚合值 `size`（对外只报一个
 *  尺寸口），映射键是六个子口。
 *
 *  卡片列把它渲染成**一张卡**（六行形态各一颗圆点，见 `WorkflowParamCardColumn`），
 *  而连线、落点、↺ 恢复默认都按子口走 —— 这层换算就是两者的桥：
 *  `sizeGroupIds("size")` 给出全部六个键，`sizeGroupIds(<子口 id>)` 回它自己。 */
export function sizeGroupIds(
  id: string | null | undefined,
): readonly ParamClass[] {
  if (!id) return [];
  return id === "size" ? SIZE_SUB_IDS : [id as ParamClass];
}

/* ── 端口分类：只看**声明类型** ──
 *
 * 一个端口能当哪些对外参数的落点，由它的**声明类型**定族，不看名字：端口名随
 * 工作流改版漂移（`base_width` / `横向` / `1:1 比例`…），类型不会；而按名字判错
 * 的时候用户无从察觉（判成「尺寸 · 宽」的一个普通数值口被静默写成宽度）。名字
 * 启发式（`searchText` 那套正则）整条删除。
 *
 * 同一族的几个对外参数**共享同一份候选**：提示词 / 负向提示词都收 STRING 行，
 * 参考图 / 首帧 / 尾帧都收图片行，尺寸六个子口与「时长」都收数值行 —— **谁是谁
 * 由作者的连线声明**（与「尺寸形态由子口声明」同一口径，ISSUE #632：不猜落点）。 */

/** 端口的**类型族** —— 同一族共享一份候选落点。 */
export type PinFamily =
  /** STRING 文本行。 */
  | "text"
  /** 图片系（IMAGE / MASK / IMAGEUPLOAD）。 */
  | "image"
  /** 数值 / 候选表（INT / FLOAT / NUMBER / COMBO / 未知类型）。 */
  | "number";

const TEXT_TYPES = new Set(["STRING", "TEXT"]);
const IMAGE_TYPES = new Set(["IMAGE", "MASK", "IMAGEUPLOAD"]);
const NUMBER_TYPES = new Set(["INT", "FLOAT", "NUMBER", "COMBO", "*"]);

/** 端口按声明类型归族（`null` = 不能当任何对外参数的落点：连线型端口、输出口）。 */
export function pinFamily(
  e: WorkflowIOEntry | null | undefined,
): PinFamily | null {
  if (e?.direction !== "input" || e.kind !== "widget") return null;
  const type = (e.type ?? "*").toUpperCase();
  if (TEXT_TYPES.has(type)) return "text";
  if (IMAGE_TYPES.has(type)) return "image";
  if (NUMBER_TYPES.has(type)) return "number";
  return null;
}

/** 每个对外参数类落在哪一族。
 *
 *  `size` 是**聚合值**（对外只报一个「尺寸」，映射层摊成六个子口）—— 它和六个
 *  子口一样只吃数值行；`other` 是工作流内部参数，不接受任何端口。 */
export const CLASS_FAMILY: Record<ParamClass, PinFamily | null> = {
  prompt: "text",
  negative: "text",
  size: "number",
  "size-width": "number",
  "size-height": "number",
  "size-aspect": "number",
  "size-megapixels": "number",
  "size-resolution": "number",
  "size-multiple": "number",
  "reference-image": "image",
  "first-frame": "image",
  "last-frame": "image",
  duration: "number",
  other: null,
};

/** 某个对外参数类接受的端口族（`null` = 不接受任何端口）。 */
export function familyOfClass(cls: ParamClass): PinFamily | null {
  return CLASS_FAMILY[cls] ?? null;
}

/** 该分类是否属于「尺寸」语义（含契约聚合值 `"size"` 本身）。 */
export function isSizeClass(cls: ParamClass): boolean {
  return cls === "size" || SIZE_CLASSES.includes(cls);
}

/** 手工拖线的**类型闸门**：该契约口能不能落到这个端口上。
 *
 *  判据只有一条：**同族**（`familyOfClass` vs `pinFamily`）—— 端口叫什么名字不
 *  参与判定。自动候选本来就是按这一族收的；手工拖线若不过这道闸门，就会出现
 *  「提示词拖到宽高比也连上了」：写进去的映射运行期根本取不到值（提示词只吃
 *  STRING 行，宽高比是数值行）。
 *
 *  同族的兄弟口（提示词 vs 负向提示词、首帧 vs 尾帧、尺寸各子口）互相之间不作
 *  区分 —— 谁是谁由作者连线声明，不由端口名猜。 */
export function pinAcceptsEntry(
  cls: ParamClass,
  ioEntry: WorkflowIOEntry | null | undefined,
): boolean {
  const family = familyOfClass(cls);
  if (!family) return false;
  if (pinFamily(ioEntry) !== family) return false;
  const accepted = acceptedPinTypesFor(cls);
  if (!accepted) return true;
  const type = upperToken(ioEntry?.type);
  /* 类型未知（缺省 / `*`）：放行 —— 拿不到事实时不替作者做决定。 */
  if (!type || type === "*") return true;
  return accepted.includes(type);
}

/** 某个条目在**历史键**里的候选分类（旧键空间是 `<节点 id>|<分类>`）。
 *
 *  旧键按当时的名字分类写下来，所以只回它自己那一类 —— 多回几类会把别的口子
 *  当年连过的线读到本口上来。 */
export function candidateClasses(cls: ParamClass): readonly ParamClass[] {
  return [cls];
}

/** 「尺寸」在当前模式下是否**已经能定出宽高** —— 工坊能不能跑得起来的前提。
 *
 *  工坊只送一个尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数），要落到工作流上
 *  必须能算出宽高，所以四个子口里得凑出能解出 W/H 的一组：
 *    · 宽度 + 高度（两个子口都连上）；
 *    · 宽高比 + （像素量 或 分辨率档）。
 *  只连其中一个（只有宽度、只有比例…）解不出另一维 —— 不算配置完成：状态显示
 *  未配置，「缺了它不能跑」的清单里带上它。 */
export function isSizeDetermined(
  resolved: Record<string, string | null | undefined>,
): boolean {
  const wired = (cls: ParamClass) => Boolean(resolved[cls]);
  if (wired("size-width") && wired("size-height")) return true;
  if (!wired("size-aspect")) return false;
  /* 分辨率档自己就能定宽高（档位表给出确切宽高）。 */
  if (wired("size-resolution")) return true;
  /* 像素量档只有总像素：还要倍数（两侧吸附到哪个网格）才解得出宽高 ——
   * 「比例 + 像素量 + 倍数」是工坊那一类尺寸表达的三段，缺一段定不出来。 */
  return wired("size-megapixels") && wired("size-multiple");
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
 * 一颗。类型**只看这个口自己**（按族；尺寸子口按形态），不看契约名硬编码、也不
 * 跟着落点漂（见 `ParamOutputPort.type`）。
 *
 * 每颗圆点带自己的 handle id：它就是该端口的 **React Flow handle id（= pin 名）**
 * —— 落库与运行期用的 ioKey 经 `ioKeyForHandle` 翻回来（两个键空间不能混，
 * 见 ISSUE #374）。未连线的候选没有连线，handle 仍是端口名，连上即落库。
 */

/** 单条输出端口的展示形态（纯数据，视图只负责画）。 */
export interface ParamOutputPort {
  /** 端口自身的名字（落到哪个 pin）。 */
  name: string;
  /** 卡片行上**显示**的名字；缺省 = `name`。
   *
   *  对外**输入**卡片给的是这个对外参数自己的名字（「提示词」「尺寸」）：
   *  这一行说「这个口是什么、出去是什么类型」，落到工作流的哪一行由连线表达
   *  —— 行上写 `value` / `text_1` 这类 ComfyUI 内部 pin 名，读起来与作者在
   *  ComfyUI 里看到的对不上，也会随工作流改版漂移。落点仍在 `name` / `title`
   *  里可查（`ioKey`）。对外**输出**卡片不给（那里端口名就是作者要看的名字）。 */
  display?: string;
  /** **这个对外口自己的**声明类型（大写，如 STRING / IMAGE / COMBO）。
   *
   *  **恒不随落点变**：卡片上的芯片说的是「这个口对外是什么」，不是「它现在落到
   *  哪一行、那一行声明成什么」。用户口径：「对外参数的类型都不要跟着连线改动，
   *  现在图片节点连过去会变更显示类型」—— 同一个「首帧图片」连到 `IMAGEUPLOAD`
   *  的装载口就显示成 IMAGEUPLOAD，松手又变回 IMAGE，读起来像口子自己换了类型。
   *  落点那一行的类型仍在（`targetType`，行 title 里可查）。*/
  type: string;
  /** 落点那一行的声明类型（未连线 / 落点已不存在时不给）。
   *
   *  芯片不显示它 —— 只用来在行 title 里补一句「落到的那一行其实是 IMAGEUPLOAD」，
   *  免得「类型不同」这件事在界面上彻底查不到。 */
  targetType?: string;
  /** 是否已经落到了工作流里真实存在的端口。 */
  connected: boolean;
  /** 落点（工作流内部键 `<nodeId>::<kind>::<name>`）；`""` = 还没落到任何行。 */
  ioKey: string;
  /** React Flow 的 handle id —— 连线的起点标识，**库内 = 条目 id**（一卡一颗点，
   *  同一画布节点内天然唯一）；画布宿主行那一侧的 handle 才是 ioKey。 */
  handleId: string;
  /** 是否为**当前生效落点**（作者连上的那一颗；未连线时全为 false）。 */
  active: boolean;
}

/** 一枚标签/端口的类型展示名：声明类型原样大写，缺省 `*`。 */
export function portTypeDisplay(type: string | undefined | null): string {
  const t = upperToken(type);
  return t.length > 0 ? t : "*";
}

/** 数值端口的三类声明（尺寸的数值形态都能落在这几类行上）。 */
const NUMERIC_PORT_TYPES = ["INT", "FLOAT", "NUMBER"] as const;

/** 尺寸子口的**规格表**：展示类型 + 可接受的端口类型（一处定义，展示与闸门同源）。
 *
 *  · **展示类型**（用户口径）：宽度 / 高度 / 像素量 = `FLOAT`，分辨率档 / 倍数 =
 *    `INT`，宽高比 = `COMBO`。卡片行**恒显示**它，不随落点变化（用户口径：
 *    「对外参数卡片的类型都要显示是固定的…不要跟连接的参数类型变换」）。
 *  · **可接受的端口类型**（闸门）：数值形态之间互通（声明成 INT 还是 FLOAT 由
 *    工作流决定），宽高比只接 `COMBO` —— 「宽高比能连到百万像素」这类线不再放行
 *    （用户口径：「这是不行的」）。
 *
 *  类型未知（缺省 / `*`）的端口一律放行：拿不到事实时不替作者做决定。 */
const SIZE_SUB_SPEC: Record<
  string,
  { display: string; accepts: readonly string[] }
> = {
  "size-width": { display: "FLOAT", accepts: NUMERIC_PORT_TYPES },
  "size-height": { display: "FLOAT", accepts: NUMERIC_PORT_TYPES },
  "size-megapixels": { display: "FLOAT", accepts: NUMERIC_PORT_TYPES },
  "size-resolution": { display: "INT", accepts: NUMERIC_PORT_TYPES },
  "size-multiple": { display: "INT", accepts: NUMERIC_PORT_TYPES },
  "size-aspect": { display: "COMBO", accepts: ["COMBO"] },
};

/** 尺寸子口展示的类型（见 `SIZE_SUB_SPEC`）—— 不论有没有落点都是它。 */
export function sizeSubTypeDisplay(cls: ParamClass): string {
  return SIZE_SUB_SPEC[cls]?.display ?? portTypeDisplay(undefined);
}

/** 尺寸子口接受的端口类型（`undefined` = 不是尺寸子口，闸门按类型族判即可）。 */
function acceptedPinTypesFor(cls: ParamClass): readonly string[] | undefined {
  return SIZE_SUB_SPEC[cls]?.accepts;
}

/** 一个对外口**自己的**类型（按它接受的端口族给）—— 未连线时卡片上显示它，
 *  不显示 `*`，也不随落点变。尺寸六子口另有形态表（见 `sizeSubTypeDisplay`）。 */
const FAMILY_TYPE: Record<PinFamily, string> = {
  text: "STRING",
  image: "IMAGE",
  number: "NUMBER",
};

/** 一个对外口自己的类型展示名：尺寸子口按**形态**固定（见 `SIZE_SUB_SPEC`），
 *  其余按端口族（见 `FAMILY_TYPE`）。 */
export function classPinType(cls: ParamClass): string {
  const sub = SIZE_SUB_SPEC[cls]?.display;
  if (sub) return sub;
  const family = familyOfClass(cls);
  return family ? FAMILY_TYPE[family] : "*";
}

/** 一个对外参数卡片的**输出端口**（**一个口一颗点**）。
 *
 *  卡片只说「这个口对外是什么」（名字 + 类型），**落点由线的另一端声明** —— 拖
 *  这颗点连到宿主的哪一行，这个口就落到哪一行。与尺寸卡「一行 = 一个形态，落点
 *  由另一端声明」同构。
 *
 *  早前这里是「每个候选落点一颗点」（未连线时逐候选列行）：那只在「尺寸」还是
 *  一个**聚合条目**时成立（候选是宽 / 高 / 比例 / 像素量这些语义不同的行，作者要
 *  在卡片上挑）；尺寸摊成六个子口之后，普通卡逐候选摆点只会把同一族的行重复列
 *  一遍，还把 handle id 撞成一堆同名点（用户口径：「提示词不是就应该有一个输出端
 *  口吗，每个候选落点一颗有什么意义」）。
 *
 *  `handleId` = **条目 id**：一卡一颗点，条目 id 在同一画布节点内天然唯一（尺寸卡
 *  的六行各是子口 id，同样唯一）；落点不再需要由 handle id 携带。 */
export function paramOutputPorts(
  entry: ParamEntry,
  io: WorkflowIOMap | null | undefined,
  resolvedTarget: string | null | undefined,
  /** 行上显示的对外参数名。给的是**调用方那一份**（卡片列会先用契约口清单的
   *  展示名覆盖 `entry.label`，见 ISSUE #596）—— 两处各取一份会让同一张卡片的
   *  标题与端口行说两个名字。缺省 = `entry.label`。 */
  displayName?: string,
): ParamOutputPort[] {
  const target = resolvedTarget ?? null;
  const rawTarget = target ? io?.[target] : undefined;
  return [
    {
      name: entry.label,
      /* 行上只写这个对外参数自己的名字；落到工作流的哪一行由线表达（`ioKey`
       *  在行的 title 里可查）。 */
      display: displayName ?? entry.label,
      /* 类型**只看这个口自己**（按族 / 按尺寸形态），连没连线都一样 —— 见
       *  `ParamOutputPort.type` 的说明。落点那一行的声明类型另存 `targetType`，
       *  只在行 title 里露面。 */
      type: classPinType(entry.cls),
      targetType: rawTarget ? portTypeDisplay(rawTarget.type) : undefined,
      connected: !!target,
      ioKey: target ?? "",
      handleId: entry.id,
      active: !!target,
    },
  ];
}

/** 一个对外参数当前**接到哪个端口** —— 只报作者连上的那一条。
 *
 *  为什么不是「一对多」：候选是**按类型**收来的（一族一份，见 `pinFamily`），
 *  同族几个口子的候选集合互相重叠（每个数值行都是「尺寸 · 宽」的候选）。逐条
 *  列出来会让一张卡画出十来条线，还把兄弟口子的落点在图上画到这个口名下。
 *  「尺寸 · 宽高比」连的是哪一行，只由它自己那一条线说。
 *
 *  这与「候选圆点照给」是两件事：圆点给全部候选（作者要能拖，见
 *  `paramOutputPorts`），**线只画连上的那条**。
 *
 *  落点**只能来自作者画的线**（没有线就没有落点，见 `resolveMapping`）；没有
 *  落点就报空（未配置，如实呈现）。
 *
 *  `active` 标出「作者连上的那个」，供卡片上的实心圆点使用。 */
export function wiredTargetsForEntry(args: {
  /** 当前模式下这个条目的落点（`resolveMapping` 的结果；`null` = 未连线/断开）。 */
  target: string | null | undefined;
}): { ioKey: string; active: boolean }[] {
  /* 只报作者连上的那一条 —— 候选圆点由 `paramOutputPorts` 照给，两件事分开。 */
  return args.target ? [{ ioKey: args.target, active: true }] : [];
}
