"use client";
/* 折叠态句柄锚点 —— 从 workflow-node.tsx 抽出。
 * 节点折叠时卡片体隐藏，但连线仍需锚点。每侧
 * 塌缩成一根装饰性「圆柱」（一颗高药丸）；
 * 底下保留逐端口 <Handle> 栈作为极小的不可见
 * 锚点，好让每条线的 id 绑到各自的锚点，切换时
 * 边永不脱落。 */
import { clamp } from "~/lib/clamp";
import { Handle, Position } from "@xyflow/react";
import { useTheme } from "next-themes";
import { portColor } from "~/lib/comfyui/types";
import { Z } from "~/lib/shell/overlay-z";
import { resolveAnchorCylinder } from "./workflow-node-palette";
import type { WorkflowNodeData } from "../workflow-types";

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
  // 圆柱视觉高度随端口数缩放，夹在 16px..64px 之间，
  // 好让它永不盖过图标 / 标题栏。
  const cylH = (count: number) => clamp(12 + count * 4, 16, 64);
  /* 锚柱（收起时的端口载体）跟主题联动：浅色下白描白会让锚柱整个消失。 */
  const { resolvedTheme } = useTheme();
  const anchor = resolveAnchorCylinder(resolvedTheme);

  return (
    <>
      {/* 左圆柱 —— 仅当有已连线输入时。不透明的
       *  灰色渐变压在连线之上（zIndex:10），好让用户
       *  在繁忙画布上看出「我的端口在这里」。 */}
      {connectedInputs.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: -3,
            top: "50%",
            transform: "translateY(-50%)",
            width: 6,
            height: cylH(connectedInputs.length),
            borderRadius: 999,
            background: anchor.gradient,
            border: anchor.border,
            boxShadow: anchor.boxShadow,
            zIndex: Z.base,
          }}
        />
      )}
      {/* 右圆柱 —— 只要节点声明了输出就画（ComfyUI 的
       *  「输出始终可见」规则）。 */}
      {outputs.length > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            right: -3,
            top: "50%",
            transform: "translateY(-50%)",
            width: 6,
            height: cylH(outputs.length),
            borderRadius: 999,
            background: anchor.gradient,
            border: anchor.border,
            boxShadow: anchor.boxShadow,
            zIndex: Z.base,
          }}
        />
      )}

      {/* 不可见的逐端口 Handle —— 连线锚在这里，好让活边
       *  几何在切换折叠时永不破坏。经
       *  opacity:0 隐藏，但 `isConnectable:false` 以免误连线。 */}
      {connectedInputs.map(([k], idx) => {
        const inputType =
          data.rawInputs?.find((raw) => raw.name === k)?.type ?? "*";
        const col = portColor(inputType);
        const total = connectedInputs.length;
        const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
        return (
          <Handle
            key={`collapsed-in-${k}-${idx}`}
            type="target"
            position={Position.Left}
            id={String(k)}
            isConnectable={false}
            className="size-2! rounded-full!"
            style={{
              left: 0,
              top: `calc(50% + ${offset}px)`,
              background: col,
              opacity: 0,
            }}
            title={`${String(k)} (${inputType})`}
          />
        );
      })}
      {connectedOutputs.map(([name, type], idx) => {
        const col = portColor(type);
        const total = connectedOutputs.length;
        const offset = total > 1 ? (idx - (total - 1) / 2) * 6 : 0;
        return (
          <Handle
            key={`collapsed-out-${name}-${idx}`}
            type="source"
            position={Position.Right}
            id={`out:${name}`}
            isConnectable={false}
            className="size-2! rounded-full!"
            style={{
              right: 0,
              top: `calc(50% + ${offset}px)`,
              background: col,
              opacity: 0,
            }}
            title={`Output: ${name} (${type})`}
          />
        );
      })}
    </>
  );
}
