"use client";
/* ui-customized: 覆盖前先看 docs/standards/16 §16.8（本文件在 shadcn 官方版之上有改动） */

import * as React from "react";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { VariantProps } from "class-variance-authority";
import { cn } from "~/lib/utils";

import { toggleVariants } from "~/components/ui/toggle";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    orientation?: "horizontal" | "vertical";
    spacing?: number;
  }
>({
  size: "default",
  variant: "default",
  spacing: 2,
  orientation: "horizontal",
});

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = "horizontal",
  children,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    orientation?: "horizontal" | "vertical";
    spacing?: number;
  }) {
  return (
    <ToggleGroupPrimitive
      className={cn(
        "group/toggle-group flex w-fit flex-row items-center gap-[--spacing(var(--gap))] rounded-lg data-vertical:flex-col data-vertical:items-stretch data-[size=sm]:rounded-[min(var(--radius-md),10px)]",
        className,
      )}
      data-orientation={orientation}
      data-size={size}
      data-slot="toggle-group"
      data-spacing={spacing}
      data-variant={variant}
      /* SAFETY: 类型断言已复核 */
      style={
        {
          "--gap": spacing,
        } as React.CSSProperties
      }
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing, orientation }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      className={cn(
        /* 选中档在本基元补足「描边 + 字重 + 抬层」，而不只靠底色：`toggleVariants()` 的悬停档与
         * 选中档同值（`hover:bg-muted` / `data-pressed:bg-muted`），鼠标划过未选中项会长得和
         * 「当前选中」一样 —— 分段控件里等于没有选中态。补的 box-shadow / font-weight 基元不在
         * pressed 上设，不与悬停撞；`z-10` 给描边用（spacing=0 时相邻 item 会盖住右/下侧）。底色
         * 仍留给调用方叠（日志级别那排还要叠主色淡底：#609 `bg-surface-1` 与 `--color-subtle` 同值）。 */
        "data-pressed:ring-primary/45 shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-end]:pr-1.5 group-data-[spacing=0]/toggle-group:has-data-[icon=inline-start]:pl-1.5 data-pressed:z-10 data-pressed:font-semibold data-pressed:ring-1 group-data-horizontal/toggle-group:data-[spacing=0]:first:rounded-l-lg group-data-vertical/toggle-group:data-[spacing=0]:first:rounded-t-lg group-data-horizontal/toggle-group:data-[spacing=0]:last:rounded-r-lg group-data-vertical/toggle-group:data-[spacing=0]:last:rounded-b-lg group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:border-l-0 group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:border-t-0 group-data-horizontal/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-l group-data-vertical/toggle-group:data-[spacing=0]:data-[variant=outline]:first:border-t",
        toggleVariants({
          variant: context.variant ?? variant,
          size: context.size ?? size,
        }),
        className,
      )}
      data-size={context.size ?? size}
      data-slot="toggle-group-item"
      data-spacing={context.spacing}
      data-variant={context.variant ?? variant}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
