import * as React from "react";
import { cn } from "~/lib/utils";
import { ChevronDownIcon } from "lucide-react";

/* 剔掉私有字段再透传：走仓库唯一出口（`~/lib/dom-props`），不在这里手写 `Omit<…>`
 * 剔除表（UI 基元门禁 P57）。 */
import type { OmitOwnProps } from "~/lib/dom-props";

type NativeSelectProps = OmitOwnProps<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default";
};

function NativeSelect({ className, size = "default", ...props }: NativeSelectProps) {
  return (
    <div
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-50",
        className,
      )}
      data-size={size}
      data-slot="native-select-wrapper"
    >
      <select
        className="border-input selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-8 w-full min-w-0 appearance-none rounded-lg border bg-transparent py-1 pr-8 pl-2.5 text-sm transition-colors outline-none select-none focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:ring-3 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:py-0.5"
        data-size={size}
        data-slot="native-select"
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 select-none"
        data-slot="native-select-icon"
      />
    </div>
  );
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<"option">) {
  return (
    <option
      /* option 弹层的底/字走主题令牌（与全局 `select option` 规则同源），
       * 不用 `Canvas`/`CanvasText` 系统色 —— 那两个色随 OS 的 color-scheme 解析，
       * 在 WebView2 上会脱离应用主题自行变脸（#3720 第 3 条的深灰底即这一族）。 */
      className={cn("bg-node text-ink-field", className)}
      data-slot="native-select-option"
      {...props}
    />
  );
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      className={cn("bg-node text-ink-field", className)}
      data-slot="native-select-optgroup"
      {...props}
    />
  );
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption };
