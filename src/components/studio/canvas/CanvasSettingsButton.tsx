"use client";
/* ── 右上角齿轮按钮（与 <ZoomIndicator> 并排）──
 * 设置偏离默认值时显示一个紫色小点，让用户不必打开
 * <CanvasSettingsPanel> 也知道自己的定制在生效。
 * 位置契约：本按钮在 `top-12`，正上方 <CanvasRecenterButton> 在 `top-3`，
 * 两处的定位类要一起改。 */
import { Hint } from "~/components/ui/hint";
import { Button } from "~/components/ui/button";

interface ButtonProps {
  hasOverrides: boolean;
  onClick: () => void;
}

export function CanvasSettingsButton({ hasOverrides, onClick }: ButtonProps) {
  return (
    <Hint label="画布设置 · 调整格子 / 坐标尺 / 缩略图 等">
      <Button
        variant="outline"
        onClick={onClick}
        aria-label="画布设置"
        className="bg-panel/90 border-border-strong text-ink-soft hover:border-ink-fainter hover:text-ink-bright z-base pointer-events-auto absolute top-12 right-3 h-auto rounded-md px-2.5 py-1 font-medium tracking-tight shadow-lg backdrop-blur-sm select-none"
      >
        <span aria-hidden className="mr-1 align-baseline text-[12px]">
          ⚙
        </span>
        设置
        {/* 紫色小点告诉用户「当前有偏离默认值的偏好」，
         * 不必先打开面板。它既是状态指示，也算一点点品牌色。 */}
        {hasOverrides && (
          <span
            aria-hidden
            className="bg-primary ml-1 inline-block size-1.5 -translate-y-px rounded-full align-middle shadow-[0_0_6px_rgba(167,139,250,0.7)]"
          />
        )}
      </Button>
    </Hint>
  );
}
