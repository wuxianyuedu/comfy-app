/**
 * ComfyUI 工作流「原始 / 控件顺序」兼容层
 *
 * 本应用只接受 **ComfyUI 的原始工作流格式**（工作流 / RAW / UI 格式，
 * `{ last_node_id, last_link_id, nodes: [...], links: [...] }`）—— ComfyUI 前端
 * 保存在磁盘的那种，带节点坐标，控件值按数组存（`widgets_values`）。
 * 库里的 `rawJson` 列就是它，执行时交给 comfy-cli（它按节点类定义做权威的
 * UI→API 转换）。API 格式不是可导入的形态。
 *
 * 本模块**只回答两个问题**：
 *   - {@link extractPositions}  RAW 的节点坐标在哪；
 *   - RAW 节点的控件**叫什么名字**（{@link pairWidgetValues} /
 *     {@link fetchWidgetOrderTable} 与 {@link mapWidgetValuesByOrder}）——
 *     画布要把 `widgets_values` 的下标还原成可读的参数名。
 *
 * 本模块**不做**任何「raw → API 图」的转换：
 *   - 入库就是原件逐字落 `rawJson`；
 *   - 执行由 comfy-cli 做权威转换（按节点类定义）；
 *   - 画布视图需要的派生在 `raw-view-graph.ts`，提交前的图收拾在
 *     `execution-graph.ts` 里。
 *   「导入时把 raw 转成 API 图存库」已被证明有害（ISSUE #632）：无 ComfyUI
 *   可达时按类名猜控件顺序，猜错就是一份能打开、跑起来结果不对的图。
 */

import { z } from "zod";
import { comfyBase } from "./client";

/* ── raw JSON 收窄工具（§5.6：外部输入 unknown + 守卫）──────────────────
 * 这些 helper 是本模块与 workflow-detail-* / workflow-subgraph-parse 共用的
 * JSON 收窄原语：把 DB Json 列 / JSON.parse 产物的 unknown 收成可读视图，
 * 运行时零转换（断言只在编译期）。 */

/** 宽松对象视图：`typeof v === "object" && v !== null` 的值（含数组）→
 *  Record 视图，否则 null。对应旧 any 代码 `x?.prop` / `Object.keys(x ?? {})`
 *  的运行时语义。 */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : null;
}

/** 严格普通对象守卫（排除数组）—— 用于 groups / pins 等逐条收窄。 */
export function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** DB Json 列 / JSON.parse 产物 → RawWorkflow 视图。根不是普通对象时返回
 *  null（下游均有 `Array.isArray(raw.nodes)` 类守卫，路径与旧代码等价）。 */
export function asRawWorkflow(v: unknown): RawWorkflow | null {
  return isJsonObject(v) ? (v as RawWorkflow) : null;
}

/** `String(v)` 的类型收窄等价：值全部来自 JSON 反序列化产物（无 symbol /
 *  自定义 toString），运行时行为与 String(v) 完全一致 —— 对象走其 toString
 *  （普通对象即 Object.prototype.toString → "[object Object]"）。显式收窄
 *  只为满足 no-base-to-string（该规则把 String(unknown/{}) 一律视为误报）。 */
export function toStringValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  return (v as { toString(): string }).toString();
}

/** raw UI 格式节点的 inputs[] 条目（ComfyUI 只把「转为输入」的槽位写进来）。
 *  字段值来自外部 JSON，一律 unknown，读取点自行 typeof 守卫。 */
export interface RawNodeInput {
  name?: unknown;
  /** zh-CN 本地化标签（ComfyUI 逐节点保存） */
  localized_name?: unknown;
  label?: unknown;
  type?: unknown;
  /** 槽位序号（新版 ComfyUI 写入；旧版按数组序） */
  idx?: number;
  /** raw.links 里的 link id；null 表示该槽位没有接线 */
  link?: number | null;
  /** 暴露内部控件的槽位标记（值存于 widgets_values） */
  widget?: { name?: unknown } | null;
  [k: string]: unknown;
}

/** raw UI 格式节点的 outputs[] 条目。 */
export interface RawNodeOutput {
  name?: unknown;
  localized_name?: unknown;
  label?: unknown;
  type?: unknown;
  /** 槽位序号（新版 ComfyUI 写入；旧版按数组序） */
  idx?: number;
  /** 下游 link id 列表 */
  links?: number[];
  [k: string]: unknown;
}

export interface RawNode {
  /** 节点 id — ComfyUI 导出为 number，畸形数据可能是 string；统一 String() 后使用 */
  id: number | string;
  /** 节点类名（raw 格式没有 class_type） */
  type?: string;
  /** 画布坐标 [x, y]（LiteGraph 绝对坐标） */
  pos?: number[];
  /** 节点盒尺寸 [w, h] */
  size?: number[];
  /**
   * LiteGraph 执行模式：0=ALWAYS(正常) 1=ON_EVENT 2=NEVER(静音) 3=ON_TRIGGER 4=BYPASS。
   * ComfyUI 前端在导出 prompt 时会剔除 2/4 的节点，4 还要把连线「穿透」过去。
   * 提交前的这步收拾见 `execution-graph.ts`。
   */
  mode?: number;
  /** 节点控件值的有序数组，含义由 class_type 决定 */
  widgets_values?: unknown[];
  /** 部分工作流的 raw 节点也会显式包含 inputs/outputs（用于嵌套连接） */
  inputs?: RawNodeInput[];
  outputs?: RawNodeOutput[];
  /** 节点属性，如 title / proxyWidgets */
  properties?: Record<string, unknown>;
  title?: string;
  /** LiteGraph 运行时 flags（如 collapsed / bypass） */
  flags?: Record<string, unknown>;
  /** 其余动态字段（color 等），按需 typeof 守卫后读取 */
  [k: string]: unknown;
}

export interface RawWorkflow {
  last_node_id?: number;
  last_link_id?: number;
  nodes: RawNode[];
  /** 每条 link 是 [link_id, src_id, src_slot, dst_id, dst_slot, type]（元素动态） */
  links?: unknown[][];
  groups?: unknown[];
  config?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  /** ComfyUI ≥ v0.7 的子图定义（subgraph wrapper） */
  definitions?: RawDefinitions;
  [k: string]: unknown;
}

/** ComfyUI v0.7+ 子图定义容器（rawJson.definitions）。 */
export interface RawDefinitions {
  /** 子图定义：键为 UUID 或数字序号；wrapper 的 class_type 即对应 UUID */
  subgraphs?: Record<string, RawSubgraphDef>;
  [k: string]: unknown;
}

/** 单个子图定义（rawJson.definitions.subgraphs[uid]）。
 *  与顶层 raw 的差异：links 是对象数组（非元组），inputs/outputs 是边界 pin。 */
export interface RawSubgraphDef {
  /** 子图 UUID（与 wrapper 的 class_type 对应；键可能是数字序号） */
  id?: unknown;
  /** 子图显示名（wrapper 卡片标题） */
  name?: unknown;
  /** 内部节点（与顶层 nodes 同构） */
  nodes?: RawNode[];
  /** 对象形式连线：{ id, origin_id, origin_slot, target_id, target_slot, type } */
  links?: unknown[];
  /** 边界输入 pin 定义 */
  inputs?: unknown[];
  /** 边界输出 pin 定义 */
  outputs?: unknown[];
  /** 内部分组框 */
  groups?: unknown[];
  [k: string]: unknown;
}

/* ── 子图定义内部的形状契约（外部输入边界，规范 §5.5）────────────────────
 * schema 放在 `RawSubgraphDef` 的声明处（同一处定义、同一处演进），消费方
 * `workflow-subgraph-parse` 只负责调用，不再自己写一套判据。
 *
 * 两条都刻意只硬约束「身份字段」，其余保持宽松 —— 它们是**用户可扩展且各版本
 * 漂移**的结构，收紧会把「一个字段形态不认识」升级成「整条数据被丢掉」，而丢掉
 * 的后果是静默的（画布上少一根线 / 边界口凭空消失，没有任何报错）。 */

/** 子图内部连线条目（`definitions.subgraphs[u].links` 的对象形态）。
 *  `id` 必须存在（它是查表的键）；端点用 `number | string`，读取点各自判
 *  `Number.isFinite` —— 畸形数据里它们是字符串或缺失是常态。 */
export const SubgraphLinkSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
  origin_id: z.union([z.number(), z.string()]).optional(),
  origin_slot: z.union([z.number(), z.string()]).optional(),
  target_id: z.union([z.number(), z.string()]).optional(),
  target_slot: z.union([z.number(), z.string()]).optional(),
  type: z.unknown().optional(),
});

/** 暴露口 pin（`definitions.subgraphs[u].inputs / .outputs`）。
 *  只要求 `id` 是非空字符串（没有 id 的条目无法回填 boundaryLinks）；不同
 *  ComfyUI 版本对「这个 pin 关联了哪些连线」用过三种键名（`linkIds` / `link` /
 *  `links`），所以那些字段一律不设 schema。 */
export const SubgraphPinSchema = z.looseObject({ id: z.string().min(1) });

/**
 * `_meta` 的官方用途只有 `title`。这里额外携带的字段**仅用于本地存储 / 画布
 * 展示与提交前穿透**，在 `execution-graph.prepareGraphForExecution()` 里会被
 * 剥到只剩 `title`，绝不外发给 ComfyUI。
 */
export interface ApiNodeMeta {
  title?: string;
  /** LiteGraph mode，仅在 !== 0 时写入 */
  mode?: number;
  /** 纯前端节点标记（Reroute / PrimitiveNode / Note …） */
  virtual?: boolean;
  /** PrimitiveNode 的字面量取值，执行期直接内联给下游 */
  value?: unknown;
  /** 入参名的槽位顺序（bypass 穿透时按槽位匹配） */
  inputOrder?: string[];
  /** 入参名 → 类型（bypass 穿透时按类型匹配） */
  inputTypes?: Record<string, string>;
  /** 出参槽位 → 类型（bypass 穿透时确定目标类型） */
  outputTypes?: string[];
}

export interface ApiWorkflowNode {
  class_type: string;
  /** API inputs: 命名参数；数组 [nodeId, slotIdx] 表示连线 */
  inputs: Record<string, unknown>;
  _meta?: ApiNodeMeta;
  /** 部分导出携带的其余动态字段（如旧 rgthree 导出的 type） */
  [k: string]: unknown;
}

/* ──────────────────────────────────────────────────────────────────────
 * 从原始格式抽取节点坐标 (用于编辑器初始布局)
 * ────────────────────────────────────────────────────────────────────── */

export function extractPositions(
  raw: RawWorkflow,
): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  if (!Array.isArray(raw.nodes)) return out;
  for (const n of raw.nodes) {
    if (n && Array.isArray(n.pos) && n.pos.length >= 2) {
      const id = String(n.id);
      out[id] = [Number(n.pos[0]) || 0, Number(n.pos[1]) || 0];
    }
  }
  /* 第 3 类：子图 wrapper 的内部节点（rawJson.definitions.subgraphs[uid].nodes）
   * 不在顶层的 nodes[] 里 —— 但 wrapper 展开之后它们是 detail.nodes /
   * detail.graph 的一部分（服务端把它们拼在 `<wrapperId>:<internalId>` 键下）。
   * 没有这个循环，展开的 wrapper 会以「零个已保存坐标」渲染，
   * 客户端即使在 RAW 视图里也会回落到 Kahn 自动布局 —— 那永远不像 ComfyUI 的样子。
   * 内部节点的 `pos` **本来就是**绝对画布坐标（LiteGraph 对顶层节点与子图节点
   * 存的都是绝对位置），所以**不能**再往上加 wrapper.pos。 */
  //
  /* 第 3 类的查表修正：`definitions.subgraphs` 的键是数字下标 "0"、"1"…，
   * **不是** wrapper 的 UUID。wrapper 的 UUID 藏在每个子图定义里的 `sub.id`。
   * 因此必须遍历所有条目，按 `sub.id === wrapper.type` 去匹配
   *（在 ComfyUI 的格式里，wrapper 的 `type` 就是子图 UUID）。 */
  const subs = raw.definitions?.subgraphs;
  if (subs && typeof subs === "object") {
    for (const wrapper of raw.nodes) {
      if (!wrapper || typeof wrapper.type !== "string") continue;
      if (!Array.isArray(wrapper.pos)) continue;
      const wId = String(wrapper.id);
      let innerNodes: RawNode[] | undefined;
      for (const k of Object.keys(subs)) {
        const def = subs[k];
        if (def?.id === wrapper.type && Array.isArray(def.nodes)) {
          innerNodes = def.nodes;
          break;
        }
      }
      if (!innerNodes) continue;
      for (const inner of innerNodes) {
        if (inner && Array.isArray(inner.pos) && inner.pos.length >= 2) {
          const iId = String(inner.id);
          out[`${wId}:${iId}`] = [
            Number(inner.pos[0]) || 0,
            Number(inner.pos[1]) || 0,
          ];
        }
      }
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────
 * 控件名顺序：把 RAW 的 widgets_values 下标还原成可读参数名
 *
 * 只服务**画布展示**：ComfyUI 默认不把未「转成输入」的控件写进 raw 节点
 * `inputs[]`，于是 CLIPTextEncode 的提示词、各类 Loader 的模型名在下标直读时
 * 整段错位/丢失。这里按节点类定义拿到权威顺序，拿不到就退回内置表。
 * 不参与任何格式转换（见文件头）。
 * ────────────────────────────────────────────────────────────────────── */

/**
 * ComfyUI /object_info 的输入定义。
 *
 * ⚠️ 真实结构是 **元组** `[type, options?]`，不是带 `.type` 字段的对象：
 *   "seed":         ["INT",  { default: 0, min: 0, control_after_generate: true }]  // 元组
 *   "model":        ["MODEL", {}]
 *   "sampler_name": [["euler", "euler_ancestral", …], {}]   ← COMBO：首项是候选数组
 * 少数新版（V3 schema）会给对象形式 `{ type: "INT", … }`，这里两种都兼容。
 */
type ObjectInfoInputSpec =
  [unknown, Record<string, unknown>?] | Record<string, unknown>;

interface ObjectInfoClassDef {
  input_order?: { required?: string[]; optional?: string[] };
  input?: {
    required?: Record<string, ObjectInfoInputSpec>;
    optional?: Record<string, ObjectInfoInputSpec>;
  };
  [k: string]: unknown;
}

/** 把 /object_info 的输入定义规范化为 { type, options }。 */
function readInputSpec(spec: ObjectInfoInputSpec | undefined): {
  type: string | null;
  options: Record<string, unknown>;
} {
  if (Array.isArray(spec)) {
    const head = spec[0];
    const options: Record<string, unknown> = spec[1] ?? {};
    // COMBO：候选值以数组形式直接放在首项
    if (Array.isArray(head)) return { type: "COMBO", options };
    return { type: typeof head === "string" ? head : null, options };
  }
  if (spec && typeof spec === "object") {
    const type = spec.type;

    if (Array.isArray(type)) return { type: "COMBO", options: spec };

    if (typeof type === "string") return { type: type, options: spec };
  }

  return { type: null, options: {} };
}

type ObjectInfo = Record<string, ObjectInfoClassDef>;

/** `/object_info` 响应的**形状契约**（外部 HTTP 边界，规范 §5.5）。
 *
 *  只校验我们真正依赖的那两层：顶层是「类名 → 类定义」的 map，且每个类定义是
 *  对象。类定义**内部**（`input` / `input_order` 里几十种 spec 形态）刻意不深验：
 *
 *   ① 那份响应实测约 4.7MB、几百个类；深验要为每个字段建结果对象，代价按量级
 *      放大，而它已经在 20s 超时边上（见下方注释里的实测 5.2s）；
 *   ② 内部字段的读取点本就按形态兜底（`readInputSpec` / `resolveWidgetOrder`
 *      认元组与对象两种写法），拿不准的 spec 最坏只让某个控件退回文本框，
 *      不会把别的类带崩。
 *
 *  这一层挡住的是**真正的失败形态**：上游没就绪时返回 HTML 错误页 / 空串 /
 *  数组 —— 它们在旧写法 `as ObjectInfo` 下会被当成「一份没有类的定义表」，
 *  表现为所有 COMBO 静默退化成文本框，且没有任何日志。 */
const ObjectInfoEnvelopeSchema = z.record(z.string(), z.looseObject({}));

/* 拉取 ComfyUI 的节点类定义（缓存 5 分钟）。 */
let _objectInfoCache: { at: number; data: ObjectInfo } | null = null;
/** 失败负缓存时间戳：ComfyUI 不可达时每次 detail/subgraph 请求都会白等
 *  20s 超时（AbortSignal.timeout）才降级 null，而旧实现失败不写缓存，
 *  导致打开工作流 / 展开子工作流在 ComfyUI 未启动时反复拖慢 20s。
 *  失败后 30s 内直接返回 null，让慢请求只发生一次。 */
let _objectInfoFailedAt = 0;
export async function fetchObjectInfo(): Promise<ObjectInfo | null> {
  if (_objectInfoCache && Date.now() - _objectInfoCache.at < 5 * 60_000) {
    return _objectInfoCache.data;
  }
  if (_objectInfoFailedAt && Date.now() - _objectInfoFailedAt < 30_000) {
    return null;
  }
  try {
    const res = await fetch(`${comfyBase()}/api/object_info`, {
      /* ComfyUI 序列化完整 object_info（~4.7MB）在
       * Node 的 undici fetch 下实测需 ~5.2s 才返回，旧值 2500ms 必然超时返
       * null，导致所有依赖 object_info 的 COMBO 选项解析静默失败（下拉退化
       * 成文本框）。放宽到 20s；object_info 有 5 分钟缓存，慢请求仅 5 分钟
       * 发生一次，放宽不影响常态响应。 */
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const parsed = ObjectInfoEnvelopeSchema.safeParse(await res.json());
    if (!parsed.success) {
      /* 形状不可用 ⇒ 与「拿不到」同一条降级路径（含负缓存），不让坏响应
       * 变成「一份没有类的定义表」这种看不出成因的空表。 */
      _objectInfoFailedAt = Date.now();
      return null;
    }
    const data = parsed.data as ObjectInfo;
    _objectInfoCache = { at: Date.now(), data };
    return data;
  } catch {
    _objectInfoFailedAt = Date.now();
    return null;
  }
}

/* 解析某节点类的控件顺序 —— 即「值是标量的那些输入」按声明顺序排列。
 * 控件就是类型属于 INT / FLOAT / STRING / BOOLEAN / COMBO 的输入。
 * 连接类型（MODEL、LATENT、IMAGE、CONDITIONING、CLIP …）排除在外，
 * 因为它们来自 `links`，而不是 `widgets_values`。 */
const CONNECTION_TYPE_RE =
  /^(MODEL|LATENT|IMAGE|IMAGE_TENSOR|MASK|CONDITIONING|CLIP|CLIP_VISION|CLIP_VISION_OUTPUT|VAE|MODEL_PATCH|GLIGEN|UPSCALE_MODEL|STYLE_MODEL|CONTROL_NET|SIGMAS|NOISE|SAMPLER|MASKED_IMAGE|IMAGE_3D|MESH|VOXEL|MESH_HOLDER|LATENT_3D|LOAD_3D|LATENT_4D|AUDIO|VIDEO|INT_ARRAY|FLOAT_ARRAY|STRING_ARRAY|TRANSFORMERS_MODEL_TENSOR|MT5|MT5_MODEL|CLIP_MODEL|UNET|UNET_TIMESTEP_EMBEDDING)$/i;

/**
 * ComfyUI 前端会在 seed 类 INT 控件后面**自动插入**一个 `control_after_generate`
 * 伪控件（fixed / increment / decrement / randomize），它同样会被序列化进
 * `widgets_values`。不补上这一格，后面所有 widget 都会整体错位一位。
 * 用哨兵名占位，读取点按名字跳过（ComfyUI 的 INPUT_TYPES 里并没有它）。
 */
const CONTROL_SENTINEL = "__control_after_generate__";
const SEED_WIDGET_NAMES = new Set(["seed", "noise_seed"]);

function hasControlAfterGenerate(
  name: string,
  type: string,
  options: Record<string, unknown>,
): boolean {
  if (type !== "INT") return false;
  return (
    SEED_WIDGET_NAMES.has(name) || options?.control_after_generate === true
  );
}

/**
 * 把节点的 raw `inputs[]`（每项带 `widget: {name}`，且可能带 `type`）与
 * `widgets_values[]` 按名字配对，自动跳过 ComfyUI 在 seed 类 INT 控件后
 * 插入的 `control_after_generate` 哨兵槽。
 *
 * ComfyUI 序列化时哨兵紧跟在 seed 值之后，因此 `widgets_values` 比 widget
 * 输入列表多一格——朴素的下标配对（input i → widgets_values[i]）会让 seed
 * 之后的每个控件整体错位一位。这里复刻 `resolveWidgetOrder` 的哨兵插入逻辑，
 * 使下标与磁盘上的顺序严格对齐。
 *
 * 返回 `widgetName → value` 映射；供画布展示用的 raw_inputs 配对（父子图
 * 两个 route 共用），避免重复实现导致再次错位。
 */
export function pairWidgetValues(
  inputs: RawNodeInput[],
  widgetsValues: unknown[],
): Record<string, unknown> {
  // 规范 widget 顺序：按 raw inputs[] 顺序收集 widget 名，并在每个
  // seed/noise_seed INT 控件后插入 CONTROL_SENTINEL（正是 ComfyUI 序列化
  // widgets_values 时的顺序）。
  const order: string[] = [];
  for (const inp of inputs) {
    const wname = inp?.widget?.name;
    if (typeof wname !== "string") continue;
    order.push(wname);
    if (
      SEED_WIDGET_NAMES.has(wname) &&
      (inp.type === "INT" || inp.type === undefined)
    ) {
      order.push(CONTROL_SENTINEL);
    }
  }
  const map: Record<string, unknown> = {};
  order.forEach((name, i) => {
    if (name === CONTROL_SENTINEL) return;
    if (i < widgetsValues.length) map[name] = widgetsValues[i];
  });
  return map;
}

/** 画布 raw_inputs 配对用的「classType → 控件名顺序表」。
 *
 *  object_info 可达时逐类解析，否则退回内置的 {@link FALLBACK_WIDGETS}。
 *  表中每一项对应 `widgets_values` 的一个下标（含 control_after_generate
 *  哨兵槽）。
 *
 *  画布之前只按 raw 节点 `inputs[]` 里的 `widget` 标记配对控件值，
 *  而 ComfyUI **默认不会把未「转成输入」的控件写进 inputs[]** —— 于是
 *  CLIPTextEncode 的提示词、各类 Loader 的模型名整段丢失，节点上一个参数都不显示。 */
export async function fetchWidgetOrderTable(): Promise<
  Record<string, string[]>
> {
  const info = await fetchObjectInfo();
  const table: Record<string, string[]> = {};
  if (info) {
    for (const [clsName, def] of Object.entries(info)) {
      table[clsName] = resolveWidgetOrder(def);
    }
  } else {
    for (const [clsName, list] of Object.entries(FALLBACK_WIDGETS))
      table[clsName] = list;
  }
  return table;
}

/** 把一整个 `widgets_values` 按类定义的控件顺序还原成「控件名 → 值」列表。
 *
 *  老版本 ComfyUI 前端不写 control_after_generate，故长度对不上时自动退到
 *  「无哨兵」顺序。
 *
 *  顺序未知 / 长度仍对不上（自定义节点动态控件）→ 返回 null，调用方退回
 *  旧的游标配对，保证不引入新的错位。 */
export function mapWidgetValuesByOrder(
  widgetOrder: string[] | undefined,
  widgetsValues: unknown[],
): { name: string; value: unknown }[] | null {
  if (!widgetOrder || widgetOrder.length === 0 || widgetsValues.length === 0)
    return null;
  const bare = widgetOrder.filter((name) => name !== CONTROL_SENTINEL);
  const names =
    widgetsValues.length === widgetOrder.length
      ? widgetOrder
      : widgetsValues.length === bare.length
        ? bare
        : null;
  if (!names) return null;
  const out: { name: string; value: unknown }[] = [];
  names.forEach((name, index) => {
    if (name === CONTROL_SENTINEL) return;
    out.push({ name, value: widgetsValues[index] });
  });
  return out;
}

function resolveWidgetOrder(cls: ObjectInfoClassDef | undefined): string[] {
  if (!cls) return [];
  const reqOrder = cls.input_order?.required ?? [];
  const optOrder = cls.input_order?.optional ?? [];
  const req = cls.input?.required ?? {};
  const opt = cls.input?.optional ?? {};
  const out: string[] = [];
  const push = (name: string, defs: Record<string, ObjectInfoInputSpec>) => {
    const spec = defs[name];
    if (!spec) return;
    const { type, options } = readInputSpec(spec);
    if (!type) return;
    // 连接类型的值来自 links，不在 widgets_values 里。
    if (CONNECTION_TYPE_RE.test(type)) return;
    // forceInput 的标量输入被渲染成插槽，同样不占 widgets_values 的位置。
    if (options?.forceInput === true) return;
    out.push(name);
    if (hasControlAfterGenerate(name, type, options))
      out.push(CONTROL_SENTINEL);
  };
  // widgets_values = required 全部 widget + optional 全部 widget 按顺序扁平化，
  // 只取 required 会从第一个 optional 起错位（VHS_VideoCombine / SaveAnimatedWEBP / KJNodes）。
  for (const k of reqOrder) push(k, req);
  for (const k of optOrder) push(k, opt);
  return out;
}

/* 拿不到 /object_info 时，给常见节点类用的控件映射兜底表。
 * 这里的顺序只按「控件输入」的显示顺序排（不含连接），
 * 与 `widgets_values` 在磁盘上的序列化顺序一致。 */
const FALLBACK_WIDGETS: Record<string, string[]> = {
  KSampler: [
    "seed",
    CONTROL_SENTINEL,
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "denoise",
  ],
  KSamplerAdvanced: [
    "add_noise",
    "noise_seed",
    CONTROL_SENTINEL,
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "start_at_step",
    "end_at_step",
    "return_with_leftover_noise",
  ],
  CLIPTextEncode: ["text"],
  CheckpointLoaderSimple: ["ckpt_name"],
  LoraLoader: ["lora_name", "strength_model", "strength_clip"],
  LoraLoaderModelOnly: ["lora_name", "strength_model"],
  EmptyLatentImage: ["width", "height", "batch_size"],
  EmptySD3LatentImage: ["width", "height", "batch_size"],
  VAEEncode: [],
  VAEDecode: [],
  SaveImage: ["filename_prefix"],
  SaveImageAdvanced: ["filename_prefix", "output_type"],
  PreviewImage: [],
  LoadImage: ["image"],
  ImageScale: ["width", "height", "upscale_method", "crop"],
  ImageScaleBy: ["scale_by", "upscale_method"],
  VAELoader: ["vae_name"],
  CLIPSetLastLayer: ["stop_at_clip_layer"],
  CLIPVisionLoader: ["clip_name"],
  DualCLIPLoader: ["clip_name1", "clip_name2", "type", "device"],
  UNETLoader: ["unet_name", "weight_dtype"],
  ControlNetLoader: ["control_net_name"],
  UpscaleModelLoader: ["upscale_model_name"],
};
