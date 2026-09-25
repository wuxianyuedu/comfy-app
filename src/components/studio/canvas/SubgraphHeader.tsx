"use client";

/* 抽出的 SubgraphHeader —— ComfyUI 子图包裹节点的紫色身份标题栏
 *（原本内联在 WorkflowSubgraphNode 里）。
 * 收起箭头 + 「S」徽标 + 下钻动作 + IO 编辑复选框 +
 * 节点 id 章。与普通 WorkflowNode 头部同一个 NODE_TITLE_H，
 * 好让带标题的节点在网格上对齐。 */
import { ExternalLink } from "lucide-react";
import { mixHex, NODE_TITLE_H } from "../workflow-utils";
import { useCssColorToken } from "../hooks/use-css-color-token";
import { Button } from "~/components/ui/button";
import {
  IoCheckbox,
  NodeIdChip,
  type IOEditContextValue,
} from "./IOEditContext";

export interface SubgraphHeaderProps {
  title: string;
  nodeId: string;
  accent: string;
  isCollapsed: boolean;
  onToggle: () => void;
  onEnter?: () => void;
  io?: IOEditContextValue;
  /** First output entry used by the per-node output checkbox（只带端口身份：
   *  显示名不进库，由富化链一处给）。Pass null when the subgraph exposes no
   *  outputs. */
  outputRef?: { name: string } | null;
}

export function SubgraphHeader({
  title,
  nodeId,
  accent,
  isCollapsed,
  onToggle,
  onEnter,
  io,
  outputRef,
}: SubgraphHeaderProps) {
  /* 标题栏底色 = 节点表面色与子图身份色 accent 的 20% 混色。混色基准此前
     写死 `#16161E`，Light 下整条标题栏仍是暗色（浅色节点配黑标题）。
     基准改为跟主题走的 `--color-node-mix-base`（浅色=白、深色=原 #16161e）。 */
  const mixBase = useCssColorToken("--color-node-mix-base", "#ffffff");
  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-t-lg px-2 text-xs"
      style={{
        height: NODE_TITLE_H,
        background: mixHex(mixBase, accent, 0.2),
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      {/* 收起 / 展开开关。与 WorkflowNode 同一个箭头；
       *  位于头部左上角。Button 默认 type="button"。click 与
       *  pointer-down 都 stopPropagation，好让 ReactFlow 的拖拽处理器
       *  不把它当成节点拖拽起点，也免得外层
       *  `onDoubleClick`（下钻）在这里起手的双击
       *  之后被触发。 */}
      <Button
        variant="ghost"
        size="icon-xs"

        aria-label={isCollapsed ? "展开子图" : "折叠子图"}
        title={isCollapsed ? "展开" : "折叠"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
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
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[9px] font-bold"
        style={{
          background: accent,
          color: "var(--color-canvas)",
          boxShadow: `0 0 6px ${accent}`,
        }}
        title="子工作流"
      >
        S
      </span>
      {/* 展开入口只保留右上角的 ExternalLink 钻入按钮——标题点击与
       *  回车聚焦不再触发进入子工作流（见 WorkflowSubgraphNode 双击移除
       *  同一决策），避免用户误触。标题保持纯文本，禁止选中。 */}
      <span
        className="text-ink-bright min-w-0 flex-1 truncate text-[12px] font-semibold tracking-wide select-none"
        title={title || "子工作流"}
      >
        {title || "子工作流"}
      </span>
      {/* 子图节点右上角的**按节点**输出复选框。
       *  理由同 WorkflowNode —— 输出按节点标识，
       *  所以逐端口复选框已移除；一个复选框标记
       *  整个节点作为工作流输出源。 */}
      {io?.ioEditMode && outputRef && (
        <IoCheckbox
          io={io}
          ioRef={{
            nodeId: String(nodeId),
            name: outputRef.name,
            kind: "output",
            direction: "output",
          }}
        />
      )}
      <NodeIdChip nodeId={String(nodeId)} variant="subgraph" />
      {onEnter && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            event.stopPropagation();
            onEnter();
          }}
          title="展开子工作流"
          /* 从 h-4 w-4（16×16）提到 h-6 w-6
           *  （24×24）—— 用户反馈此前这下钻章在
           *  30px 高的标题行上目标太小。24×24 比
           *  NODE_TITLE_H 矮 3px，所以仍像一颗
           *  行内按钮（而不是 28-32px 的独立章观感）。
           *  比收起箭头的 h-5 w-5 大一档，
           *  以标记下钻是子图的*主要*动作。 */
          className="text-primary-strong hover:bg-primary/30 ml-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded text-[10px] transition-colors hover:text-white"
        >
          <ExternalLink size={12} strokeWidth={2.5} />
        </Button>
      )}
    </div>
  );
}
