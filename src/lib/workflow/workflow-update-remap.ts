// ── 工作流更新时的 IO 连线保持 / 断线报告（#4377，纯模块）────────────────
//
// 工作流更新（在线工作流贴新 JSON、本地工作流磁盘同步）会把 rawJson 换成新
// 版本。作者编辑过的 IO 连线（paramMap 的落点线、输出取值行、装载绑定的
// 追加端口）与 workflowIO 的逐口编辑都按 **ioKey** 记账 —— 本模块回答两件事：
//
//   · **尽量保持**：新图里还存在的端口，连线 / 编辑原样保留；
//   · **断线报告**：新图里已经不存在的端口，连线摘掉并逐条上报，
//     让用户知道哪里断了、要去「编辑对外参数」重新配置。
//
// 判据是**结构性**的（不查 object_info）：端口 `nodeId::kind::name` 在新图里
// 存在 = 新图有同 id 的顶层节点，且该节点带同名同类的入口 / 出口。只有旧图
// 顶层有的节点才参与判定 —— 子图内部 / 边界口的 ioKey 一律**原样保留**（结构
// 上判不了就别误报，宁可不报也不假报）。
//
// 无 React、无 IO（规范 §17.2 第①层），可直接单测。

import { isRecord } from "~/lib/is-record";

/** 一条断掉的连线（更新后端口在新图里已不存在）。 */
export type BrokenWire = {
  /** 契约槽位 id / 输出行 id。 */
  entryId: string;
  /** 断掉的落点 ioKey。 */
  ioKey: string;
  /** 断线所在的命名空间键：`mode:<模式>` 或 `output`。 */
  namespace: string;
};

export type UpdateRemapResult = {
  /** 断线清单（paramMap 落点线 + 输出取值行 + 装载绑定追加端口）。 */
  broken: Array<BrokenWire>;
  /** workflowIO 里被摘掉的端口编辑（ioKey）。 */
  droppedIOKeys: Array<string>;
  /** 清洗后的 paramMap（保留存活连线，摘除断线；其余键空间原样透传）。 */
  paramMap: unknown;
  /** 清洗后的 workflowIO（只保留新图里仍存在的端口编辑）。 */
  workflowIO: unknown;
};

/** 节点 id 的归一（RAW 里是数字，容错处理其它形状；归不出给空串 = 跳过）。 */
function nodeIdOf(node: Record<string, unknown>): string {
  const id = node.id;
  if (typeof id === "string") {
    return id;
  }
  return typeof id === "number" ? String(id) : "";
}

/** 从 RAW 图里收集「结构上存在」的端口 ioKey 集合（顶层节点）。 */
export function collectRawPorts(rawJson: unknown): Set<string> {
  const ports = new Set<string>();
  if (!isRecord(rawJson)) {
    return ports;
  }
  const nodes = Array.isArray(rawJson.nodes) ? rawJson.nodes : [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const nodeId = nodeIdOf(node);
    if (nodeId === "") {
      continue;
    }
    for (const input of Array.isArray(node.inputs) ? node.inputs : []) {
      if (!isRecord(input) || typeof input.name !== "string" || input.name === "") {
        continue;
      }
      ports.add(`${nodeId}::${"widget" in input ? "widget" : "param"}::${input.name}`);
    }
    for (const output of Array.isArray(node.outputs) ? node.outputs : []) {
      if (!isRecord(output) || typeof output.name !== "string" || output.name === "") {
        continue;
      }
      ports.add(`${nodeId}::output::${output.name}`);
    }
  }
  return ports;
}

/** 旧图顶层节点 id 集合（子图内部 / 边界口的 ioKey 不参与判定）。 */
function collectTopLevelNodeIds(rawJson: unknown): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(rawJson)) {
    return ids;
  }
  const nodes = Array.isArray(rawJson.nodes) ? rawJson.nodes : [];
  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }
    const nodeId = nodeIdOf(node);
    if (nodeId !== "") {
      ids.add(nodeId);
    }
  }
  return ids;
}

/** 一个 ioKey 是否存活：旧图顶层没有这个节点的（子图内部口等）一律算存活
 *  （判不了就不误报）；旧图顶层有的，按新图端口是否存在判。 */
function ioKeySurvives(ioKey: string, oldNodeIds: Set<string>, newPorts: Set<string>): boolean {
  const nodeId = ioKey.split("::")[0] ?? "";
  if (!oldNodeIds.has(nodeId)) {
    return true;
  }
  return newPorts.has(ioKey);
}

/** 单条「槽位 → ioKey」的清洗：返回 null = 保留原值；string = 断线的 ioKey。 */
function remapTarget(
  ioKey: string | null,
  oldNodeIds: Set<string>,
  newPorts: Set<string>,
): string | null {
  if (ioKey === null || ioKey === undefined || ioKey === "") {
    return null;
  }
  return ioKeySurvives(ioKey, oldNodeIds, newPorts) ? null : ioKey;
}

/** 对一张「模式键 → { 槽位 → ioKey | null }」命名空间做连线保持 / 断线摘除。 */
function remapModeNamespace(
  namespace: unknown,
  oldNodeIds: Set<string>,
  newPorts: Set<string>,
  broken: Array<BrokenWire>,
): unknown {
  if (!isRecord(namespace)) {
    return namespace;
  }
  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [modeKey, table] of Object.entries(namespace)) {
    if (!isRecord(table)) {
      /* 畸形表原样保留（与读边界同口径：不认识的形状不清洗）。 */
      next[modeKey] = table;
      continue;
    }
    const nextTable: Record<string, string | null> = {};
    for (const [entryId, raw] of Object.entries(table)) {
      /* 表值按权威形状是 ioKey | null；历史上的垃圾值归到 null（= 显式断开）。 */
      const ioKey = typeof raw === "string" ? raw : null;
      const brokenKey = remapTarget(ioKey, oldNodeIds, newPorts);
      if (brokenKey === null) {
        nextTable[entryId] = ioKey;
      } else {
        changed = true;
        broken.push({ namespace: modeKey, entryId, ioKey: brokenKey });
      }
    }
    next[modeKey] = nextTable;
  }
  return changed ? next : namespace;
}

/** 装载绑定的追加端口同样按存活过滤；绑定清空时连槽位一起摘掉。 */
function remapReferenceLoaders(
  namespace: unknown,
  oldNodeIds: Set<string>,
  newPorts: Set<string>,
  broken: Array<BrokenWire>,
): unknown {
  if (!isRecord(namespace)) {
    return namespace;
  }
  const next: Record<string, unknown> = {};
  for (const [modeKey, table] of Object.entries(namespace)) {
    if (!isRecord(table)) {
      next[modeKey] = table;
      continue;
    }
    const nextTable: Record<string, unknown> = {};
    for (const [slotId, binding] of Object.entries(table)) {
      if (!isRecord(binding)) {
        continue;
      }
      const extraTargets = Array.isArray(binding.extraTargets) ? binding.extraTargets : [];
      const kept: Array<string> = [];
      for (const ioKey of extraTargets) {
        if (typeof ioKey !== "string" || ioKey === "") {
          continue;
        }
        if (ioKeySurvives(ioKey, oldNodeIds, newPorts)) {
          kept.push(ioKey);
        } else {
          broken.push({ namespace: modeKey, entryId: slotId, ioKey });
        }
      }
      const presetId = typeof binding.presetId === "string" ? binding.presetId : undefined;
      if (presetId !== undefined || kept.length > 0) {
        nextTable[slotId] =
          presetId === undefined ? { extraTargets: kept } : { presetId, extraTargets: kept };
      }
    }
    next[modeKey] = nextTable;
  }
  return next;
}

/** 更新工作流内容后，对 paramMap / workflowIO 做连线保持与断线摘除。 */
export function remapForUpdate(args: {
  newRawJson: unknown;
  oldRawJson: unknown;
  paramMap: unknown;
  workflowIO: unknown;
}): UpdateRemapResult {
  const oldNodeIds = collectTopLevelNodeIds(args.oldRawJson);
  const newPorts = collectRawPorts(args.newRawJson);
  const broken: Array<BrokenWire> = [];
  const droppedIOKeys: Array<string> = [];

  /* paramMap 的三个键空间分别清洗（source / output 是「槽位 → ioKey」表，
   * referenceLoaders 是「槽位 → 绑定」表）；其余历史键原样透传。 */
  const base = isRecord(args.paramMap) ? { ...args.paramMap } : {};
  base.source = remapModeNamespace(base.source, oldNodeIds, newPorts, broken);
  base.output = remapModeNamespace(base.output, oldNodeIds, newPorts, broken);
  base.referenceLoaders = remapReferenceLoaders(
    base.referenceLoaders,
    oldNodeIds,
    newPorts,
    broken,
  );

  /* workflowIO：逐口编辑按 ioKey 存活保留，新图里消失的摘掉并计数。 */
  let workflowIO = args.workflowIO;
  if (isRecord(args.workflowIO)) {
    const nextIO: Record<string, unknown> = {};
    for (const [ioKey, entry] of Object.entries(args.workflowIO)) {
      if (ioKeySurvives(ioKey, oldNodeIds, newPorts)) {
        nextIO[ioKey] = entry;
      } else {
        droppedIOKeys.push(ioKey);
      }
    }
    workflowIO = nextIO;
  }

  return { paramMap: base, workflowIO, broken, droppedIOKeys };
}
