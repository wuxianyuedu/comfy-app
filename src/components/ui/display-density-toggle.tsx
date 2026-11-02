"use client";

/**
 * DisplayDensityToggle —— 「网格 / 列表」二选一的显示密度切换（规范 16
 * §16.2.4.75）。
 *
 * ## 为什么抽出来（ISSUE #1925）
 *
 * 收口前全库有**三处逐字相同**的手搓实现：画布历史抽屉、画布素材抽屉、
 * 素材库。它们连 `Hint` 的文案、`size="icon-xs"`、那一串三元里的
 * `bg-surface-2 text-ink-bright` 都一模一样 —— 正是 §12.12 说的孪生对。
 * 那三份坏在同一个**看不见的接缝**上：选中档只写了底色，**没钉字色悬停**，
 * 于是 `ghost` 变体自带的 `hover:text-foreground` 会在划过时把已选中那枚的
 * 字色翻掉；而底色 `bg-surface-2` 在浅色主题下与行头底色近值，本来就弱。
 * 逐个调用点看不出来 —— 缺的那一半在 `buttonVariants.ghost` 里。
 *
 * ## 语义
 *
 * 两枚里只有一枚生效 —— 所以是**单选**（`role="radiogroup"` + `radio` +
 * `aria-checked`），不是 `aria-pressed` 的开关。视觉与可访问性由 `value`
 * **同一个入参**驱动，调用处不可能只改一半。
 *
 * 图标按钮没有可见文字，所以两枚都有 `aria-label`（也是 `Hint` 的
 * `accessibleName` 来源 —— 图标按钮的可访问名由 `Hint` 给，见 §16.2.4）。
 */

import { LayoutGrid, List } from "lucide-react";

import { Hint } from "~/components/ui/hint";
import { SelectChip } from "~/components/ui/select-chip";
import { cn } from "~/lib/utils";

/** 显示密度两档。与 `~/lib/project-canvas/history-panel-types` 的
 * `DisplayMode` 同形 —— 这里是基元的入参名字，不复用那边的领域类型
 *（`ui/` 不依赖业务子域，§18）。 */
export type DisplayDensity = "grid" | "list";

export function DisplayDensityToggle({
  value,
  onChange,
  className,
}: {
  /** 外层容器的类（各落点的间距不同，底色 `bg-subtle` / 内边距由这里给）。 */
  className?: string;
  onChange: (next: DisplayDensity) => void;
  /** 当前档位。 */
  value: DisplayDensity;
}) {
  return (
    <div
      aria-label="显示密度"
      className={cn("bg-subtle flex items-center gap-0.5 rounded-lg p-0.5", className)}
      role="radiogroup"
    >
      <Hint accessibleName label="网格视图">
        <SelectChip
          aria-label="网格视图"
          className="h-auto rounded-md p-1"
          onClick={() => {
            onChange("grid");
          }}
          selected={value === "grid"}
          shape="compact"
        >
          <LayoutGrid data-icon="inline-start" size={14} />
        </SelectChip>
      </Hint>
      <Hint accessibleName label="列表视图">
        <SelectChip
          aria-label="列表视图"
          className="h-auto rounded-md p-1"
          onClick={() => {
            onChange("list");
          }}
          selected={value === "list"}
          shape="compact"
        >
          <List data-icon="inline-start" size={14} />
        </SelectChip>
      </Hint>
    </div>
  );
}
