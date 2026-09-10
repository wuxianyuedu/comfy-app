"use client";

/* 把「对外参数 → 目标端口」的映射同步进 React Flow store：
 *
 *   · 带映射的端口临时挂上 node.data.mappedSource → FlowNode 据此渲染圆点，
 *     于是连线两端都有可视锚点（其余端口没有 Handle，连不上也看不见）。
 *   · 未映射的端口清掉该标记（自动映射被撤销时立刻回落）。
 *
 * 视图（React Flow 画布）不持有业务规则，同步逻辑集中在这里。 */

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";
import type { ParamWire } from "./ParamWireLayer";

export function ParamTargetSync({ wires }: { wires: ParamWire[] }) {
  const { setNodes } = useReactFlow();

  useEffect(() => {
    const byNode = new Map<string, Map<string, string>>();
    for (const wire of wires) {
      if (!wire.targetSlot) continue;
      const ports = byNode.get(wire.targetNodeId) ?? new Map<string, string>();
      ports.set(wire.targetSlot, wire.sourceId);
      byNode.set(wire.targetNodeId, ports);
    }
    setNodes((nodes) =>
      nodes.map((node) => {
        const ports = byNode.get(String(node.id));
        const data = node.data as { mappedSource?: Record<string, string> } | undefined;
        const current = data?.mappedSource;
        const next = ports ? Object.fromEntries(ports) : undefined;
        const same =
          (!current && !next) ||
          (current &&
            next &&
            Object.keys(current).length === Object.keys(next).length &&
            Object.entries(current).every(([key, value]) => next[key] === value));
        if (same) return node;
        return { ...node, data: { ...node.data, mappedSource: next } };
      })
    );
  }, [wires, setNodes]);

  return null;
}
