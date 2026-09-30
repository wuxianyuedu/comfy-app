/**
 * `raw-overrides.ts` — 两种载荷的 canvas 覆盖注入（纯函数）
 * ===========================================================================
 *
 * 从 executor-cli.ts 抽出的「把 canvas `workflowInputs` 注入执行载荷」纯逻辑
 * 模块。不依赖数据库 / 网络，可独立单测。
 *
 * 供 executor-cli 的 comfy-cli 提交路径在写临时工作流文件前调用，把前端下发的
 * `(nodeId, name, value)` 覆盖项写进载荷。**两种格式走同一套语义**，只是落点
 * 不同（这是「api 也要注入画布覆盖」的落地处）：
 *   - RAW UI-format → {@link applyRawOverrides}：值躺在 `widgets_values` 下标里，
 *     要按控件名反查到下标（并跳过 seed 的 `control_after_generate` 哨兵槽）；
 *   - API 图        → {@link applyApiOverrides}：`inputs` 是命名 map，按名字直接写。
 *
 * raw 侧的子图（subgraph）wrapper 覆盖项会额外同步到内层节点：wrapper 只是把
 * 内层控件「提升」出来的宿主，真正参与 UI→API 转换的是内层节点的
 * `widgets_values`（comfy-cli 展开子图后读的是内层值），只改 wrapper 不改内层
 * 会让覆盖在转换阶段被内层默认值覆盖回去。
 *
 * @module comfyui/raw-overrides — 两种载荷的 canvas 覆盖注入（纯函数）
 */

import { z } from "zod";

import { randomSeed } from "./random-seed";

/** 任意 JSON 对象的宽松视图（外部输入的中间层窄化用）。 */
export type JsonRecord = Record<string, unknown>;

/* ── 形状契约（外部输入边界，规范 §5.5）────────────────────────────────
 * 本模块只对「**身份字段**」做硬约束 —— 节点 / 子图定义要能被查表找到，靠的
 * 就是 `id`。其余字段（`inputs` / `widgets_values` / `nodes` / `links`）刻意
 * 保持宽松：它们是**用户可扩展且各版本漂移**的结构，把 schema 收紧会让「一个
 * 字段形态不认识」升级成「整条覆盖项静默不生效」—— 那正是 ISSUE #349 反复
 * 修的那类症状（改了参数没反应，且没有任何报错）。所以这里用「校验身份 +
 * 逐字段容错读取」，而不是「整条结构一次校验通过才认」。 */
const UiNodeIdentitySchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
});
const SubgraphIdentitySchema = z.looseObject({ id: z.string() });

/** 前端下发的工作流覆盖项（nodeId / name / value）。 */
export type RawWorkflowOverride = {
  nodeId: string;
  name: string;
  value?: unknown;
};

/**
 * Raw UI-format（LiteGraph）节点输入槽的最小结构视图 —— 字段随节点类型
 * 漂移，只取本模块读写（`name` / `widget`）的部分，其余原样保留。
 */
export type RawUiNodeInput = {
  name?: unknown;
  widget?: unknown;
};

/**
 * Raw UI-format（LiteGraph）节点的最小结构视图 —— 只取注入
 * `widgets_values` 所需的字段（`id` / `inputs` / `widgets_values`）；
 * `type` 用于判断该节点是否为子图 wrapper（`class_type` 为子图 UUID）。
 */
export type RawUiNode = {
  id?: unknown;
  type?: unknown;
  inputs?: RawUiNodeInput[];
  widgets_values?: unknown[];
};
/** 把 API 格式的节点 id（例如 "4:1670"）或顶层 id 映射到原始 UI 节点。
 *
 *  子图内部的覆盖项落库时会把「宿主 id 链」与「内部节点 id」都记下来，运行期
 *  拼成 comfy-cli 展开后的 `4:1670`（嵌套时 `4:5:1670`）。本函数按这条链**逐层
 *  下钻**：每一段在前一层的节点表里找到 wrapper，取它的 `type`（子图 UUID）定位
 *  子图定义，再用下一段在该定义里继续找 —— 而不是「拿最后一段的裸 id 去所有
 *  子图定义里扫一遍」。后者在同名内部 id、或定义缺失时会撞上错的节点 / 静默
 *  落空（`slot < 0 → continue`，用户看到「改了没生效」），逐层下钻才是确定性的。 */
function resolveRawNode(raw: JsonRecord, nodeId: string): RawUiNode | null {
  const findInNodes = (nodes: unknown, id: string): RawUiNode | null => {
    if (!Array.isArray(nodes)) return null;
    for (const x of nodes) {
      const parsed = UiNodeIdentitySchema.safeParse(x);
      if (!parsed.success) continue;
      if (String(parsed.data.id) === id) return parsed.data;
    }
    return null;
  };

  if (!nodeId.includes(":")) {
    const top = findInNodes(raw.nodes, nodeId);
    if (top) return top;
    /* 存量兜底：入库时还不知道「宿主 id」的旧数据，内部节点只存了裸 id
     *  （`1670`）。新数据一律带宿主 id 走上方确定性下钻；这里仅为已在库的
     *  旧行保留「在子图定义里找同名内部节点」的最后兜底，找不到就是找不到
     *  —— 顶层确实没有这个 id 时返回 null 好过误写到别处。 */
    for (const sub of subgraphDefs(raw).values()) {
      const found = findInNodes(sub.nodes, nodeId);
      if (found) return found;
    }
    return null;
  }

  const segments = nodeId.split(":").filter((seg) => seg !== "");
  if (segments.length < 2) return null;

  const defsByUid = subgraphDefs(raw);
  let currentNodes: unknown = raw.nodes;
  let node: RawUiNode | null = null;
  for (let i = 0; i < segments.length; i++) {
    node = findInNodes(currentNodes, segments[i]!);
    if (!node) return null;
    if (i === segments.length - 1) return node;
    /* 还有下一段 ⇒ 本节点必须是子图 wrapper：用它的 `type`（子图 UUID）定位
     *  子图定义，下一段在该定义的 nodes 里继续找。 */
    const classType = typeof node.type === "string" ? node.type : undefined;
    const sub = classType ? defsByUid.get(classType) : undefined;
    if (!sub || !Array.isArray(sub.nodes)) return null;
    currentNodes = sub.nodes;
  }
  return node;
}
/** 认 RAW（UI 格式）图里某个节点的类名（`nodes[].type`；子图内部节点按宿主链下钻）。
 *
 *  这个出口只为一件事存在：让「WS 帧回来的节点 id → 类名」与「画布覆盖注入找到那个
 *  节点」用的是**同一条定位逻辑**（`resolveRawNode`），两处各算各的迟早会给出不同的
 *  节点（消费方见 `graph-node-class.ts`，ISSUE #1202）。 */
export function rawUiNodeType(
  raw: unknown,
  nodeId: string,
): string | undefined {
  if (!raw || typeof raw !== "object" || !nodeId) return undefined;
  const type = resolveRawNode(raw as JsonRecord, nodeId)?.type;
  return typeof type === "string" && type ? type : undefined;
}
/** 具名控件输入在 UI 节点 `widgets_values` 数组里的下标。 */
function widgetSlot(node: RawUiNode, name: string): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (inp?.widget) {
      if (inp.name === name) return slot;
      slot++;
    }
  }
  return -1;
}
/** seed 类控件在 UI 节点 `widgets_values` 数组里的下标。
 *  节点上没有 seed 类控件时返回 -1。 */
function seedWidgetSlot(node: RawUiNode): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const w = inp.widget;
    const wname =
      typeof w === "string"
        ? w
        : w != null && typeof w === "object"
          ? ((w as JsonRecord).name ?? inp.name)
          : inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname))
      return slot;
    slot++;
  }
  return -1;
}
/** UI 节点上 seed 类控件输入的名字（没有则为 null）。 */
function seedWidgetName(node: RawUiNode): string | null {
  const inputs = node?.inputs ?? [];
  for (const inp of inputs) {
    if (!inp?.widget) continue;
    const w = inp.widget;
    const wname =
      typeof w === "string"
        ? w
        : w != null && typeof w === "object"
          ? ((w as JsonRecord).name ?? inp.name)
          : inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) {
      return typeof inp.name === "string" ? inp.name : String(wname);
    }
  }
  return null;
}
/** 带控件的输入个数（每个各占 `widgets_values` 里的一个槽 ——
 *  除非 seed 的 `control_after_generate` 哨兵额外多占一个，
 *  见 {@link hasSeedControlSlot}）。 */
function widgetInputCount(node: RawUiNode): number {
  const inputs = node?.inputs ?? [];
  let count = 0;
  for (const inp of inputs) {
    if (inp?.widget) count++;
  }
  return count;
}
/** 该 UI 节点是否在 seed 控件之后序列化了一个 `control_after_generate` 哨兵槽。
 *  ComfyUI 只在这个 seed 是**真正的** INT 控件、且所在节点带随机化能力
 *  （KSampler 等）时才发那一个槽。
 *  仅仅「暴露」内部 seed 的子图 wrapper 节点，自己的 `widgets_values` 里并不保留
 *  这个控制槽 —— 那里 seed 之后的槽属于下一个被暴露的控件（比如模型 COMBO），
 *  写 `seedSlot + 1` 会把它覆盖掉。被暴露 seed 的随机化被隔离时
 *  （ComfyUI 的 `proxyWidgetErrorQuarantine`），更不能写。 */
function hasSeedControlSlot(node: RawUiNode): boolean {
  if (!Array.isArray(node?.widgets_values)) return false;
  /* 只有当 `widgets_values` 比带控件的输入多出一项时，哨兵槽才存在
   *（更早的 ComfyUI 不序列化哨兵，长度相等说明 seed+1 也是真控件）。 */
  return node.widgets_values.length > widgetInputCount(node);
}
/** ComfyUI 在子图定义里给合成边界节点用的哨兵 id：`-10` 是输入轨，`-20` 是
 *  输出轨。连线的 origin 是 `-10` 表示「这个内部输入由暴露出来的子图引脚供给」
 *  —— 这正是 ComfyUI 标记「已提升为宿主所有」控件的方式。 */
const SUBGRAPH_INPUT_NODE_ID = -10;
/** 子图定义 `inputs[]` 引脚列表里一项的最小视图。 */
type SubgraphPin = {
  name?: unknown;
  linkIds?: unknown;
};
/** 子图定义内部一条连线对象的最小视图（含 id、起止节点与槽位、类型等字段：
 *  依次是 id、源节点、源槽、目标节点、目标槽、类型。 */
type SubgraphLink = {
  id?: unknown;
  origin_id?: unknown;
  target_id?: unknown;
  target_slot?: unknown;
};
/** 子图定义（`definitions.subgraphs[uid]`）的最小视图。 */
type RawSubgraph = {
  id?: unknown;
  nodes?: unknown;
  links?: unknown;
  inputs?: unknown;
};
/** 收集所有子图定义，按其 UUID（`sub.id`）作键。 */
function subgraphDefs(raw: JsonRecord): Map<string, RawSubgraph> {
  const out = new Map<string, RawSubgraph>();
  const defs = raw.definitions;
  const subs =
    defs != null && typeof defs === "object"
      ? (defs as JsonRecord).subgraphs
      : undefined;
  const list: unknown[] = Array.isArray(subs)
    ? subs
    : subs != null && typeof subs === "object"
      ? Object.values(subs)
      : [];
  for (const sg of list) {
    const parsed = SubgraphIdentitySchema.safeParse(sg);
    if (!parsed.success) continue;
    out.set(parsed.data.id, parsed.data);
  }
  return out;
}

/**
 * 把落在子图 wrapper 上的覆盖项同步到内层节点。
 *
 * 背景：ComfyUI 的子图 wrapper 只保存**宿主值**（`widgets_values` 按「第 i 个
 * 提升到控件的子图输入」位置排列），内层节点保存的是**默认/上游值**。comfy-cli
 * 做 UI→API 转换时会把子图展开成 `wrapperId:innerId`，而展开过程中内层节点的
 * `widgets_values` 才是节点入参的来源；wrapper 的宿主值只在转换器的
 * promoted-widget 回写阶段（comfy-cli ≥ 1.20）被应用。只改 wrapper 不改内层，
 * 在老版本 comfy-cli 上覆盖会被内层默认值整段盖掉。
 *
 * 映射规则与 ComfyUI 前端一致（`SubgraphNode._resolveInputWidget`）：子图定义
 * 的 `inputs[i]` 取其 `linkIds` 中第一条「起点是 `-10`（输入轨）」的边界连线，
 * 该连线的 `target_id` / `target_slot` 即内层节点与其入参槽位；外层 wrapper 的
 * `inputs[]` 与定义 `inputs[]` 按**名字**对齐（顺序可能不同）。
 */
/** 一个子图 wrapper 的「提升输入 → 内层节点」解析结果。 */
interface SubgraphTargets {
  /** 子图定义本体（用于继续下钻嵌套实例）。 */
  sub: RawSubgraph;
  /** 定义内部节点（按 id）。 */
  innerById: Map<string, RawUiNode>;
  /** 提升引脚名 → 内层节点 id 与其**入参下标**（首条 origin=-10 的边界连线）。 */
  targetByName: Map<string, { nodeId: string; slot: number }>;
  /** 定义里声明的输入引脚（**按声明顺序**）。 */
  defInputs: SubgraphPin[];
}

/**
 * 解析一个子图 wrapper 的提升输入映射（宿主值 → 内层节点的落点）。
 *
 * 规则与 ComfyUI 前端一致（`SubgraphNode._resolveInputWidget`）：定义的
 * `inputs[i]` 取其 `linkIds` 中第一条「起点是 `-10`（输入轨）」的边界连线，
 * 该连线的 `target_id` / `target_slot` 即内层节点与其入参槽位。
 */
function collectSubgraphTargets(
  raw: JsonRecord,
  wrapper: RawUiNode,
): SubgraphTargets | null {
  const classType = typeof wrapper.type === "string" ? wrapper.type : undefined;
  if (!classType) return null;
  const sub = subgraphDefs(raw).get(classType);
  if (!sub) return null;

  const innerById = new Map<string, RawUiNode>();
  for (const n of Array.isArray(sub.nodes) ? sub.nodes : []) {
    const parsed = UiNodeIdentitySchema.safeParse(n);
    if (!parsed.success) continue;
    innerById.set(String(parsed.data.id), parsed.data);
  }

  const linksById = new Map<string, SubgraphLink>();
  for (const l of Array.isArray(sub.links) ? sub.links : []) {
    if (l == null || typeof l !== "object") continue;
    const link = l as SubgraphLink;
    if (typeof link.id !== "string" && typeof link.id !== "number") continue;
    linksById.set(String(link.id), link);
  }

  const defInputs: SubgraphPin[] = [];
  for (const i of Array.isArray(sub.inputs) ? sub.inputs : []) {
    if (i == null || typeof i !== "object") continue;
    defInputs.push(i as SubgraphPin);
  }

  const targetByName = new Map<string, { nodeId: string; slot: number }>();
  for (const pin of defInputs) {
    if (typeof pin.name !== "string") continue;
    for (const lid of Array.isArray(pin.linkIds) ? pin.linkIds : []) {
      if (typeof lid !== "string" && typeof lid !== "number") continue;
      const link = linksById.get(String(lid));
      if (!link) continue;
      if (Number(link.origin_id) !== SUBGRAPH_INPUT_NODE_ID) continue;
      if (
        typeof link.target_id !== "string" &&
        typeof link.target_id !== "number"
      )
        continue;
      const tid = String(link.target_id);
      const slot = Number(link.target_slot);
      if (!innerById.has(tid) || !Number.isFinite(slot)) continue;
      targetByName.set(pin.name, { nodeId: tid, slot: Math.trunc(slot) });
      break;
    }
  }

  return { sub, innerById, targetByName, defInputs };
}

/** 宿主 inputs[] 里「控件型提升输入名 → widgets_values 下标」（**我们的判据**）。
 *
 *  与 ComfyUI 序列化同口径：数组长度正好等于这类输入的个数（实测 35/35）。 */
function hostWidgetIndexes(wrapper: RawUiNode): Map<string, number> {
  const out = new Map<string, number>();
  let i = 0;
  for (const inp of wrapper.inputs ?? []) {
    if (!inp?.widget) continue;
    if (typeof inp.name === "string") out.set(inp.name, i);
    i += 1;
  }
  return out;
}

function applySubgraphInteriorOverrides(
  raw: JsonRecord,
  wrapper: RawUiNode,
  entries: { name: string; value: unknown }[],
): void {
  const t = collectSubgraphTargets(raw, wrapper);
  if (!t) return;
  const defNames = new Set<string>();
  for (const pin of t.defInputs) {
    if (typeof pin.name === "string") defNames.add(pin.name);
  }

  for (const { name, value } of entries) {
    if (!defNames.has(name)) continue;
    const target = t.targetByName.get(name);
    if (!target) continue;
    const inner = t.innerById.get(target.nodeId);
    if (!inner) continue;
    const slot = mapInputSlotToWidgetSlot(inner, target.slot);
    if (slot < 0) continue;
    if (!Array.isArray(inner.widgets_values)) continue;
    inner.widgets_values[slot] = value;
  }
}

/**
 * 抵消 comfy-cli 提升控件回写的**槽位漂移**（只在该漂移确实存在时动手）。
 *
 * 现场与判据：comfy-cli 的 `promoted_inputs` 只按「边界连线的**内层目标**带不带
 * widget 标记」判定「这个提升输入占不占宿主 widgets_values 的槽」，而 ComfyUI 前端
 * 用的是**宿主自己** `inputs[].widget`。两者在某些引脚上不一致 —— 例如被转成输入
 * 插槽的引脚：宿主 `widget` 是 `null`（不占槽），但内层目标仍是控件，comfy-cli 就
 * 多算一个。于是它按 `widgets_values[i + 漂移]` 读值：给 `clip_name` 读到 `5`、
 * 给 `shift` 读到 `true`、给 `steps_total` 读到 `'euler'`，再把这些垃圾以「宿主优先」
 * **覆盖**掉内层节点上的正确值 —— 表现就是一批 `shape_mismatch`（本次 17 处）。
 *
 * 该缺陷在 **1.20.0 与 GitHub 主干 `5cd4b77` 上同样存在**（已用 comfy-cli 自带的
 * `promoted` 模块在这份载荷上实测：两侧下标不一致的引脚 35 个，漂移 +3）。
 *
 * 修法不是去迎合它那个下标（那会把载荷绑死在有缺陷的规则上，它一修好我们反而错），
 * 而是**让载荷的正确性只依赖内层值**（那正是 ComfyUI 的真实语义：宿主值只是被提升
 * 出去的镜像）：
 *   1. 把宿主上**所有**控件型提升输入的值，按我们（与序列化一致）的下标折进内层；
 *   2. 清空该实例的 `widgets_values` —— comfy-cli 的 `host_value` 因
 *      `value_index < len(values)` 不成立而一律返回 UNSET，回写整段跳过。
 *
 * 只改深拷贝出来的载荷，库里的工作流不受影响。
 */
function neutralizePromotedHostDrift(raw: JsonRecord): void {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return;
  /** comfy-cli 的判据（复刻自 `comfy_cli.cql.promoted.promoted_inputs`）。 */
  const cliWidgetIndexes = (t: SubgraphTargets): Map<string, number> => {
    const out = new Map<string, number>();
    let idx = 0;
    for (const pin of t.defInputs) {
      if (typeof pin.name !== "string") continue;
      const target = t.targetByName.get(pin.name);
      if (!target) continue;
      const inner = t.innerById.get(target.nodeId);
      if (!inner?.inputs?.[target.slot]?.widget) continue;
      out.set(pin.name, idx);
      idx += 1;
    }
    return out;
  };

  const visit = (nodes: unknown, depth: number): void => {
    /* 嵌套层数只是防止定义里的环把遍历拖死；真实工作流远到不了这个深度。 */
    if (depth > 8 || !Array.isArray(nodes)) return;
    for (const n of nodes) {
      const parsed = UiNodeIdentitySchema.safeParse(n);
      if (!parsed.success) continue;
      const node = parsed.data;
      const t = collectSubgraphTargets(raw, node);
      if (!t) continue;
      /* 先下钻：与 comfy-cli 一致（内层实例先处理，外层后处理）。 */
      visit(t.sub.nodes, depth + 1);

      const cli = cliWidgetIndexes(t);
      const ours = hostWidgetIndexes(node);
      let drift = cli.size !== ours.size;
      if (!drift) {
        for (const [name, idx] of ours) {
          if (cli.get(name) !== idx) {
            drift = true;
            break;
          }
        }
      }
      if (!drift) continue;

      /* zod 解析出的副本上 `widgets_values` 是 `any[]`：这里显式收成 `unknown[]`，
       * 逐项取出的值才不会把 `any` 带进「写回内层」的那一步。 */
      const host = (
        Array.isArray(node.widgets_values) ? node.widgets_values : []
      ) as unknown[];
      for (const [name, idx] of ours) {
        const value = host[idx];
        if (value === undefined) continue;
        const target = t.targetByName.get(name);
        if (!target) continue;
        const inner = t.innerById.get(target.nodeId);
        if (!inner) continue;
        const slot = mapInputSlotToWidgetSlot(inner, target.slot);
        if (slot < 0) continue;
        if (!Array.isArray(inner.widgets_values)) continue;
        inner.widgets_values[slot] = value;
      }
      /* **就地**清空，不能重新赋值：`UiNodeIdentitySchema.safeParse` 给出的
       * `node` 是解析出的副本，给它换一个数组不会反映到载荷上；清空**同一份**
       * 数组才会（本模块其它写入同理，都只改数组元素）。 */
      if (Array.isArray(node.widgets_values)) node.widgets_values.length = 0;
    }
  };

  visit(raw.nodes, 0);
}

/**
 * 把内层节点的**输入槽位下标**换算成 `widgets_values` 下标。
 * 只有带 `widget` 标记的入参才占 `widgets_values` 的格子，且 seed / noise_seed
 * 会多占一格（`control_after_generate` 哨兵），与
 * {@link seedWidgetSlot} / {@link widgetSlot} 的计数规则一致。
 */
function mapInputSlotToWidgetSlot(node: RawUiNode, inputIndex: number): number {
  const inputs = node?.inputs ?? [];
  let slot = 0;
  for (let i = 0; i < inputs.length; i++) {
    const inp = inputs[i];
    if (!inp?.widget) continue;
    // 目标槽位的值格就是当前游标；seed 的 control 哨兵只把它**之后**的
    // 控件整体推后一格，所以哨兵的额外 +1 必须在返回游标之后才累加。
    if (i === inputIndex) return slot;
    slot++;
    const wname =
      typeof inp.widget === "string"
        ? inp.widget
        : inp.widget != null && typeof inp.widget === "object"
          ? ((inp.widget as JsonRecord).name ?? inp.name)
          : inp.name;
    if (typeof wname === "string" && /seed|noise_seed/i.test(wname)) slot++;
  }
  return -1;
}

/** 数值入参不要被字符串覆盖：已有值是数字、新值是可解析的数字串 → 取数字。
 *
 *  ComfyUI 对数值型入参收到字符串会拒单（或按 0 处理），而动态表单的值一路都是
 *  字符串。raw / API 两侧的覆盖注入必须同口径，因此抽到这里只定义一次。 */
export function coerceApiInputValue(current: unknown, value: unknown): unknown {
  if (typeof current === "number" && typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed !== "" && !Number.isNaN(Number(trimmed)))
      return Number(trimmed);
  }
  return value;
}

/** API 格式图里 seed 类入参的名字（与 raw 侧的 SEED_WIDGET_NAMES 同口径）。 */
const SEED_INPUT_NAMES = ["seed", "noise_seed"];
/** 前端专有的随机化控件名（不是 ComfyUI 的入参）。 */
const CONTROL_AFTER_GENERATE = "control_after_generate";
/** 尽力把画布的 `workflowInputs` 注入到 **API 格式** 的图里。
 *
 *  与 {@link applyRawOverrides} 同一套语义（`(nodeId, name, value)` 覆盖项、
 *  数值收窄、`control_after_generate=randomize` 兜底铸新种子），差别只在落点：
 *  API 图的 `inputs` 是命名 map，按名字直接写即可，没有下标可错位。
 *
 *  `control_after_generate` **不入载荷**：它是 ComfyUI 前端的控件概念，后端
 *  `/prompt` 不认（前端在序列化 prompt 时把它解析成具体 seed）。所以这里先把它
 *  从入参里摘掉，再按模式处理 seed —— `randomize` 铸一个新种子写给 seed 入参
 *  （与 raw 路径在「没有哨兵槽」时的做法一致），其余模式保持 seed 原值。
 *
 *  图本身不变（不修改入参对象），返回一份深拷贝。 */
export function applyApiOverrides(
  graph: unknown,
  overrides?: RawWorkflowOverride[],
): JsonRecord {
  if (graph == null || typeof graph !== "object" || Array.isArray(graph))
    return {};
  const out = JSON.parse(JSON.stringify(graph)) as JsonRecord;
  if (!overrides?.length) return out;

  for (const ov of overrides) {
    if (!ov?.nodeId || ov.value === undefined) continue;
    const nodeRaw = out[ov.nodeId];
    if (
      nodeRaw == null ||
      typeof nodeRaw !== "object" ||
      Array.isArray(nodeRaw)
    )
      continue;
    const inputsRaw = (nodeRaw as JsonRecord).inputs;
    if (
      inputsRaw == null ||
      typeof inputsRaw !== "object" ||
      Array.isArray(inputsRaw)
    )
      continue;
    const inputs = inputsRaw as JsonRecord;

    if (ov.name === CONTROL_AFTER_GENERATE) {
      delete inputs[CONTROL_AFTER_GENERATE];
      if (ov.value !== "randomize") continue;
      const seedKey = SEED_INPUT_NAMES.find((name) => name in inputs);
      if (seedKey) inputs[seedKey] = randomSeed();
      continue;
    }

    inputs[ov.name] = coerceApiInputValue(inputs[ov.name], ov.value);
  }
  return out;
}
/** 尽力把画布的 `workflowInputs` 注入到原始 UI JSON 里。 */
export function applyRawOverrides(
  rawJson: unknown,
  overrides?: RawWorkflowOverride[],
): JsonRecord {
  const raw = JSON.parse(JSON.stringify(rawJson)) as JsonRecord;
  /* **没有**覆盖项也要走漂移抵消：comfy-cli 的提升控件回写错位与「这次有没有
   * 画布覆盖」无关 —— 它错的是宿主自己的值（本次现场 17 处全在我们一次都没碰过
   * 的引脚上）。因此这一步先于「有没有覆盖」的判断。 */
  if (!overrides?.length) {
    neutralizePromotedHostDrift(raw);
    return raw;
  }
  /* 已落到节点上的覆盖项，循环结束后统一同步子图内层（见文件末尾）。 */
  const pendingByNode = new Map<string, { name: string; value: unknown }[]>();
  for (const ov of overrides) {
    if (!ov?.nodeId || ov.value === undefined) continue;
    const node = resolveRawNode(raw, ov.nodeId);
    if (!node) continue;
    /* 原始 UI 格式里 seed 的 "control after generate" **不是**具名控件 ——
     * 它被序列化成 seed 控件紧挨着的下一个 widgets_values 槽。
     * 所以这里解析出 seed 控件槽，目标就是槽 +1。
     *（API 格式的图则带一个真正的 `control_after_generate` 输入，由按名分支处理。） */
    if (ov.name === "control_after_generate") {
      const seedSlot = seedWidgetSlot(node);
      if (seedSlot < 0) continue;
      if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
      /* 只有当该节点确实在 seed 之后保留了 `control_after_generate` 哨兵槽时，
       * 才写 seed 的控制模式。只暴露内部 seed、却不暴露其随机化能力的子图 wrapper
       *（子图没有对应输入引脚时 ComfyUI 会把它隔离）没有这个槽 ——
       * 否则 `seedSlot + 1` 会覆盖后面那个真控件（例如扩散模型名）。 */
      if (hasSeedControlSlot(node)) {
        node.widgets_values[seedSlot + 1] = ov.value;
      } else if (ov.value === "randomize") {
        /* 没有哨兵槽（被暴露的子图 seed 没有随机化引脚，或该节点的随机化已被隔离）
         * 意味着 ComfyUI 会把 seed 固定住 —— 用户请求的随机化模式会落空。
         * 这里兜底造一个新的随机 seed，让被暴露的 seed 每次运行仍有变化。 */
        const minted = randomSeed();
        node.widgets_values[seedSlot] = minted;
        // 同步写进内层节点：comfy-cli 展开子图后真正被采样器读到的是内层
        // widgets_values，只改 wrapper 的话这次随机种子同样会被内层默认值盖掉。
        pendingByNode.set(ov.nodeId, [
          ...(pendingByNode.get(ov.nodeId) ?? []),
          { name: seedWidgetName(node) ?? "seed", value: minted },
        ]);
      }
      continue;
    }

    const slot = widgetSlot(node, ov.name);
    if (slot < 0) continue;
    if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
    node.widgets_values[slot] = ov.value;
    pendingByNode.set(ov.nodeId, [
      ...(pendingByNode.get(ov.nodeId) ?? []),
      { name: ov.name, value: ov.value },
    ]);
  }

  /* 子图 wrapper：把覆盖同步到内层节点。wrapper 存的是宿主值，而 comfy-cli
   * 展开子图后读的是内层节点的 widgets_values —— 只改 wrapper，在
   * 「转换器不回写宿主值」的 comfy-cli 版本上覆盖会被内层默认值整段盖掉
   * （提示词/种子等入参全部失效，每次都跑工作流里存的那张图）。 */
  for (const [nodeId, entries] of pendingByNode) {
    const node = resolveRawNode(raw, nodeId);
    if (!node) continue;
    applySubgraphInteriorOverrides(raw, node, entries);
  }
  /* 最后一步：抵消 comfy-cli 提升控件回写的槽位漂移（见该函数注释）。必须在覆盖
   * 与内层同步**之后** —— 那时宿主上的值（含本次覆盖）已全部折进内层，清空宿主
   * 数组不会丢东西。 */
  neutralizePromotedHostDrift(raw);
  return raw;
}
