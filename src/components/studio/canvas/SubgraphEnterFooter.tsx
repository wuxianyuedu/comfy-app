"use client";

/* 子图封装节点底部的「进入子图」进入条 —— 形态对齐新版 ComfyUI：
 * 整宽、上缘一条细分隔线、水平居中的弱化色文字 + 登录式图标，
 * 悬停提亮。取代旧版标题栏右上角的小图标钻入章（目标太小，
 * 且与新版观感不一致）。折叠态不渲染（与主体各区一致）。
 * click / mousedown / pointerdown 都 stopPropagation：既别把点击
 * 当成 React Flow 的节点拖拽起点，也别让外层再处理同一事件。 */
import { LogIn } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";

export function SubgraphEnterFooter({ onEnter }: { onEnter?: () => void }) {
  if (!onEnter) {
    return null;
  }
  return (
    <Hint label="展开并进入该子工作流的内部画布">
      <Button
        className="border-border-subtle text-ink-soft hover:bg-subtle hover:text-ink-bright mt-auto h-auto w-full shrink-0 items-center justify-center gap-1.5 rounded-b-lg border-t px-2 py-1.5 text-xs transition-colors select-none"
        onClick={(event) => {
          event.stopPropagation();
          onEnter();
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        variant="ghost"
      >
        进入子图
        <LogIn aria-hidden size={13} strokeWidth={2} />
      </Button>
    </Hint>
  );
}
