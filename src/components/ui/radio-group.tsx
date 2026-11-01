"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "~/lib/utils";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      className={cn("grid w-full gap-2", className)}
      data-slot="radio-group"
      {...props}
    />
  );
}

function RadioGroupItem({ className, children, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      className={cn(
        "group/radio-group-item peer border-input group-has-focus-visible/field-label:not-data-checked:border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-focus-visible/field-label:data-checked:border-primary dark:data-checked:bg-primary relative flex aspect-square size-4 shrink-0 rounded-full border outline-none group-has-focus-visible/field-label:ring-0 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3",
        className,
      )}
      data-slot="radio-group-item"
      {...props}
    >
      <RadioPrimitive.Indicator
        className="flex size-4 items-center justify-center"
        data-slot="radio-group-indicator"
      >
        <span className="bg-primary-foreground absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      </RadioPrimitive.Indicator>
      {/* 调用方给的内容（选项文字、图标行）**必须显式渲染**：它是
          `props.children`，而上面的 indicator 是同一位置的 JSX children ——
          JSX children 会整个盖掉 `props.children`。表现是 radio 还在、
          可访问名为空、选项文字全不见（`getByRole("radio", { name: … })`
          一条也匹配不到），而 `role` / `aria-checked` 照旧正确、单测全绿。 */}
      {children}
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
