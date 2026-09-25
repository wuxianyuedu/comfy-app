"use client";
/* FlowNode 头部栏 —— 从 workflow-node.tsx 抽出。
 * 收起开关 + 状态圆点 + 标题 + 按节点 IO 复选框 + #id 章
 * + 角色徽标。与 ComfyUI 标题栏一样钉在 NODE_TITLE_H。 */
import { colorToRgba, NODE_TITLE_H } from "../workflow-utils";
import {
  IoCheckbox,
  NodeIdChip,
  type IOEditContextValue,
} from "./IOEditContext";
import { Button } from "~/components/ui/button";
import type { WorkflowNodeData, IoRef } from "../workflow-types";
import type { NodePalette } from "./workflow-node-palette";

export interface FlowNodeRole {
  key: string;
  label: string;
  color: string;
  bg: string;
}

interface FlowNodeHeaderProps {
  data: WorkflowNodeData;
  role?: FlowNodeRole;
  io: IOEditContextValue | null;
  outputs: [string, string][];
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  palette: Pick<NodePalette, "headerBg" | "titleColor" | "dotBg">;
  displayTitle: string;
}

export function FlowNodeHeader({
  data,
  role,
  io,
  outputs,
  isCollapsed,
  onToggleCollapsed,
  palette,
  displayTitle,
}: FlowNodeHeaderProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-t-lg px-2 text-xs"
      style={{
        height: NODE_TITLE_H,
        background: palette.headerBg,
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      {/* 收起 / 展开开关。Button 默认 type="button"，以免将来外层
       *  <form> 提交时误触章；click 与 mousedown 都 stopPropagation，
       *  好让节点拖拽处理器不把它当成拖拽起点。
       *  折叠时箭头朝**右**（点击展开），展开时顺时针转 90°
       *  朝**下**（点击收起）。 */}
      <Button
        variant="ghost"
        size="icon-xs"

        aria-label={isCollapsed ? "展开节点" : "折叠节点"}
        title={isCollapsed ? "展开" : "折叠"}
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className="text-ink-soft hover:bg-subtle hover:text-ink-bright active:bg-surface-2 size-5 shrink-0 rounded"
        style={{ pointerEvents: "auto" }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
            transition: "transform 120ms ease",
          }}
        >
          <path
            d="M3.5 2 L7 5 L3.5 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Button>
      <span
        className="inline-block size-2 shrink-0 rounded-full"
        style={{
          background: palette.dotBg,
          boxShadow: `0 0 6px ${palette.dotBg}`,
        }}
      />
      <span
        className="flex-1 truncate text-[12px] font-medium tracking-wide"
        style={{ color: palette.titleColor }}
        title={
          data.title && data.title !== displayTitle ? data.title : displayTitle
        }
      >
        {displayTitle}
      </span>
      {/* 按节点输出复选框 —— 工作流输出按**节点**标识
       *（comfy-cli 执行字典以 nodeId 为键），不是按输出端口，
       * 所以一个复选框标记**整个**节点为工作流输出。 */}
      {io?.ioEditMode && outputs.length > 0 && (
        <IoCheckbox
          io={io}
          ioRef={
            {
              nodeId: data.nodeId,
              hostNodeId: data.hostNodeId,
              name: outputs[0]![0],
              kind: "output",
              direction: "output",
            } satisfies IoRef
          }
        />
      )}
      {/* 右对齐的 `#<nodeId>` 章 —— 点击打开 NodeJsonPopover。
       * stopPropagation 以免触发拖拽 / 双击下钻。 */}
      <NodeIdChip nodeId={data.nodeId} variant="node" />
      {role && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
          style={{
            background: colorToRgba(role.color, 0.25),
            color: role.color,
          }}
        >
          {role.label}
        </span>
      )}
    </div>
  );
}
