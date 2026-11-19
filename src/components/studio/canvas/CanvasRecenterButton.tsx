"use client";
/* 「重新居中」按钮（紧挨 ⚙ 设置上方）。
 * 位置契约：本按钮 `top-3`、正下方 <CanvasSettingsButton> `top-12`，两处定位类须一起改。
 * 自动聚焦只在打开工作流 / 进入子工作流时做一次；拖出视野后需要回内容处的出口（只动视口、不改数据、不写库）。 */
import { Hint } from "~/components/ui/hint";
import { Button } from "~/components/ui/button";

export function CanvasRecenterButton({ onClick }: { onClick: () => void }) {
  return (
    <Hint label="回到有节点的位置（只移动视口，不改动节点布局）">
      <Button
        aria-label="重新居中"
        className="bg-panel border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright z-base pointer-events-auto absolute top-3 right-3 h-auto rounded-md px-2.5 py-1 font-medium tracking-tight shadow-lg select-none"
        onClick={onClick}
        variant="outline"
      >
        <span aria-hidden className="mr-1 align-baseline text-xs">
          🎯
        </span>
        居中
      </Button>
    </Hint>
  );
}
