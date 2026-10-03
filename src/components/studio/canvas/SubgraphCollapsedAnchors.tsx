"use client";
/* 子图封装节点的折叠态句柄锚点 —— FlowNodeCollapsedAnchors 的同型件：
 * 同一套「圆柱 + 不可见逐端口 Handle」视觉契约（原语收口在那里），
 * 差别只在「哪些端口算已接线」的数据模型 —— 这里按子图的
 * `connectedInputs` / `connectedOutputs` 名字集合过滤。 */
import { useTheme } from "next-themes";
import { portColor } from "~/lib/comfyui/types";
import { resolveAnchorCylinder } from "./workflow-node-palette";
import {
  CollapsedAnchorCylinder,
  CollapsedPortHandles,
} from "./FlowNodeCollapsedAnchors";
import type { RawInputMeta, RawOutputMeta } from "../workflow-types";

interface SubgraphCollapsedAnchorsProps {
  /** 纯连接型输入端口（已滤掉空标签行）。 */
  connInputs: { inp: RawInputMeta; label: string }[];
  /** 暴露的输出端口（已滤掉空标签行）。 */
  outputs: { out: RawOutputMeta; display: string }[];
  connectedInputs?: Set<string>;
  connectedOutputs?: Set<string>;
}

export function SubgraphCollapsedAnchors({
  connInputs,
  outputs,
  connectedInputs,
  connectedOutputs,
}: SubgraphCollapsedAnchorsProps) {
  const wiredInputs = connInputs.filter(({ inp }) =>
    connectedInputs?.has(inp.name),
  );
  const wiredOutputs = outputs.filter(({ out }) =>
    connectedOutputs?.has(out.name),
  );
  /* 锚柱跟主题联动（浅色下白描白会让锚柱整个消失）。 */
  const { resolvedTheme } = useTheme();
  const anchor = resolveAnchorCylinder(resolvedTheme);

  return (
    <>
      {wiredInputs.length > 0 && (
        <CollapsedAnchorCylinder
          side="left"
          count={wiredInputs.length}
          anchor={anchor}
        />
      )}
      {outputs.length > 0 && (
        <CollapsedAnchorCylinder
          side="right"
          count={outputs.length}
          anchor={anchor}
        />
      )}
      <CollapsedPortHandles
        items={wiredInputs.map(({ inp, label }, idx) => ({
          key: `collapsed-sub-in-${inp.name}-${idx}`,
          side: "left" as const,
          id: inp.name,
          title: `${label} (${inp.type})`,
          color: portColor(inp.type ?? "*"),
        }))}
      />
      <CollapsedPortHandles
        items={wiredOutputs.map(({ out, display }, idx) => ({
          key: `collapsed-sub-out-${out.name}-${idx}`,
          side: "right" as const,
          id: `out:${out.name}`,
          title: `${display} (${out.type})`,
          color: portColor(out.type ?? "*"),
        }))}
      />
    </>
  );
}
