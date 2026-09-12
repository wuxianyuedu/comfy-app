/* ── Shared workflow-IO types ──
 *
 * Single source of truth for "what does this custom workflow accept / produce",
 * imported by BOTH client components (src/components/studio/...) and the server
 * router (src/server/api/routers/workflow.ts). Living in `src/lib/` keeps the
 * server from crossing the boundary into `components/`.
 */

/** One exposed pin, as returned by GET /api/workflows/[id]. */
export interface WorkflowIOEntry {
  direction: "input" | "output";
  /** Semantic bucket chosen in IO-edit mode — NOT the data type.
   *  Values: "param" | "widget" | "output" | (free-form for custom kinds). */
  kind: string;
  nodeId: string;
  name: string;
  label?: string;
  /** ComfyUI data type: STRING / INT / FLOAT / BOOLEAN / IMAGE / VIDEO / … */
  type?: string;
  defaultValue?: unknown;
  nodeTitle?: string;
  multiline?: boolean;
  /** mark a widget-backed input as REQUIRED. */
  required?: boolean;
  /** COMBO candidate list resolved from ComfyUI /object_info. */
  options?: string[];
  /** user-defined display order. */
  displayOrder?: number;
  /** author override of `defaultValue`. */
  value?: unknown;
  /** seed 类参数的「控件后行为」（fixed / increment / decrement / random），
   *  与 ComfyUI 的 control_after_generate 对应；仅 seed 类 widget 有意义。 */
  seedMode?: string;
  /** 多模式参数覆盖层。键为模式码，值为该模式下的默认值与可见性。
   *  存在 workflowIO 的 JSON 列内，因此新增模式无需改表结构。 */
  modes?: Record<string, WorkflowIOModeOverride>;
  /** 拥有该 pin 的节点类名（"LoadImage" / "KSampler" / "LoadImageFirstFrame"…），
   *  服务端富化字段（raw 导出优先，API-only 导入退到存库 graph 的 class_type）。
   *  工坊封装要按它区分参考图槽位（首帧 / 尾帧 / 普通参考图）——多个 LoadImage
   *  的 pin 名都叫 `image`，只看名字分不出哪张是首帧。 */
  classType?: string;
  /** 宿主（外层封装）节点 id，**仅在「下钻到子工作流内部」勾选时**写入。
   *
   *  `nodeId` 此时是子图内部节点 id（`1670`），它在顶层画布上不存在；而运行期
   *  comfy-cli 展开子图后的节点 id 是 `4:1670`（宿主 id + 内部 id 用 `:` 拼接）。
   *  两个 id 都存下来，运行期就能确定性地还原拼接形式，不必靠「拿裸 id 去所有
   *  子图定义里扫一遍」的巧合兜底 —— 后者在同名内部 id 或定义缺失时会静默失效
   *  （表现为「改了参数没生效」）。顶层勾选的条目没有本字段。 */
  hostNodeId?: string;
  /** 本层槽位上**作者写的**业务名（与槽位名不同才有值）。
   *
   *  富化链里它排在通用翻译（`localized`）之后，故不参与显示；但它是判定
   *  「本地存的那串是不是机器生成的槽位名」的第二判据：富化名恰好停在槽位名
   *  （`value_1`）时，只有它还能说明本层确实有作者命名。没有它，同名条目在
   *  写入时会被当成作者命名固化回库，显示名随即退回别名（ISSUE #349）。 */
  slotLabel?: string;
}

/** 单个参数在某一个模式下的覆盖项。 */
export interface WorkflowIOModeOverride {
  /** 覆盖该模式下的默认值；undefined = 不覆盖，回退到通用默认值。 */
  defaultValue?: unknown;
  /** 该模式下是否显示此参数；undefined = 显示（默认可见）。 */
  visible?: boolean;
  /** 该模式下是否标记为必填；undefined = 不覆盖，回退到条目级 required。 */
  required?: boolean;
  /** 该模式下 seed 类参数的「控件后行为」（fixed / increment / decrement /
   *  random）；undefined = 不覆盖，回退到条目级 seedMode。 */
  seedMode?: string;
}

export type WorkflowIOMap = Record<string, WorkflowIOEntry>;

/** 该参数在指定模式下是否可见。未开启模式（mode 为空）时一律可见。
 *
 *  入参刻意只要求「带 modes 字段」这一结构子集，这样派生产物
 *  （WorkflowIOEntry & { ioKey, control } 等）也能直接传进来。 */
export function isVisibleInMode(
  entry: { modes?: Record<string, WorkflowIOModeOverride> } | undefined | null,
  mode?: string | null,
): boolean {
  if (!entry || typeof entry !== "object") return true;
  if (!mode) return true;
  return entry.modes?.[mode]?.visible ?? true;
}

/** 参数默认值的两级回退：模式默认值 → 作者覆盖值(value) → 通用默认值。
 *
 *  注意顺序：模式默认值优先级最高（它就是"该模式下应该用这个"的显式声明），
 *  其次才是作者在 IO 编辑里写的通用覆盖 value，最后才是工作流图里读出的 defaultValue。 */
export function resolveEntryDefault(
  entry: WorkflowIOEntry,
  mode?: string | null,
): unknown {
  if (mode) {
    const modeDefault = entry.modes?.[mode]?.defaultValue;
    if (modeDefault !== undefined) return modeDefault;
  }
  if (entry.value !== undefined) return entry.value;
  return entry.defaultValue;
}

/** 参数 required 的两级回退：模式覆盖值 → 条目级 required。
 *
 *  与 resolveEntryDefault 同语义——模式覆盖只写在 modes[mode].required，
 *  未设置该字段的模式回退到条目级（工作流库/画布等未传 mode 的消费方
 *  仍按旧行为读取 entry.required）。未开启模式（mode 为空）时只读条目级。 */
export function resolveEntryRequired(
  entry: WorkflowIOEntry | undefined | null,
  mode?: string | null,
): boolean | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  if (mode) {
    const modeRequired = entry.modes?.[mode]?.required;
    if (modeRequired !== undefined) return modeRequired;
  }
  return entry.required;
}

/** 参数 seedMode 的两级回退：模式覆盖值 → 条目级 seedMode。
 *
 *  与 resolveEntryRequired 同语义，按模式解析「控件后行为」，
 *  undefined = 该参数不是 seed / 该模式无覆盖，回退条目级 seedMode。 */
export function resolveEntrySeedMode(
  entry: WorkflowIOEntry | undefined | null,
  mode?: string | null,
): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  if (mode) {
    const modeSeed = entry.modes?.[mode]?.seedMode;
    if (modeSeed !== undefined) return modeSeed;
  }
  return entry.seedMode;
}

/** 收集整张 IO 表里出现过的全部模式码（去重、保持稳定顺序）。 */
export function collectModeCodes(
  io: WorkflowIOMap | null | undefined,
): string[] {
  const seen = new Set<string>();
  for (const entry of Object.values(io ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    for (const code of Object.keys(entry.modes ?? {})) {
      if (code) seen.add(code);
    }
  }
  return [...seen];
}

/** ── 映射连线的锚点契约（宿主卡片那一端的 data 属性） ──
 *
 * 工作流库的只读映射连线（`WorkflowParamWires`）要量出「卡片圆点 → 宿主卡片上
 *  被落到的那一行」，靠的就是行上的锚点属性。端口键（ioKey）里**可能含 `::`**
 *  （端口名本身带分隔符），所以量测一律走 `getAttribute` 精确比较，不做选择器
 *  转义 —— 两边必须用同一套属性名，故收在这里，禁止各处手写字符串。
 *
 *  两种落点形状：
 *   · 独立参数行（`WidgetInputRow` / 端口行）：整行一个锚点；
 *   · 组合参数（`DimensionControl` / `VideoControl`）：宽高、比例/像素由同一个
 *     控件录入，没有独立的一行可以连 —— 锚点挂在整块控件上，线指向的就是那一格。
 */

/** 独立参数行上的落点锚点（值 = 该行的 ioKey）。 */
export const WIRE_ROW_ATTR = "data-io-key";

/** 组合参数控件上的落点锚点（值 = 该控件覆盖的 ioKeys，逗号分隔）。 */
export const WIRE_PINS_ATTR = "data-io-pins";

/** 组合参数锚点的值（覆盖到的 ioKeys）。 */
export function wirePinsValue(ioKeys: readonly (string | undefined)[]): string {
  return ioKeys.filter((key): key is string => Boolean(key)).join(",");
}
