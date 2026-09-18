/**
 * `execution-graph.ts` — API 图的**执行前规范化**（纯函数）
 * ===========================================================================
 *
 * 与 `raw.ts` 的分工（两者不再互相缠绕）：
 *   - `raw.ts`           只管「两种格式怎么识别 / 坐标怎么取 / 画布怎么配控件名」；
 *   - 本模块             只管「一份 API 图在提交出去之前要怎么收拾」。
 *
 * 为什么这一层必须存在（ComfyUI 的真实提交语义）：
 *   - `mode = 2`（静音）/ `mode = 4`（旁路）的节点**不会出现在 prompt 里**；
 *   - 旁路节点的连线要「穿透」——按类型在它自己的入参里找同类型的上游；
 *   - Reroute / PrimitiveNode / Note 这类纯前端节点同样不入 prompt，
 *     Reroute 透传连线，PrimitiveNode 把字面量灌给下游。
 *
 * 存库与画布导出的图**保留全部节点**（画布要画出来），因此收拾只能放在提交前。
 * **不能省掉这一步**：API 格式的载荷是原样交给 comfy-cli 的（它对 API 格式直接
 * 提交，不做 UI→API 那套前端语义），少了它，画布上被旁路/静音的节点会被真的
 * 执行。
 *
 * @module comfyui/execution-graph — API 图的**执行前规范化**（纯函数）
 */

import { asRecord } from "./raw";
import type { ApiWorkflowNode } from "./raw";

/* ── LiteGraph 节点模式 ── */
export const NODE_MODE_ALWAYS = 0;
export const NODE_MODE_NEVER = 2; // 静音 mute：不执行、不穿透
export const NODE_MODE_BYPASS = 4; // 旁路 bypass：不执行、连线按类型穿透

/**
 * 纯前端节点（isVirtualNode）：它们从不进入 prompt，只负责搬运连线或数值。
 * ComfyUI 前端在 graphToPrompt 阶段就把它们解析掉了。
 */
const VIRTUAL_NODE_TYPES = new Set([
  "Reroute",
  "RerouteNode",
  "Reroute (rgthree)",
  "PrimitiveNode",
  "Note",
  "MarkdownNote",
]);

export function isVirtualNodeType(type: string): boolean {
  return VIRTUAL_NODE_TYPES.has(type);
}

export interface ExecutionPrep {
  graph: Record<string, ApiWorkflowNode>;
  /** 被剔除的节点 id（bypass / 静音 / 纯前端节点） */
  removed: string[];
  /** 因上游被静音而彻底断链、只能丢弃的入参数量 */
  droppedInputs: number;
}

/** 判断一个 input 值是否为连线引用 `[nodeId, slot]`（且目标节点真实存在）。 */
function isLinkRef(
  v: unknown,
  graph: Record<string, unknown>,
): v is [string | number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[1] === "number" &&
    (typeof v[0] === "string" || typeof v[0] === "number") &&
    !!graph[String(v[0])]
  );
}

type ResolvedOrigin =
  { kind: "link"; value: [string, number] } | { kind: "value"; value: unknown };

/** 剔除旁路 / 静音 / 纯前端节点，并把断掉的连线穿透到上游。 */
export function prepareGraphForExecution(
  input: Record<string, unknown>,
): ExecutionPrep {
  /* 存库 graph 来自 JSON：先把每个节点一次性收窄成稳定视图（值仍逐字透传），
   * 后续 walk / 剔除逻辑都读写视图，不再到处 unknown。 */
  interface PrepEntry {
    /** 运行时恒为 string；保持原值逐字透传（断言仅在编译期） */
    classType: string;
    inputs: Record<string, unknown>;
    meta: Record<string, unknown>;
  }
  const graph: Record<string, PrepEntry> = {};

  const removed: string[] = [];
  for (const [id, n] of Object.entries(input ?? {})) {
    const rec = asRecord(n);
    if (!rec) continue;
    const meta = asRecord(rec._meta) ?? {};
    graph[id] = {
      classType: rec.class_type as string,
      inputs: asRecord(rec.inputs) ?? {},
      meta,
    };
    const mode = Number(meta.mode ?? NODE_MODE_ALWAYS);
    if (
      mode === NODE_MODE_NEVER ||
      mode === NODE_MODE_BYPASS ||
      meta.virtual === true ||
      (typeof rec.class_type === "string" && isVirtualNodeType(rec.class_type))
    ) {
      removed.push(id);
    }
  }
  const inactive = new Set(removed);

  /** 沿着被剔除的节点向上游走，直到落到一个真正会执行的节点。 */
  function walk(
    originId: string,
    originSlot: number,
    depth: number,
  ): ResolvedOrigin | null {
    if (depth > 64) return null; // 环保护
    const node = graph[originId];
    if (!node) return null;
    if (!inactive.has(originId))
      return { kind: "link", value: [originId, originSlot] };

    const meta = node.meta;
    // 静音节点不透传：下游这一路直接断掉（与 ComfyUI 行为一致）。
    if (Number(meta.mode ?? NODE_MODE_ALWAYS) === NODE_MODE_NEVER) return null;
    // PrimitiveNode：把字面量直接内联给下游。
    const literal = meta.value;
    if (literal !== undefined) return { kind: "value", value: literal };

    const orderRaw = meta.inputOrder;
    const order: string[] = Array.isArray(orderRaw)
      ? orderRaw.map((x: unknown) => String(x))
      : Object.keys(node.inputs);
    const types = asRecord(meta.inputTypes) ?? {};
    const outTypes = meta.outputTypes;
    const wanted =
      Array.isArray(outTypes) && typeof outTypes[originSlot] === "string"
        ? outTypes[originSlot]
        : undefined;

    // ComfyUI 的顺序：先试与输出槽同序号的入参，再遍历其余入参做类型匹配。
    const seen = new Set<string>();
    const candidates: string[] = [];
    const sameSlot = order[originSlot];
    if (sameSlot) {
      candidates.push(sameSlot);
      seen.add(sameSlot);
    }
    for (const nm of order) {
      if (seen.has(nm)) continue;
      candidates.push(nm);
      seen.add(nm);
    }

    for (const nm of candidates) {
      const value = node.inputs[nm];

      if (!isLinkRef(value, graph)) continue;

      const typeOfNm = types[nm];
      if (
        wanted &&
        typeof typeOfNm === "string" &&
        typeOfNm.toUpperCase() !== wanted.toUpperCase()
      )
        continue;

      return walk(String(value[0]), Number(value[1]), depth + 1);
    }

    // 类型信息缺失（老工作流没存 type）时：只有一条入线就直接穿过去。
    const linked = candidates.filter((nm) => isLinkRef(node.inputs[nm], graph));
    if (linked.length === 1) {
      const value = node.inputs[linked[0]!];
      if (isLinkRef(value, graph)) {
        return walk(String(value[0]), Number(value[1]), depth + 1);
      }
    }

    return null;
  }

  const out: Record<string, ApiWorkflowNode> = {};
  let droppedInputs = 0;

  for (const [id, n] of Object.entries(graph)) {
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n.inputs)) {
      if (!isLinkRef(v, graph)) {
        inputs[k] = v;
        continue;
      }
      const resolved = walk(String(v[0]), Number(v[1]), 0);
      if (!resolved) {
        droppedInputs += 1;
        continue;
      }
      inputs[k] = resolved.value;
    }
    const titleRaw = n.meta.title;
    const title = typeof titleRaw === "string" ? titleRaw : undefined;
    // 只保留官方认可的 `_meta.title`，本地字段一律不外发。
    out[id] = {
      class_type: n.classType,
      inputs,
      ...(title ? { _meta: { title } } : {}),
    };
  }

  return { graph: out, removed, droppedInputs };
}
