"use client";
/* 子图封装节点的折叠态句柄锚点 —— FlowNodeCollapsedAnchors 的同型件：
 * 同一套「圆柱 + 不可见逐端口 Handle」视觉契约（原语收口在那里），
 * 差别只在「哪些端口算已接线」的数据模型 —— 这里按子图的
 * `connectedInputs` / `connectedOutputs` 名字集合过滤。 */
import { useTheme } from "next-themes";
import { portColor } from "~/lib/comfyui/types";
import { resolveAnchorCylinder } from "./workflow-node-palette";
import { CollapsedAnchorCylinder, CollapsedPortHandles } from "./FlowNodeCollapsedAnchors";
import type { RawInputMeta, RawOutputMeta } from "../workflow-types";

type SubgraphCollapsedAnchorsProps = {
  connectedInputs?: Set<string>;
  connectedOutputs?: Set<string>;
  /** 纯连接型输入端口（已滤掉空标签行）。 */
  connInputs: Array<{ inp: RawInputMeta; label: string }>;
  /** 暴露的输出端口（已滤掉空标签行）。 */
  outputs: Array<{ display: string; out: RawOutputMeta }>;
};

export function SubgraphCollapsedAnchors({
  connectedInputs,
  connectedOutputs,
  connInputs,
  outputs,
}: SubgraphCollapsedAnchorsProps) {
  const wiredInputs = connInputs.filter(({ inp }) => connectedInputs?.has(inp.name));
  const wiredOutputs = outputs.filter(({ out }) => connectedOutputs?.has(out.name));
  /* 锚柱跟主题联动（浅色下白描白会让锚柱整个消失）。 */
  const { resolvedTheme } = useTheme();
  const anchor = resolveAnchorCylinder(resolvedTheme);

  return (
    <>
      {wiredInputs.length > 0 && (
        <CollapsedAnchorCylinder anchor={anchor} count={wiredInputs.length} side="left" />
      )}
      {outputs.length > 0 && (
        <CollapsedAnchorCylinder anchor={anchor} count={outputs.length} side="right" />
      )}
      <CollapsedPortHandles
        items={wiredInputs.map(({ inp, label }, idx) => ({
          color: portColor(inp.type ?? "*"),
          id: inp.name,
          key: `collapsed-sub-in-${inp.name}-${idx}`,
          side: /* SAFETY: 类型断言已复核 */ "left" as const,
          title: `${label} (${inp.type})`,
        }))}
      />
      <CollapsedPortHandles
        items={wiredOutputs.map(({ display, out }, idx) => ({
          color: portColor(out.type ?? "*"),
          id: `out:${out.name}`,
          key: `collapsed-sub-out-${out.name}-${idx}`,
          side: /* SAFETY: 类型断言已复核 */ "right" as const,
          title: `${display} (${out.type})`,
        }))}
      />
    </>
  );
}
