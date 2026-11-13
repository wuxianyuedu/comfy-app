"use client";

/* ComfyUI 子图包裹节点的紫色身份标题栏：
 * 收起箭头 + 「S」徽标 + 下钻动作 + IO 编辑复选框 +
 * 节点 id 章。与普通 WorkflowNode 头部同一个 NODE_TITLE_H，
 * 好让带标题的节点在网格上对齐。 */
import { ExternalLink } from "lucide-react";
import { mixHex, NODE_TITLE_H } from "../workflow-utils";
import { useCssColorToken } from "../hooks/use-css-color-token";
import { Button } from "~/components/ui/button";
import { IoCheckbox, NodeIdChip, type IOEditContextValue } from "./IOEditContext";
import { Hint } from "~/components/ui/hint";

export type SubgraphHeaderProps = {
  accent: string;
  io?: IOEditContextValue;
  isCollapsed: boolean;
  nodeId: string;
  onEnter?: () => void;
  onToggle: () => void;
  /** First output entry used by the per-node output checkbox（只带端口身份：
   *  显示名不进库，由富化链一处给）。Pass null when the subgraph exposes no
   *  outputs. */
  outputRef?: { name: string } | null;
  title: string;
};

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
      {/* 收起/展开开关，与 WorkflowNode 同一箭头，位于头部左上角。Button 默认 type="button"；
          click 与 pointer-down 都 stopPropagation，免得 ReactFlow 当作节点拖拽起点，
          也避免外层 onDoubleClick（下钻）在同一双击中触发。 */}
      <Hint label={isCollapsed ? "展开" : "折叠"}>
        <Button
          aria-label={isCollapsed ? "展开子图" : "折叠子图"}
          className="text-ink-soft hover:bg-subtle hover:text-ink-bright active:bg-surface-2 size-5 shrink-0 rounded"

          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          size="icon-xs"
          style={{ pointerEvents: "auto" }}
          variant="ghost"
        >
          <svg
            data-icon="inline-start"
            fill="none"
            height="10"
            style={{
              transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 120ms ease",
            }}
            viewBox="0 0 10 10"
            width="10"
          >
            <path
              d="M3.5 2 L7 5 L3.5 8"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </Button>
      </Hint>
      <Hint label="子工作流">
        <span
          className="text-4xs inline-flex size-3.5 shrink-0 items-center justify-center rounded font-bold"
          style={{
            background: accent,
            color: "var(--color-canvas)",
            boxShadow: `0 0 6px ${accent}`,
          }}
        >
          S
        </span>
      </Hint>
      {/* 展开入口只保留右上角的 ExternalLink 钻入按钮——标题点击与
       *  回车聚焦不再触发进入子工作流（见 WorkflowSubgraphNode 双击移除
       *  同一决策），避免用户误触。标题保持纯文本，禁止选中。 */}
      <Hint label={title || "子工作流"}>
        <span className="text-ink-bright min-w-0 flex-1 truncate text-xs font-semibold tracking-wide select-none">
          {title || "子工作流"}
        </span>
      </Hint>
      {/* 子图节点右上角的**按节点**输出复选框。
       *  理由同 WorkflowNode —— 输出按节点标识，
       *  所以逐端口复选框已移除；一个复选框标记
       *  整个节点作为工作流输出源。 */}
      {io?.ioEditMode === true && outputRef && (
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
        <Hint accessibleName label="展开子工作流">
          <Button
            /* 下钻章从 h-4 w-4（16×16）提到 h-6 w-6（24×24）—— 用户反馈 30px 标题行上目标太小。
             * 24×24 比 NODE_TITLE_H 矮 3px，仍像行内按钮；比收起箭头 h-5 w-5 大一档，标记下钻是子图主要动作。 */
            className="text-primary-strong hover:bg-primary/30 text-3xs ml-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:text-white"
            onClick={(event) => {
              event.stopPropagation();
              onEnter();
            }}
            size="icon-xs"
            variant="ghost"
          >
            <ExternalLink data-icon="inline-start" size={12} strokeWidth={2.5} />
          </Button>
        </Hint>
      )}
    </div>
  );
}
