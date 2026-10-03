"use client";
/* 折叠态句柄锚点 —— 从 workflow-node.tsx 抽出。
 * 节点折叠时卡片体隐藏，但连线仍需锚点。每侧
 * 塌缩成一根装饰性「圆柱」（一颗高药丸）；
 * 底下保留逐端口 <Handle> 栈作为极小的不可见
 * 锚点，好让每条线的 id 绑到各自的锚点，切换时
 * 边永不脱落。
 *
 * 本文件同时输出两个共享原语（<CollapsedAnchorCylinder> /
 * <CollapsedPortHandles>）：子图封装节点的折叠锚点
 * （SubgraphCollapsedAnchors）与 WorkflowNode 用的是**同一套视觉契约**
 * （圆柱 + 不可见逐端口 Handle），差别只在「哪些端口算已接线」的
 * 数据模型 —— 原语收口一处，两边不再各画一份。 */
import { clamp } from "~/lib/clamp";
import { Handle, Position } from "@xyflow/react";
import { useTheme } from "next-themes";
import { portColor } from "~/lib/comfyui/types";
import { Z } from "~/lib/shell/overlay-z";
import {
  resolveAnchorCylinder,
  type AnchorCylinderTheme,
} from "./workflow-node-palette";
import type { WorkflowNodeData } from "../workflow-types";

/* 圆柱视觉高度随端口数缩放，夹在 16px..64px 之间，
 * 好让它永不盖过图标 / 标题栏。 */
const cylH = (count: number) => clamp(12 + count * 4, 16, 64);

/** 折叠态的一根端口圆柱（左 / 右各一）。 */
export function CollapsedAnchorCylinder({
  side,
  count,
  anchor,
}: {
  side: "left" | "right";
  count: number;
  anchor: AnchorCylinderTheme;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{
        ...(side === "left" ? { left: -3 } : { right: -3 }),
        top: "50%",
        transform: "translateY(-50%)",
        width: 6,
        height: cylH(count),
        borderRadius: 999,
        background: anchor.gradient,
        border: anchor.border,
        boxShadow: anchor.boxShadow,
        zIndex: Z.base,
      }}
    />
  );
}

/** 折叠态的逐端口不可见 Handle 栈 —— 连线锚在这里，好让活边
 *  几何在切换折叠时永不破坏。经 opacity:0 隐藏，但
 *  `isConnectable:false` 以免误连线。 */
export function CollapsedPortHandles({
  items,
}: {
  items: {
    key: string;
    side: "left" | "right";
    id: string;
    title: string;
    color: string;
  }[];
}) {
  const total = items.length;
  return (
    <>
      {items.map((item, idx) => {
        const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
        return (
          <Handle
            key={item.key}
            type={item.side === "left" ? "target" : "source"}
            position={item.side === "left" ? Position.Left : Position.Right}
            id={item.id}
            isConnectable={false}
            className="size-2! rounded-full!"
            style={{
              ...(item.side === "left" ? { left: 0 } : { right: 0 }),
              top: `calc(50% + ${offset}px)`,
              background: item.color,
              opacity: 0,
            }}
            title={item.title}
          />
        );
      })}
    </>
  );
}

interface FlowNodeCollapsedAnchorsProps {
  data: WorkflowNodeData;
  orderedEntries: [string, unknown][];
  outputs: [string, string][];
}

export function FlowNodeCollapsedAnchors({
  data,
  orderedEntries,
  outputs,
}: FlowNodeCollapsedAnchorsProps) {
  // 已连线的输入（连线元组 `[]`）与已连线的输出保持锚定。
  const connectedInputs = orderedEntries.filter(([, v]) => Array.isArray(v));
  const connectedOutputs = outputs.filter(([n]) =>
    data.connectedOutputs?.has(n),
  );
  /* 锚柱（收起时的端口载体）跟主题联动：浅色下白描白会让锚柱整个消失。 */
  const { resolvedTheme } = useTheme();
  const anchor = resolveAnchorCylinder(resolvedTheme);

  return (
    <>
      {/* 左圆柱 —— 仅当有已连线输入时。不透明的
       *  灰色渐变压在连线之上（zIndex:10），好让用户
       *  在繁忙画布上看出「我的端口在这里」。 */}
      {connectedInputs.length > 0 && (
        <CollapsedAnchorCylinder
          side="left"
          count={connectedInputs.length}
          anchor={anchor}
        />
      )}
      {/* 右圆柱 —— 只要节点声明了输出就画（ComfyUI 的
       *  「输出始终可见」规则）。 */}
      {outputs.length > 0 && (
        <CollapsedAnchorCylinder
          side="right"
          count={outputs.length}
          anchor={anchor}
        />
      )}
      <CollapsedPortHandles
        items={connectedInputs.map(([k], idx) => {
          const inputType =
            data.rawInputs?.find((raw) => raw.name === k)?.type ?? "*";
          return {
            key: `collapsed-in-${k}-${idx}`,
            side: "left" as const,
            id: String(k),
            title: `${String(k)} (${inputType})`,
            color: portColor(inputType),
          };
        })}
      />
      <CollapsedPortHandles
        items={connectedOutputs.map(([name, type], idx) => ({
          key: `collapsed-out-${name}-${idx}`,
          side: "right" as const,
          id: `out:${name}`,
          title: `Output: ${name} (${type})`,
          color: portColor(type),
        }))}
      />
    </>
  );
}
