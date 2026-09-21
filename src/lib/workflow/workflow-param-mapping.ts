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
 *   2. `resolveMapping`     读出**作者画的线**（`paramMap.source.mode:<模式>`）：
 *      某个口落在哪一行，只由这条线决定；
 *   3. `applyParamMapping`  把映射落到运行时载荷上（`workflowInputs` 三元组）。
 *
 * **落点完全依赖作者画线，没有「猜一个默认落点」这回事**（ISSUE #632）：曾经的
 * `autoMapEntries` 按端口名字启发式给每个口挑一行，命中不了就退到「该节点上第一个
 * 标量口」。问题是**猜错的时候用户无从察觉** —— 页面默认显示的落点看着就像作者
 * 自己连的，跑起来值落到别处。作者画的线永远比猜得准，所以猜的那一层整条去掉：
 * 没有线就是**未配置**（如实显示），要么作者连，要么这个口本来就不需要。
 *
 * 落库位置：沿用既有的 `paramMap` JSON 列，`source` 命名空间下**只按模式**存放
 * 作者连过的线，键写作 `source.mode:<模式>`（值 = `{ <entryId>: ioKey | null }`）。
 *
 * 为什么没有「与模式无关的覆盖」：留一个通用层只会让「这条覆盖到底哪个模式在
 * 生效」变成需要推理的问题，两套键空间互相覆盖也正是丢覆盖的历史根因。因此没有
 * 选中模式时**写入是空操作**，每条覆盖都归属一个模式。
 *
 * 本模块**只产出数据**：运行期由 `applyParamMapping` 按作者画的线严格落值（没
 * 有线就不落）。工作流库「画布节点」页签上的三列 React Flow 节点（卡片列 /
 * 宿主卡片 / 输出卡片列）是同一份数据的视图（`workflow-library-param-cards` +
 * `WorkflowLibraryCanvas`）—— 拖线即编辑落点，映射没有第二套界面。
 *
 * 拆包：分类模型与判定 / 展示类纯函数（`ParamClass` / `PinFamily` /
 * `SIZE_CLASSES` / `ParamEntry` / `paramOutputPorts` / `wiredTargetsForEntry`
 * 等 15 个符号）已下沉到 `./workflow-param-classes.ts`（叶子模块）。本文件
 * 只做**映射**（组装 / 存储 / 解析 / 落值 / 布局常量）并把分类符号 re-export
 * 回来；消费者 import 路径不变。
 */

import {
  exposedClassOf,
  exposedParamDisplayLabel,
  exposedParamsForMode,
} from "~/lib/workflow/workflow-exposed-params";
import {
  alignMultipleOf,
  aspectLabelForDims,
  megapixelsForSize,
  resolutionTierOf,
  resolutionTierOfLabel,
  sceneFromMode,
  type SizeScene,
} from "~/lib/media/size-presets";
import type {
  WorkflowIOEntry,
  WorkflowIOMap,
} from "~/lib/workflow/workflow-io-types";
import type {
  ParamClass,
  ParamEntry,
  PinFamily,
} from "./workflow-param-classes";
import {
  CLASS_FAMILY,
  SIZE_SUB_IDS,
  candidateClasses,
  isSizeClass,
  nodeIdOfIoKey,
  pinFamily,
  sizeSubLabel,
  wiredTargetsForEntry,
} from "./workflow-param-classes";

export * from "./workflow-param-classes";

/* 注：一条映射线**一定**来自作者画的线 —— 落点本身不可能凭空产生（见
 *  `resolveMapping`：没有线就没有落点）；也没有「组合控件摊开成多条线」这回事
 *  （每个条目只画它连上的那一条）。
 *
 *  库内卡片圆点的 handle id 与落点**同键空间**（都是 ioKey，只有尺寸卡取子口
 *  id），因此两端不需要任何换算函数 —— 这也是原先那个「按端口名换算」的口径
 *  被删掉的原因：同名 pin（两个节点各有一行 `text`）会在同一节点里撞出重复
 *  handle id。 */

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
  options?: {
    mode?: string | null;
    /** **该模式生效的契约口清单**（`modeContractEntries(mode, storedContracts)`
     *  的 id）。不传 = 按内置默认（`exposedParamsForMode`）。
     *
     *  必须传的情形：模式契约被用户改过（契约编辑器里标「已改」）。内置默认只是
     *  「没改过时」的回落 —— 拿它当口径会让画布多列出契约里没有的口（用户报的
     *  「画布上有时长，模式契约里没有」），也会漏掉用户在契约里**新增**的口。 */
    contractIds?: readonly string[];
  },
): ParamEntry[] {
  /* 只有一条构造路径：契约（按模式 / 按该模式生效的契约清单）。没有模式语境时退
   *  到最保守的一套（提示词 + 尺寸）。旧版「按节点 + 端口名分类聚类」那条路已删除
   *  —— 对外有哪些参数只由契约决定，工作流里的内部参数（步数 / CFG…）不再是
   *  「对外参数」。 */
  return buildContractEntries(
    io,
    labels,
    options?.mode ?? null,
    options?.contractIds,
  );
}

/** 契约驱动的条目构造（有模式语境时的唯一路径）。 */
function buildContractEntries(
  io: WorkflowIOMap | null | undefined,
  labels: Record<string, string> | undefined,
  mode: string | null,
  contractIds?: readonly string[],
): ParamEntry[] {
  const pinsByClass = classifyPins(io);

  /* 口子的来源：调用方给的**生效契约**优先；没给才回落内置默认。两边都只提供
   * 「有哪些口、按什么顺序」，落点仍由映射表决定。 */
  const defs: Array<{ id: string; cls: ParamClass | null }> = contractIds
    ? contractIds.map((id) => ({ id, cls: exposedClassOf(id) }))
    : exposedParamsForMode(mode).map((def) => ({ id: def.id, cls: def.cls }));

  const out: ParamEntry[] = [];
  for (const def of defs) {
    /* 认不出的 id（历史脏数据 / 别的键空间）不列：映射层没有它的分类，也就没有
     *  任何可落点的候选，列出来只会是一张永远「未配置」的卡。 */
    if (!def.cls) continue;
    /* 「尺寸」在映射层摊成四个子口（`SIZE_SUB_IDS`）：形态由作者连到哪个子口
     * 声明，不再从端口名里猜。对外契约仍是那一个「尺寸」口 —— 工坊送来的
     * `values.size` 由运行期按子口身份派成各自认的形状（见 sizeValueForPin）。 */
    const ids: readonly string[] = def.cls === "size" ? SIZE_SUB_IDS : [def.id];
    for (const id of ids) {
      if (out.some((entry) => entry.id === id)) continue;
      const cls = (def.cls === "size" ? id : def.cls) as ParamClass;
      const pins = pinsByClass.get(cls) ?? [];
      const override = pins.map((pin) => labels?.[pin.ioKey]).find(Boolean);
      out.push({
        id,
        /* 落点由映射表决定，`nodeId` 不带宿主节点（分组展示不需要它）。 */
        nodeId: "",
        /* 卡片挂载 / 连线需要宿主节点 id：取候选端口所属的节点（首个候选）。
         * 契约条目跨节点的情况不存在（一个口子落到一个节点的某一行），首个候选
         * 即最近可用近似。 */
        hostNodeId: nodeIdOfIoKey(pins[0]?.ioKey ?? ""),
        nodeTitle: "",
        cls,
        label:
          override ??
          (def.cls === "size"
            ? sizeSubLabel(cls)
            : exposedParamDisplayLabel(def.id)),
        pins,
      });
    }
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
  /** 三份**按类型**收的候选池：一族一份，族内所有对外参数共享。
   *
   *  形态 / 正负 / 首尾都由作者连线声明，所以每个口都摆出它那一族的全部候选，
   *  作者连哪一行、那一行就是它的落点。按名字筛候选等于替作者认定「这个口是
   *  宽度 / 这个口是正向」——那正是要消掉的那层猜测。 */
  const pools: Record<PinFamily, ParamEntry["pins"]> = {
    text: [],
    image: [],
    number: [],
  };
  for (const [ioKey, raw] of Object.entries(io ?? {})) {
    const entry = raw as WorkflowIOEntry | undefined;
    // 显式空值守卫：`pinFamily(entry)` 的契约本就要求 entry 非 undefined 才
    // 可能返回真 family，但编译器看不到——原实现里 push 的三行 `entry!.xxx`
    // 是把这一契约「用两次」（判据 + 断言）；改成同行守卫后判据与窄化同源。
    if (!entry) continue;
    const family = pinFamily(entry);
    if (!family) continue;
    pools[family].push({
      ioKey,
      name: entry.name,
      type: entry.type ?? "*",
      defaultValue: entry.defaultValue,
    });
  }
  const pinsByClass = new Map<ParamClass, ParamEntry["pins"]>();
  for (const klass of Object.keys(CLASS_FAMILY) as ParamClass[]) {
    /* 聚合值 `size` 不单独摆候选：契约层把它摊成六个子口。 */
    if (klass === "size") continue;
    const family = CLASS_FAMILY[klass];
    if (!family || pools[family].length === 0) continue;
    pinsByClass.set(klass, [...pools[family]]);
  }
  return pinsByClass;
}

/* ── 历史键的兼容读取 ──
 *
 * 统一参数表的键曾经是 `<节点 id>|<分类>`（`5|size-width`）——那是「按工作流
 * 聚类」时代的产物。现在键变成契约口子（`size` / `prompt`…），作者当年连过的
 * 线若只按新键去查会落空，表现就是「改了落点没生效」（不报错，静默显示成「未配置」）。
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
  /** 作者改过的「对外参数名」（ioKey → 名字）。 */
  labels?: Record<string, string>;
}

/** 解析某一模式下生效的「对外参数 id → 目标 ioKey」表。
 *
 *  **判据只有一条：作者在这个模式里画的线**（`manualByMode[mode]`）。没有线
 *  的口子**不出现在结果里** —— 调用方按「取不到 = 未配置」如实呈现，绝不替作者
 *  猜一个落点（见文件头：猜错了用户看不出来）。
 *
 *  `manualByMode` 的形状是 `{ [mode]: { [entryId]: ioKey | null } }` —— 按
 *  **模式**归拢，与落库的 `source.mode:<模式>` 一一对应；查一次即得该模式下
 *  所有被作者改过的线。显式 `null`（作者断开）**保留在结果里**（值就是 `null`），
 *  它与「没连过」在语义上不同：前者是「这条口故意不接」，后者是「还没配」。
 *  `io` 只用于**校验落点仍然存在**（端口被改名 / 移除后，一条指向不存在端口的
 *  线会让运行期静默落不到值 —— 这种线按未配置处理，与画布上画不出线一致）。 */
export function resolveMapping(
  entries: readonly ParamEntry[],
  io: WorkflowIOMap | null | undefined,
  mapping: ParamMapping | null | undefined,
  mode?: string | null,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  /* 只读一份（本函数不再给任何旧键补位，没有要写回的东西）。 */
  const manual: Record<string, string | null> =
    (mode ? mapping?.manualByMode?.[mode] : undefined) ?? {};
  for (const entry of entries) {
    const hit = manualTargetForEntryRaw(manual, entry);
    if (!hit.found) continue;
    if (hit.target !== null && io && !io[hit.target]) continue;
    out[entry.id] = hit.target;
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

/** 拆分前「尺寸」在映射表里的**单键**（落点形态靠端口名推）。
 *
 *  现在形态由子口身份声明（`SIZE_SUB_IDS`：`size-width` / `size-aspect`…），
 *  这个键不再有任何写入入口（`entry.id` 只会是子口 id）—— `parseParamMapping`
 *  读到即丢，下一次落库它就从 `paramMap` 里消失，不必等一次手工迁移。 */
const LEGACY_SIZE_ENTRY_ID = "size";

/** 从持久化的 `paramMap` 反序列化映射。
 *
 *  只认 `source.mode:<模式> = { <entryId>: ioKey | null }` 这一种形状（与
 *  serializeParamMapping 一一对应）。没有 `mode:` 前缀的键（通用手工线的历史
 *  形状，如 `source.<entryId>`）一律**丢弃**：那些无模式的线在新模型里没有
 *  生效语境，留着只会让「这条线哪个模式用」无从判定。
 *
 *  拆分前落库的单键 `size` 线同样丢弃（见 `LEGACY_SIZE_ENTRY_ID`）：形态现在
 *  只由子口身份声明，那个键谁都读不到，留着只会在库里原样往返。
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
      /* 存量清理：那个键没有任何入口能再写出来，读到即丢（下面 `byEntry` 里没它，
       *  序列化自然也不会把它写回去）。 */
      if (entryId === LEGACY_SIZE_ENTRY_ID) continue;
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
 *  表示该模式下作者显式断开，必须一起落库 —— 不落的话刷新后它就成了「还没连过」。
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
  if (mode) delete out.manualByMode![mode];
  return out;
}

/** 映射落点（`resolved` 的值，= ioKey）→ 画布渲染侧那条端口的 **React Flow
 *  handle id**。
 *
 *  ⚠️ 现状：画布渲染侧**直接用 ioKey 当 handle id**（见 WidgetInputRow 的
 *  `handleId`）。`pin 名` 这个旧口径在「两个节点
 *  有同名 pin」时会让边接到同名 handle 的第一处 —— 表现就是「线连到了别的节点
 *  上」。库内卡片圆点（`paramOutputPorts` 的 `handleId`）同样取 ioKey（尺寸卡取
 *  子口 id），两处同键空间、不再需要换算函数。
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
  /** 场景（图片 / 视频）：`1k` 在两种场景下不是同一组宽高，反解档位要按场景查表。 */
  scene: SizeScene,
): unknown {
  if (!isSizeClass(entry.cls)) return supplied;
  const raw = io?.[ioKey];
  if (!raw) return supplied;
  const dims = /^(\d+)\s*[xX×]\s*(\d+)$/.exec(String(supplied).trim());
  if (!dims) return supplied;
  const width = Number(dims[1]);
  const height = Number(dims[2]);
  /* 形状由**子口身份**给出：作者连的是「尺寸 · 宽高比」，值就按比例标签派 ——
   * 端口叫什么名字不参与判定。 */
  switch (entry.cls) {
    case "size-width":
      return width;
    case "size-height":
      return height;
    case "size-aspect": {
      const label = aspectLabelForDims(width, height, raw.options);
      return label ?? undefined;
    }
    case "size-resolution": {
      const tier = resolutionTierOf(scene, width, height);
      if (!tier) return undefined;
      const options = Array.isArray(raw.options) ? raw.options : [];
      if (options.length === 0) return tier;
      /* 端口声明了自己的候选（`1k` / `1K` / …）→ 挑与档位同名的那个。挑不到就
       *  不写：写一个不在候选里的值只会被 ComfyUI 静默回落到第一个选项。 */
      return options.find((option) => resolutionTierOfLabel(option) === tier);
    }
    case "size-multiple": {
      /* 倍数：由宽高反推能整除两侧的最大候选（与工坊 `sizeSpecMultiple` 同源）。 */
      const multiple = alignMultipleOf({ width, height });
      const options = Array.isArray(raw.options) ? raw.options : [];
      if (options.length === 0) return multiple;
      return options.find((option) => Number(option) === multiple);
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
 *  · 作者画过线的口：用户值只落到那条线指向的端口（线说了算，避免把整节点默认值
 *    硬塞进去盖掉图内其它逻辑）；作者显式断开（`null`）→ 值落不上，如实进
 *    `unmatched`；
 *  · 没画线的口：**不认用户值**（没有落点可落，不替作者猜），只按工作流默认值
 *    兜底 —— 与「未连线的口就用工作流自己的默认值」一致。 */
export function applyParamMapping(args: {
  io: WorkflowIOMap | null | undefined;
  entries: readonly ParamEntry[];
  mapping: ParamMapping | null | undefined;
  values: Record<string, unknown>;
  mode?: string | null;
}): { inputs: MappedInput[]; unmatched: string[] } {
  const { io, entries, mapping, values, mode } = args;
  const resolved = resolveMapping(entries, io, mapping, mode);
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

  /* ①② 同一趟遍历：先看「用户给了值的口」落到哪，再给**没落上的口**按工作流默认值
   *   兜底。分两趟会让「这条口到底该不该兜底」在第二趟重新判一遍，而那个判据与
   *   第一趟的实际结果极易走散 —— 例如落点存在但尺寸形状算不出：第一趟没落上、
   *   第二趟却因为「有落点」跳过兜底，参数两边都不下发（提交给 ComfyUI 的载荷里
   *   凭空少一格）。一趟走完，`suppliedEntries` 是唯一判据。
   *
   *   `values` 有两个来源：工坊侧按**契约 id**（`prompt` / `size`）给值；运行期
   *   表单按 **ioKey** 给值（DynamicWorkflowForm 的行键）。两者都要接住 ——
   *   只认一种就会让另一种静默失效（表现为「改了没生效」）。 */
  const suppliedEntries = new Set<string>();
  for (const entry of entries) {
    const byContract =
      values[entry.id] ??
      /* 尺寸的对外值只有一个（工坊按契约 id `size` 给 `"832x1216"`），四个子口
       * 各自按自己的形态取用它。 */
      (isSizeClass(entry.cls) ? values.size : undefined);
    /* 候选按类型收 ⇒ 候选集合是**重叠**的（同族几个口子摆的是同一份候选），只有
     *  **落点那一行**的值才属于这个口子 —— 否则用户在参数面板改了「步数」，会被
     *  当成「尺寸 · 宽」写进宽度那一行。 */
    const target = resolved[entry.id];
    const byPinKeys = target ? values[target] : undefined;
    const supplied = byContract ?? byPinKeys;
    if (supplied === undefined) continue;
    /* 一个对外参数可能接到**多个端口**（「尺寸」的宽高比 / 像素量由同一块控件
     *  录入，作者把这几条线都连到同一个口上）。这时要把同一个对外值派生成每个
     *  端口各自认的形状，逐个下发 —— 只往其中一条线写，作者连出来的另外两条就
     *  从外部拿不到值（ISSUE #355：「尺寸那三项每一项都需要从外部获取值」）。 */
    const targets = wiredTargetsForEntry({ target });
    let pushed = false;
    for (const target of targets) {
      if (!io?.[target.ioKey]) continue;
      const perPort = sizeValueForPin(
        io,
        entry,
        target.ioKey,
        supplied,
        sceneFromMode(mode),
      );
      if (perPort === undefined) continue;
      push(target.ioKey, perPort);
      pushed = true;
    }
    /* 有落点但**没落上**（端口已消失 / 尺寸形状算不出）也要如实记 —— 否则用户
     * 改了值、任务跑出来还是旧值，而界面上没有任何地方说「这个口没接上」。 */
    if (pushed) suppliedEntries.add(entry.id);
    else unmatched.push(entry.id);
  }

  /* 不兜底候选：候选是**按类型**收来的（同族几个口子摆的是同一份候选：宽 / 高 /
   *  比例 / 像素量与步数 / CFG 混在一起），逐个下发它们的工作流默认值会把作者
   *  没连过的口一起写进载荷。连线的意义就是声明落点 —— 没连就是「未配置」，
   *  工作流图内自带的默认值照旧生效。 */
  return { inputs, unmatched };
}

/* ── 对外参数卡片的视觉常量（纯派生，无 React / 无 IO） ──
 *
 * 卡片本体 `WorkflowParamCard` 用这里的行高常量。谁都不许自己再写一套字面量：
 * 卡片高度各写一份，线就会连到卡片外面去。
 *
 * **画布几何（节点 id 前缀 / 卡片坐标 / 卡片高度推算）已随编辑器卡片一起删除**：
 * 卡片现在只出现在工作流库详情的「画布节点」页签，位置与三列布局由 React Flow
 * 的节点坐标（`workflow-library-wire-graph` 的 `layoutLibraryNodes`）承担，
 * 这里不需要第二套几何。
 */

/** 卡片头（标题）行高。 */
export const PARAM_NODE_HEADER_H = 26;

/** 输出端口区的行高（视觉上就是一行带类型徽标的端口）。
 *
 *  此前这里还有 `PARAM_NODE_ROW_H` / `PARAM_NODE_PAD_Y` / `PARAM_NODE_DOT_SIZE`
 *  / `PARAM_NODE_DOT_OFFSET` 四个常量，实测全库（含测试）零消费 —— 它们描述
 *  的是「输入列与输出列的卡片列布局」，而那套布局早已随编辑器卡片一起删除
 *  （见本段的文件头注释），只剩输出端口行还在用。按 §12.15 第三条删除：
 *  需要时再引入，代价远低于长期维护一批「看起来在管几何、实际谁都读不到」的
 *  常量。 */
export const PARAM_NODE_OUTPUT_ROW_H = 22;
