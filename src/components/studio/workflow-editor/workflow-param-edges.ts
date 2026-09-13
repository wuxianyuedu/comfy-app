// 对外参数节点 → 宿主节点端口 的连线（纯函数，无 React、无 IO）。
//
// 这些都是**映射的呈现**，不是工作流图本身的连线：source 是 `pio:<条目id>`
// 卡片，target 是宿主节点上被映射到的那个端口（targetHandle = ioKey），
// 所以作者在画布上「看一眼就知道提示词喂给了哪一行」。
//
// 状态着色：
//   · 自动判定出来的落点 → 虚线灰蓝；
//   · 作者连过 / 改过的落点 → 实线紫；
//   · 作者显式断开（`resolved[entryId] === null`）→ 不画线。

import type { Edge } from "@xyflow/react";

import {
  entryIdFromParamNodeId,
  paramNodeId,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";

/** 自动判定落点的描边色。 */
const AUTO_STROKE = "#64748b";
/** 作者连过的线的描边色（与画布 primary 同系）。 */
const MANUAL_STROKE = "#a78bfa";

export interface BuildParamEdgesCtx {
  entries: readonly ParamEntry[];
  /** 当前模式下生效的「条目 id → 目标 ioKey」。 */
  resolved: Record<string, string | null>;
  /** 某个条目在当前模式下是否作者连过线。 */
  isManual: (entryId: string) => boolean;
  /** 已经渲染出来的卡片 id（`pio:<条目 id>`）集合。
   *
   *  连线的 source 必须是真实存在的卡片，否则 React Flow 会画出一条
   *  「指向不存在节点」的悬空线 —— 视觉上就是工作流图上多出一个没来历的
   *  线头/节点。当前视图里找得到宿主节点、卡片才渲染得出来（子图内部节点的
   *  nodeId 在顶层画布上不存在，`buildParamNodes` 会跳过它）；本闸门与卡片
   *  渲染同口径，缺省时不做限制（纯函数老调用方行为不变）。 */
  renderedCardIds?: ReadonlySet<string>;
}

export function buildParamEdges(ctx: BuildParamEdgesCtx): Edge[] {
  const { entries, resolved, isManual, renderedCardIds } = ctx;
  const out: Edge[] = [];
  for (const entry of entries) {
    const target = resolved[entry.id];
    /* 未连线 / 显式断开 → 不画线（卡片悬空既说明「没连上」，也不误导）。 */
    if (!target) continue;
    /* 卡片不存在（宿主节点不在当前视图里）→ 同样不画线。 */
    if (renderedCardIds && !renderedCardIds.has(paramNodeId(entry.id)))
      continue;
    const manual = isManual(entry.id);
    /* 宿主端用 `hostNodeId`：契约路径下 `nodeId` 是空串，边会指向一个不存在的
     *  节点 —— React Flow 找不到 target 就整条丢掉（用户看到「默认连线没连到
     *  端点上」，见 ParamEntry.hostNodeId）。 */
    const hostNodeId = entry.hostNodeId || entry.nodeId;
    if (!hostNodeId) continue;
    out.push({
      id: `pe-${entry.id}`,
      source: paramNodeId(entry.id),
      /* 源端点 = **当前落点那一颗**（与卡片上每候选一颗圆点同口径）：写死
       *  `pio-out` 会接到一个不存在的 handle 上，React Flow 丢弃整条边。 */
      sourceHandle: target,
      target: hostNodeId,
      targetHandle: target,
      type: "default",
      /* 可选中 / 可删除 —— 删掉一条线就是「该对外参数在这个模式下断开」，
       * 这是最自然的编辑手势。 */
      selectable: true,
      deletable: true,
      animated: false,
      style: {
        stroke: manual ? MANUAL_STROKE : AUTO_STROKE,
        strokeWidth: manual ? 2.5 : 2,
        strokeDasharray: manual ? undefined : "6 4",
        opacity: manual ? 1 : 0.75,
      },
      data: { paramEntryId: entry.id, manual, paramMap: true },
    });
  }
  return out;
}


/* ── 连线两端的方向与归属判定（纯函数）──
 *
 * React Flow 在**连线过程中**用 `isValidConnection` 预判「悬停处能不能落线」，
 * 判非法就在指针旁给出禁用标记。所以这个闸门必须把两端的方向判死，否则：
 *
 *   · 从卡片端点（source）拖到宿主节点里任意一行 —— 那些句柄是躺在节点里的
 *     **输入**端点，id 与落点同名，命中「目标必须落在宿主节点端口上」却过不了
 *     方向；反过来从宿主行拖向卡片也同样被判非法。用户看到的就是「点击端点拉线
 *     出现禁用标记」（ISSUE #355）。
 *
 * 这里只做「这条连接表达不表达一条映射」的判断，不碰模式（模式决定这条线归属哪个
 * 命名空间，不决定拖线本身是否成立）。
 */

/** 一条连接是否是一条合法的映射线（卡片端点 ↔ 该对外参数的宿主节点端口）。
 *
 *  两个方向都接：卡片端点是 source（输出）、宿主行是 target（输入）是常态；
 *  反向拖（宿主行 → 卡片端点）时两个键互换，React Flow 在非 Strict 连线模式下
 *  不保证方向，所以这里显式归一化，免得「怎么拖都连不上」。 */
export function isValidParamConnection(
  connection: {
    source?: string | null;
    target?: string | null;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  },
  entries: readonly ParamEntry[],
  io: WorkflowIOMap | null | undefined,
): boolean {
  const forward = entryIdFromParamNodeId(connection.source ?? "");
  const backward = entryIdFromParamNodeId(connection.target ?? "");
  const entryId = forward ?? backward;
  /* 两端都不是卡片（图上普通连线）→ 不是映射线。这里只做映射线的合法性判断，
   *  图上原有连线的合法性由画布自己管。 */
  if (!entryId) return false;
  /* 两端都是卡片 → 一张接线面板连到另一张，不表达任何落点。 */
  if (forward && backward) return false;
  const targetNodeId = forward ? connection.target : connection.source;
  const targetHandle = forward ? connection.targetHandle : connection.sourceHandle;
  if (!targetNodeId || !targetHandle) return false;
  const entry = entries.find((item) => item.id === entryId);
  /* 宿主端按 `hostNodeId` 判（契约路径下 `nodeId` 是空串，拿它比会让闸门对每
   *  一次拖拽都返回 false —— 用户表现为「怎么拖都连不上」）。 */
  if (!entry) return false;
  const hostNodeId = entry.hostNodeId || entry.nodeId;
  if (hostNodeId !== targetNodeId) return false;
  /* 落点是宿主行（或组合控件）的 handle id —— 它必须在 workflowIO 里真实存在，
   *  否则边画得出来、运行期却落不到值（静默失效）。 */
  return !!io?.[targetHandle];
}
