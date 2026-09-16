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
  /** 图内**语义角色**：由导入图的 KSampler `positive`/`negative` 连线链推出来的
   *  正向 / 反向文本编码节点（见 `comfyui/workflow.ts` 的 `detectParamMap`）。
   *
   *  为什么必须有它：ComfyUI 的同一对 CLIPTextEncode 两个 pin 都叫 `text`、
   *  显示名都是「文本」，靠 pin 名 / 标签**分不出正负**——只有采样器上的
   *  `positive` / `negative` 两条 conditioning 连线才说得清。缺了它，「负向
   *  提示词」这条契约口就永远判不出来，工作流库「画布节点」页签也因此少一张
   *  负向卡片（ISSUE #611：明明配了负面提示词，画布节点上看不到）。
   *
   *  取值只在**能确定**时给出（顶层节点命中 `paramMap.positiveNode` /
   *  `negativeNode` 才写），推断不出就不写 —— 宁可不显示，也不猜错正负。 */
  role?: "positive" | "negative";
  /** 该条目是否出自图内的**文本编码节点**（类名带 `TextEncode` 的那一类）。
   *
   *  为什么要它：`role` 只在「条目确实落在 `paramMap` 的正 / 负节点上」时才下发，
   *  而大量 T2I 工作流把正向写死在自己的 CLIPTextEncode、另接一个第三方节点
   *  （提示词润色 / 翻译 / 模型自带负向）承接负向 —— 承载负向的那一行拿不到
   *  `role`，分类判据（`classifyPin` / `classifyWorkshopPin`）就判不出「负向
   *  提示词」这一口，同一个页面两个页签会因此对不上（ISSUE #620）。
   *
   *  有了它，客户端可以在「判不出 `role`」时把候选收窄到图内这一小撮文本编码
   *  节点上做有限兜底：它们是图文工作流里唯一会承接提示词的一类节点，能列出
   *  来的组合是封闭的，不会把「尺寸」这类口也编出正负。 */
  isTextNode?: boolean;
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
