"use client";
/* ── Top-right 「重新居中」按钮（紧挨 ⚙ 设置上方）──
 * 位置契约：本按钮在 `top-3`，正下方 <CanvasSettingsButton> 在 `top-12`，
 * 两处的定位类要一起改。
 *
 * 为什么需要它：自动聚焦只在「打开工作流 / 进入子工作流」时做一次，之后
 * 作者把节点拖出视野、或用滚轮把画布缩成一团时，没有回到内容处的出口
 * （与项目画布的「重置布局」不同 —— 那个会改数据，这个只动视口）。
 * 纯视口动作，不写库、不移动任何节点。 */
import { Hint } from "~/components/ui/hint";
import { Button } from "~/components/ui/button";

export function CanvasRecenterButton({ onClick }: { onClick: () => void }) {
  return (
    <Hint label="回到有节点的位置（只移动视口，不改动节点布局）">
      <Button
        variant="outline"
        onClick={onClick}
        aria-label="重新居中"
        className="bg-panel/90 border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright z-base pointer-events-auto absolute top-3 right-3 h-auto rounded-md px-2.5 py-1 font-medium tracking-tight shadow-lg backdrop-blur-sm select-none"
      >
        <span aria-hidden className="mr-1 align-baseline text-xs">
          🎯
        </span>
        居中
      </Button>
    </Hint>
  );
}
