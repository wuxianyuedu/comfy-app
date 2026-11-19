import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";

/**
 * 悬浮「说明」按钮 —— 全库唯一实现（规范 §12.18）。最初只服务 `PageHeader`（ISSUE #1693），现在视图说明统一挂到顶栏视图标题右侧（`TopBar`），屏内页头不再重复显示标题；两个宿主共用这一颗按钮，形状才不会漂。
 * 图标按钮自带短名 `aria-label="说明"`（不把整句提示当可访问名），并**刻意不开** `Hint` 的 `accessibleName`：那个开关会把 `label` 写成子元素的 `aria-label`，顶掉这里更精确的短名。
 * 尺寸：问号与**正文字号同大**（`size-3.5` = 14px，与顶栏标题 `text-sm` 一致），按钮收 `icon-xs`（24px）只为留住舒适的点击区；没有说明可放的宿主**不要渲染它**，由调用方判 `text === undefined`，不在这里造默认文案。
 */
export function HeaderHelp({ text }: { text: ReactNode }) {
  return (
    <Hint label={text} side="bottom">
      <Button
        aria-label="说明"
        className="text-ink-fainter hover:text-ink-bright shrink-0 rounded-full"
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </Button>
    </Hint>
  );
}
