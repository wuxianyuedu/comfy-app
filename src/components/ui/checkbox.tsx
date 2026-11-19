"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "~/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        /* 未选中态的描边走 **ink 的 alpha 档**（ISSUE #3519）：此前是
         * `border-input`（= `--color-border`），而控件的描边只有 1px —— 在
         * 1.5 倍屏上它与卡片底**互相混色**（实测深色下混成 1.09:1、浅色下
         * 1.02:1），未选中的勾选框等于不存在（用户现场：「勾选框在浅色下也看不清」）。
         * ink/50（浅）/ ink/40（深）对卡片是 3.3:1 / 3.5:1 —— WCAG 1.4.11
         * 对「控件的视觉边界」要的就是 3:1。
         * 勾选态另走品牌色（`data-checked:border-primary`），不受这一档影响。 */
        "peer border-ink/50 dark:border-ink/40 group-has-focus-visible/field-label:not-data-checked:border-ink/50 dark:group-has-focus-visible/field-label:not-data-checked:border-ink/40 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-focus-visible/field-label:data-checked:border-primary dark:data-checked:bg-primary dark:data-unchecked:border-ink/40 dark:data-unchecked:bg-ink/5 relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors outline-none group-has-focus-visible/field-label:ring-0 group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3",
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
        data-slot="checkbox-indicator"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
