import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Hint } from "~/components/ui/hint";

/**
 * 悬浮「说明」按钮 —— 全库唯一实现（规范 §12.18：一处实现、多处复用）。
 *
 * 它最初只服务 `PageHeader`（把页头那句解释收成一颗按钮，不占标题区一行，
 * ISSUE #1693）；现在视图说明统一挂到**顶栏视图标题右侧**（`TopBar`），
 * 屏内页头不再重复显示标题（同一件事在一屏里出现两个名字正是 ISSUE #1693
 * 要治的病）—— 两个宿主共用这一颗按钮，形状才不会漂。
 *
 * 图标按钮本身没有可见文字，所以它自带一个短名 `aria-label="说明"` —— 不把整句
 * 提示当可访问名（读屏念一长句不理想）。这一档**刻意不开** `Hint` 的
 * `accessibleName`：那个开关会把 `label` 写成子元素的 `aria-label`，正好把这里
 * 更精确的短名顶掉。
 *
 * 尺寸口径：问号与**正文字号同大**（`size-3.5` = 14px，与顶栏视图标题的
 * `text-sm` 一致）—— 它跟在标题旁边，比标题大会抢视线、比正文小又看不清；
 * 按钮收 `icon-xs`（24px 方钮）只为留住舒适的点击区。
 *
 * 没有说明可放的宿主**不要渲染它**（「没有说明的不显示」）—— 由调用方判
 * `text === undefined`，不在这里造默认文案。
 */
export function HeaderHelp({ text }: { text: ReactNode }) {
  return (
    <Hint side="bottom" label={text}>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="说明"
        className="text-ink-fainter hover:text-ink-bright shrink-0 rounded-full"
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </Button>
    </Hint>
  );
}
