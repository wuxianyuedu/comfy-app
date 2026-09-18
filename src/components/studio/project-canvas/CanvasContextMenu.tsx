"use client";

/** 从 ProjectCanvas 抽出的右键上下文菜单。纯展示组件 —— `menu` 状态与
 *  建节点动作都由调用方持有。
 */
import { Icon } from "~/components/ui/icon";
import { Button } from "~/components/ui/button";
import { NODE_META, type NodeKind } from "~/lib/project-canvas/canvas-types";
import { overlayClass } from "~/lib/full-screen-layer";
import { zClass } from "~/lib/shell/overlay-z";

interface CanvasContextMenuProps {
  x: number;
  y: number;
  onPick: (kind: NodeKind) => void;
  /** 放一个纯视觉的 Ardot 风测试节点（无运行时）。 */
  onPickTest: () => void;
  onClose: () => void;
}

export function CanvasContextMenu({
  x,
  y,
  onPick,
  onPickTest,
  onClose,
}: CanvasContextMenuProps) {
  return (
    <>
      <div
        className={overlayClass("modal", zClass("canvasMax"))}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className={`border-border-strong bg-panel/95 fixed ${zClass("popup")} w-52 overflow-hidden rounded-xl border p-1.5 shadow-2xl shadow-black/20 backdrop-blur dark:shadow-black/60`}
        style={{ left: x, top: y }}
      >
        {/* ── 测试节点（纯视觉，对齐 Ardot 稿）── */}
        <Button
          variant="ghost"
          data-canvas-node-kind="workflow-ardot"
          onClick={onPickTest}
          className="from-primary/15 to-accent/10 text-ink-bright hover:from-primary/25 hover:to-accent/15 flex h-auto w-full items-center gap-2 rounded-lg border border-violet-400/30 bg-linear-to-r px-2 py-1.5 text-left text-[12px] font-normal transition-colors"
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold text-white"
            style={{
              background: "linear-gradient(135deg, #7C5CFC 0%, #FF5CA8 100%)",
            }}
          >
            W
          </span>
          <span className="flex flex-col">
            <span className="font-medium">测试自定义工作流</span>
            <span className="text-ink-muted text-[10px]">
              纯视觉 · 对齐 Ardot 稿（无运行时）
            </span>
          </span>
        </Button>

        <div className="bg-border-strong my-1 h-px" />
        <div className="text-ink-muted px-2 py-1 text-[10px] tracking-wider uppercase">
          创建节点
        </div>
        {(Object.keys(NODE_META) as NodeKind[]).map((kind) => {
          const meta = NODE_META[kind];
          return (
            <Button
              key={kind}
              variant="ghost"
              data-canvas-node-kind={kind}
              onClick={() => onPick(kind)}
              className="text-ink-bright hover:bg-subtle flex h-auto w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-normal transition-colors"
            >
              <Icon
                name={meta.icon}
                size={15}
                className="text-violet-700 dark:text-violet-300"
              />
              <span className="flex flex-col">
                <span className="font-medium">{meta.label}</span>
                <span className="text-ink-muted text-[10px]">{meta.desc}</span>
              </span>
            </Button>
          );
        })}
      </div>
    </>
  );
}
