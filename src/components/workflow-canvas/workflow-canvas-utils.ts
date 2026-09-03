import type { Edge, Node } from "@xyflow/react";
import type { NodeData } from "./types";

/**
 * 删除边 / 删除节点时，清理下游节点 `data.inputs` 里指向被删连线（`in-<key>`）
 * 的残留引用，使其与 edges 保持一致。
 *
 * - `downstreamIds` 不传：清理所有与被删边 target 相连的节点（handleEdgesDelete 语义）。
 * - `downstreamIds` 传入：仅清理其中的节点（deleteSelected 语义——只波及从被删
 *   节点出发可达的下游）。
 */
export function cleanupDownstreamInputs(
  nodes: Node[],
  removed: Edge[],
  downstreamIds?: Set<string>
): Node[] {
  const targets = new Set(removed.map((edge) => edge.target));
  return nodes.map((node) => {
    if (downstreamIds && !downstreamIds.has(node.id)) return node;
    if (!targets.has(node.id)) return node;
    const d = node.data as unknown as NodeData;
    let changed = false;
    const inputs = { ...d.inputs };
    for (const e of removed) {
      if (e.target !== node.id || !e.targetHandle) continue;
      const m = /^in-(.+)$/.exec(e.targetHandle);
      const key = m?.[1];
      // 跳过兜底通用端口，避免写出 `generic` 伪输入 / 重复 Handle。
      if (key && key !== "generic" && key in inputs && Array.isArray(inputs[key])) {
        delete inputs[key];
        changed = true;
      }
    }
    return changed ? { ...node, data: { ...d, inputs } } : node;
  });
}
