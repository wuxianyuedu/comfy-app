// 对外参数节点 → 宿主节点端口 的连线（纯函数，无 React、无 IO）。
//
// 这些都是**映射的呈现**，不是工作流图本身的连线：source 是 `pio:<条目id>`
// 卡片，target 是宿主节点上被映射到的那个端口，所以作者在画布上「看一眼就
// 知道提示词喂给了哪一行」。
//
// targetHandle 取**渲染侧的 handle id（pin 名）**，不是 workflowIO 的 ioKey
// —— 存储层的映射目标存 ioKey（运行期回查要用），两者不是同一个字符串，
// 写错会让 React Flow 找不到 handle 而丢弃整条线（error#008，见 ISSUE #374）。
//
// 状态着色：
//   · 默认连线状态（自动探测出来的落点）→ 虚线灰蓝；
//   · 作者画过 / 改过的线 → 实线紫；
//   · 作者显式断开（`resolved[entryId] === null`）→ 不画线。

import type { Edge } from "@xyflow/react";

import {
  handleIdForIoKey,
  paramNodeId,
  type ParamEntry,
} from "~/lib/workflow-param-mapping";
import type { WorkflowIOMap } from "~/lib/workflow-io-types";

/** 默认连线状态（非作者画的线）的描边色。 */
const AUTO_STROKE = "#64748b";
/** 作者画过的线的描边色（与画布 primary 同系）。 */
const MANUAL_STROKE = "#a78bfa";

export interface BuildParamEdgesCtx {
  entries: readonly ParamEntry[];
  /** 当前模式下生效的「条目 id → 目标 ioKey」。 */
  resolved: Record<string, string | null>;
  /** 某个条目在当前模式下是否作者画过线。 */
  isManual: (entryId: string) => boolean;
  /** 当前视图的 workflowIO —— 把映射目标（ioKey）翻成画布上的 handle id。
   *  缺省时不做翻译（调用方已保证 target 就是 handle id）。 */
  io?: WorkflowIOMap | null;
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
  const { entries, resolved, isManual, io, renderedCardIds } = ctx;
  const out: Edge[] = [];
  for (const entry of entries) {
    const target = resolved[entry.id];
    /* 未连线 / 显式断开 → 不画线（卡片悬空既说明「没连上」，也不误导）。 */
    if (!target) continue;
    /* 卡片不存在（宿主节点不在当前视图里）→ 同样不画线：
     *  没有 source 节点的线是画布上那个「多出来的节点」。 */
    if (renderedCardIds && !renderedCardIds.has(paramNodeId(entry.id))) continue;
    /* 映射目标在存储层是 ioKey（运行期 `io[target]` 回查要用），但 React Flow
     * 的 targetHandle 必须是节点卡片上真实渲染的 handle id（pin 名）。两者
     * 不同名时写 ioKey 会让 React Flow 找不到 handle，整条线被丢弃并打
     * error#008（ISSUE #374）。未传 io 的调用方沿用旧行为。 */
    const targetHandle = io ? handleIdForIoKey(io, target) : target;
    if (!targetHandle) continue;
    const manual = isManual(entry.id);
    out.push({
      id: `pe-${entry.id}`,
      source: paramNodeId(entry.id),
      sourceHandle: "pio-out",
      target: entry.nodeId,
      targetHandle,
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
