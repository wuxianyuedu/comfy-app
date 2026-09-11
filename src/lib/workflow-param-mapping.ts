/* ── 对外参数 → 工作流节点参数的「映射」模型 ──
 *
 * ISSUE #145 把工作流库里的自定义工作流封装成"只对外暴露提示词/尺寸/参考图"。
 * 但对外参数（工坊侧）与工作流内部真正的 pin 之间，需要一个**作者可编辑**的
 * 对应关系：同一个「提示词」对外口，可能落在 CLIPTextEncode.text、也可能落在
 * 自定义节点的 prompt 槽；「尺寸」可能是一对 width/height，也可能是一个
 * resolution_preset。
 *
 * 本模块只做三件纯事（无 React、无 IO，规范 §17.2 第②层）：
 *   1. `buildParamEntries`  把服务端富化的 workflowIO 归并成「按节点分组的对外
 *      参数条目」——同一节点上的多个 pin 是**同一个对外参数**（提示词 = 一个
 *      节点的一个参数），而不是两行；
 *   2. `autoMapEntries`     给每个对外参数条目**自动**挑一个目标端口（默认连线
 *      状态）。判定顺序即优先级，与工坊封装（workflow-encapsulation）同口径；
 *   3. `applyParamMapping`  把映射落到运行时载荷上：确定性的 `workflowInputs`
 *      三元组 + 端口级自动映射。
 *
 * 落库位置：沿用既有的 `paramMap` JSON 列，`source` 命名空间下**只按模式**存放
 * 被覆盖过的落点，键写作 `source.mode:<模式>`（值 = `{ <entryId>: ioKey | null }`，
 * `null` = 该落点被显式断开）。不新增表结构。
 *
 * 为什么没有「与模式无关的覆盖」：落点覆盖是作者针对某个模式做的，
 * 不存在脱离模式的语境；留一个通用层只会让「这条覆盖到底哪个模式在生效」变成
 * 需要推理的问题，两套键空间互相覆盖也正是丢覆盖的历史根因。因此没有选中模式
 * 时**写入是空操作**，每条覆盖都归属一个模式。
 *
 * 本模块**只产出数据**：勾选一个对外参数不会在画布上新增任何节点或连线。
 * 每个条目的落点默认由 `autoMapEntries` 按名字自动判定，运行期由
 * `applyParamMapping` 按这张表严格落值。画布上不呈现这些落点 —— 它们不是工作流
 * 图的一部分（历史上一度把映射画成 `pio:<条目>` 节点 + 连线，勾选即长节点，
 * 与「工作流图」混淆，已移除）。
 */

import {
  resolveEntryDefault,
  type WorkflowIOEntry,
  type WorkflowIOMap,
} from "~/lib/workflow-io-types";

/* ── 对外参数分类 ──
 * 与工坊封装的 WorkshopPinClass 子集 + `other`（尺寸/参考图/提示词之外，
 * 作者自行勾选的对外输入，例如 steps / cfg / 种子）。 */
export type ParamClass =
  | "prompt"
  | "negative"
  | "size-width"
  | "size-height"
  | "size-aspect"
  | "size-megapixels"
  | "reference-image"
  | "first-frame"
  | "last-frame"
  | "other";

/** 一个「对外参数」（= 一个节点上被暴露的一类输入，可能含多个端口）。 */
export interface ParamEntry {
  /** 稳定键：按节点 + 分类聚合，直接作为连线源句柄 id。 */
  id: string;
  nodeId: string;
  nodeTitle: string;
  cls: ParamClass;
  /** 展示名：作者写的 label 优先，其次已有对外名，最后回落到分类默认名。 */
  label: string;
  /** 已有的对外名（工坊 / 画布动态表单里用的名字）。 */
  exposedName: string;
  type: string;
  /** 该对外口包含的端口（ioKey 保持 workflowIO 的原始键）。 */
  pins: { ioKey: string; name: string; type: string; defaultValue: unknown }[];
}

/** 分类默认名（作者未改名时用来填充「对外参数名」列）。 */
const CLASS_FALLBACK_LABEL: Record<ParamClass, string> = {
  prompt: "提示词",
  negative: "负面提示词",
  "size-width": "宽度",
  "size-height": "高度",
  "size-aspect": "宽高比",
  "size-megapixels": "像素量",
  "reference-image": "参考图",
  "first-frame": "首帧",
  "last-frame": "尾帧",
  other: "参数",
};

function searchText(e: WorkflowIOEntry): string {
  return `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();
}

const IMAGE_TYPES = new Set(["IMAGE", "MASK", "IMAGEUPLOAD"]);

/* ── 分类判定 ──
 * 顺序即优先级：负面先于正向，首/尾帧先于普通参考图，尺寸类先于提示词
 * （避免 "width" 之类被泛化的文本启发式抢走）。与工坊封装同口径。 */
const FIRST_FRAME_HINT = /first[_\s-]?frame|首帧|起始帧|第一帧|image_?1|start_?image/;
const LAST_FRAME_HINT = /last[_\s-]?frame|尾帧|结束帧|末帧|image_?2|end_?image/;

function isImagePin(e: WorkflowIOEntry): boolean {
  const type = (e.type ?? "").toUpperCase();
  if (IMAGE_TYPES.has(type)) return true;
  return /upload|image|参考图|首帧|尾帧|first_?frame|last_?frame/.test(searchText(e));
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
  if (/^(width|base_width|w|宽度|横向)$/.test(text.trim()) || /宽度|横向/.test(text)) {
    return "size-width";
  }
  if (/^(height|base_height|h|高度|纵向)$/.test(text.trim()) || /高度|纵向/.test(text)) {
    return "size-height";
  }
  if (/aspect_?ratio|宽高比|纵横比|比例/.test(text)) return "size-aspect";
  if (/megapixel|百万像素|\b像素\b/.test(text)) return "size-megapixels";
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

/** 该分类是否可与同一节点的同分类端口归并为一个对外参数。 */
function classKey(cls: ParamClass, nodeId: string): string {
  return `${nodeId}|${cls}`;
}

/** 把 IO 条目按「节点 + 分类」聚合成对外参数条目（稳定顺序）。 */
export function buildParamEntries(
  io: WorkflowIOMap | null | undefined,
  labels?: Record<string, string>
): ParamEntry[] {
  const byNode = new Map<
    string,
    { entry: ParamEntry; order: number }
  >();
  let order = 0;
  for (const [ioKey, raw] of Object.entries(io ?? {})) {
    const entry = raw as WorkflowIOEntry | undefined;
    if (entry?.direction !== "input" || entry.kind !== "widget") continue;
    const cls = classifyPin(entry);
    const key = classKey(cls, entry.nodeId);
    const pin = {
      ioKey,
      name: entry.name,
      type: entry.type ?? "*",
      defaultValue: entry.defaultValue,
    };
    const existing = byNode.get(key);
    if (existing) {
      existing.entry.pins.push(pin);
      if (entry.displayOrder !== undefined) existing.order = Math.min(existing.order, order);
      continue;
    }
    const override = labels?.[ioKey];
    byNode.set(key, {
      order,
      entry: {
        id: key,
        nodeId: entry.nodeId,
        nodeTitle: entry.nodeTitle ?? "",
        cls,
        label: override ?? entry.label ?? CLASS_FALLBACK_LABEL[cls],
        exposedName: entry.label ?? entry.name,
        type: entry.type ?? "*",
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
  "size-width": (e) => /^(width|base_width|w|宽度|横向)$/.test(searchText(e).trim()),
  "size-height": (e) => /^(height|base_height|h|高度|纵向)$/.test(searchText(e).trim()),
  "size-aspect": (e) => /aspect_?ratio|宽高比|纵横比|比例/.test(searchText(e)),
  "size-megapixels": (e) => /megapixel|百万像素|\b像素\b/.test(searchText(e)),
  "reference-image": (e) => isImagePin(e),
  "first-frame": (e) => isImagePin(e),
  "last-frame": (e) => isImagePin(e),
  "other": () => true,
};

/** 一个端口是否可直接接标量值（连线型端口不可作为对外参数的落点）。 */
function isScalarPin(i: { type: string }): boolean {
  const t = (i.type ?? "").toUpperCase();
  if (!t || t === "*") return true;
  return !new Set([
    "MODEL", "CLIP", "VAE", "CONDITIONING", "LATENT", "CONTROL_NET",
    "SAMPLER", "SIGMAS", "GUIDER", "NOISE", "CLIP_VISION", "STYLE_MODEL",
    "UPSCALE_MODEL",
  ]).has(t);
}

/** 自动映射：每个对外参数 → 目标端口（默认连线状态，可被手工覆盖）。 */
export function autoMapEntries(
  entries: readonly ParamEntry[],
  io: WorkflowIOMap | null | undefined
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const entry of entries) {
    let chosen: string | null = null;
    const predicate = AUTO_MAPPABLE[entry.cls];
    for (const pin of entry.pins) {
      const raw = io?.[pin.ioKey];
      if (!raw || !isScalarPin(pin)) continue;
      if (predicate(raw)) {
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
        return raw && isScalarPin(pin) && resolveEntryDefault(raw, null) !== undefined;
      });
      chosen = (withDefault ?? entry.pins.find(isScalarPin))?.ioKey ?? null;
    }
    map[entry.id] = chosen;
  }
  return map;
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
  mode?: string | null
): Record<string, string | null> {
  const auto = mapping?.auto ?? autoMapEntries(entries, io);
  const out: Record<string, string | null> = { ...auto };
  const manual: Record<string, string | null> = mode ? (mapping?.manualByMode?.[mode] ?? {}) : {};
  for (const entry of entries) {
    if (Object.prototype.hasOwnProperty.call(manual, entry.id)) {
      out[entry.id] = manual[entry.id] ?? null;
    }
  }
  return out;
}

/** 某个对外参数在指定模式下作者画的线；没有则返回 `undefined`。
 *  `null` 表示作者显式断开，必须与「没有手工线」区分开。
 *  没有模式时一律返回 `undefined` —— 不存在脱离模式的手工线（见文件头注释）。 */
export function manualTargetFor(
  mapping: ParamMapping | null | undefined,
  entryId: string,
  mode?: string | null
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
  if (!paramMap || typeof paramMap !== "object" || Array.isArray(paramMap)) return out;
  const sourceRaw = (paramMap as Record<string, unknown>).source;
  if (!sourceRaw || typeof sourceRaw !== "object" || Array.isArray(sourceRaw)) return out;
  for (const [key, value] of Object.entries(sourceRaw as Record<string, unknown>)) {
    if (!key.startsWith(MODE_KEY_PREFIX)) continue;
    const mode = key.slice(MODE_KEY_PREFIX.length);
    if (!mode) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const byEntry: Record<string, string | null> = {};
    for (const [entryId, target] of Object.entries(value as Record<string, unknown>)) {
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
  paramMap: Record<string, unknown>
): Record<string, unknown> {
  const source: Record<string, unknown> = {};
  for (const [mode, byEntry] of Object.entries(mapping.manualByMode ?? {})) {
    const targets: Record<string, string | null> = {};
    for (const [id, target] of Object.entries(byEntry ?? {})) {
      if (typeof target !== "string" && target !== null) continue;
      targets[id] = target;
    }
    if (Object.keys(targets).length > 0) source[`${MODE_KEY_PREFIX}${mode}`] = targets;
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
  mode?: string | null
): boolean {
  return manualTargetFor(mapping, entryId, mode) === undefined;
}

/** 该模式下是否有任何对外参数被作者改过线（画布级的「恢复默认」开关依据）。 */
export function hasManualWiring(
  mapping: ParamMapping | null | undefined,
  mode?: string | null
): boolean {
  if (!mode) return false;
  return Object.keys(mapping?.manualByMode?.[mode] ?? {}).length > 0;
}

/** 清掉指定模式下作者画的全部线，其余模式原样保留。
 *  落库后 `source.mode:<模式>` 整条消失，该模式的每个对外参数回到默认连线状态。 */
export function clearModeWiring(
  mapping: ParamMapping | null | undefined,
  mode?: string | null
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
  ioKey: string
): string | null {
  const raw = io?.[ioKey];
  if (!raw) return null;
  return classKey(classifyPin(raw), raw.nodeId);
}

/** 映射目标（`resolved` 的值，= ioKey）→ 画布上那条端口的 **React Flow handle id**。
 *
 *  两个键空间必须分清（ISSUE #374）：
 *   · ioKey（`<nodeId>::<kind>::<name>`）是 workflowIO 的字典键，运行期
 *     `io[target]` 回查靠它，落库的 `paramMap.source.mode:<模式>` 也存它；
 *   · handle id 是节点卡片上 `<Handle id=…>` 的 DOM id，画布渲染统一取
 *     **pin 名**（= `WorkflowIOEntry.name`）。
 *  `buildParamEdges` 若把 ioKey 当 targetHandle 写进边，React Flow 在
 *  `handleBounds` 里查不到该 id → 丢弃整条边并打 error#008（用户看到的是
 *  「对外参数的线画不出来」）。
 *
 *  `ioKey` 末尾的 `name` 段不保证可切分（pin 名本身可能含 `::`），所以一律
 *  经 `io` 反查 `entry.name`，而不是对字符串做 split。查不到（条目已被移除 /
 *  io 未就绪）时返回 null，调用方据此不画线。 */
export function handleIdForIoKey(
  io: WorkflowIOMap | null | undefined,
  ioKey: string | null | undefined
): string | null {
  if (!ioKey) return null;
  const name = io?.[ioKey]?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/** `handleIdForIoKey` 的逆：某个节点上的 **handle id（pin 名）** → ioKey。
 *
 *  画布手势（拉线 / 合法性闸门）拿到的 `connection.targetHandle` 是渲染侧
 *  的 pin 名，而落库与运行期都用 ioKey，写入前必须翻回来（ISSUE #374）。
 *  同名端口取**第一个**命中的 ioKey（`buildParamEntries` 已按 nodeId 聚类，
 *  同节点同名 pin 属于异常数据，任取其一都可稳定复现）。 */
export function ioKeyForHandle(
  io: WorkflowIOMap | null | undefined,
  nodeId: string,
  handleId: string | null | undefined
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
  mode?: string | null
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
}): { inputs: MappedInput[]; unmatched: string[] } {
  const { io, entries, mapping, values, mode } = args;
  const resolved = resolveMapping(entries, io, mapping, mode);
  /* 作者手工连了线的对外口（含"手工断开"）与纯自动映射要分开对待：
   *   · 手工：用户值只落到那个端口，该节点其余端口不再兜底（作者的线说了算）；
   *   · 自动（默认连线状态）：与"没连线"同义 —— 用户值落自动挑中的端口，
   *     其余端口照旧默认值兜底，语义等价于旧的「暴露 pin 全量下发」。 */
  const isManualTarget = (id: string) => !isDefaultMapping(mapping, id, mode);
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

  /* ① 用户给了值的对外参数：落到它连着的那个端口。没连线（或作者显式断开）
   *    → 如实记进 unmatched，绝不凭空挑一个端口顶上去。 */
  for (const entry of entries) {
    const supplied = values[entry.id];
    if (supplied === undefined) continue;
    const target = resolved[entry.id];
    if (target && io?.[target]) {
      push(target, supplied);
      continue;
    }
    unmatched.push(entry.id);
  }

  /* ② 未连线/仅自动映射的对外参数：按默认值兜底（「用户不改就用工作流默认值」）。
   *    手工连了线的口跳过 —— 用户值已经写在那个端口上，再塞默认值只会打架。 */
  for (const entry of entries) {
    if (isManualTarget(entry.id)) continue;
    for (const pin of entry.pins) {
      const raw = io?.[pin.ioKey];
      if (!raw || !isScalarPin(pin)) continue;
      const fallback = resolveEntryDefault(raw, mode);
      if (fallback !== undefined) push(pin.ioKey, fallback);
    }
  }

  return { inputs, unmatched };
}
