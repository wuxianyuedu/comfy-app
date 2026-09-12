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

import { paramNodeId, type ParamEntry } from "~/lib/workflow-param-mapping";

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
    out.push({
      id: `pe-${entry.id}`,
      source: paramNodeId(entry.id),
      sourceHandle: "pio-out",
      target: entry.nodeId,
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
      data: { paramEntryId: entry.id, manual },
    });
  }
  return out;
}
