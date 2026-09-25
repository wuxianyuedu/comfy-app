"use client";

/** 从 ProjectCanvas 抽出的右键上下文菜单（ISSUE #672 / 规范 16 §16.2.4.6
 *  第一档：接 `ui/dropdown-menu`）。
 *
 *  此前是自绘外壳：一层 `fixed` 手定位面板 + 一层自绘遮罩负责关闭，Esc /
 *  方向键 / `role="menu"` 全都没有。现在这些语义由 base-ui 的 `Menu` 给，
 *  **调用处那份手写语义随之删掉**（只换容器会留下两套关闭路径）。
 *
 *  唯一需要自己想清楚的一处：菜单要开在**右键那个点**上，而 base-ui 的
 *  定位需要一个 trigger 元素 —— 所以这里渲染一个 `fixed` 的零尺寸 trigger
 *  放在 (x, y)，让 Positioner 锚定它。`open` 由父级持有的 `menu` 状态决定。
 */
import { Icon } from "~/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { NODE_META, type NodeKind } from "~/lib/project-canvas/canvas-types";

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
    <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
      {/* 零尺寸定位锚点：菜单开在右键那个点上，而不是某个可见控件旁边。 */}
      <DropdownMenuTrigger
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none fixed h-0 w-0"
        style={{ left: x, top: y }}
      />
      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={0}
        /* 锚点是零尺寸，`w-(--anchor-width)` 会算成 0，这里给回原来的固定宽。 */
        className="border-border-strong bg-panel/95 w-52 overflow-hidden rounded-xl border p-1.5 shadow-2xl shadow-black/20 backdrop-blur dark:shadow-black/60"
      >
        {/* ── 测试节点（纯视觉，对齐 Ardot 稿）── */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            data-canvas-node-kind="workflow-ardot"
            onClick={onPickTest}
            className="from-primary/15 to-accent/10 text-ink-bright focus:from-primary/25 focus:to-accent/15 flex items-center gap-2 rounded-lg border border-violet-400/30 bg-linear-to-r px-2 py-1.5 text-left text-[12px]"
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
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="bg-border-strong" />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-ink-muted px-2 py-1 text-[10px] tracking-wider uppercase">
            创建节点
          </DropdownMenuLabel>
          {(Object.keys(NODE_META) as NodeKind[]).map((kind) => {
            const meta = NODE_META[kind];
            return (
              <DropdownMenuItem
                key={kind}
                data-canvas-node-kind={kind}
                onClick={() => onPick(kind)}
                className="text-ink-bright focus:bg-subtle flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px]"
              >
                <Icon
                  name={meta.icon}
                  size={15}
                  className="text-primary-strong"
                />
                <span className="flex flex-col">
                  <span className="font-medium">{meta.label}</span>
                  <span className="text-ink-muted text-[10px]">
                    {meta.desc}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
