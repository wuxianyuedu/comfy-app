"use client";
/* ui-customized: 覆盖前先看 docs/standards/16 §16.8（本文件在 shadcn 官方版之上有改动） */

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "~/lib/utils";

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  /** 锚点元素 / 虚拟锚点 / `{ getBoundingClientRect }` 形状的函数。
   *  默认锚点是 `<PopoverTrigger>`；没有 trigger（浮层由外部状态打开、
   *  触发元素住在别处）时由调用方传它 —— 例如节点 JSON 浮层，触发者是画布
   *  节点里的 `#id` 芯片，而浮层由 store 打开（ISSUE #717）。
   *  翻转 / 收边（`flip` / `shift`）由 base-ui 的 Positioner 自带，调用方
   *  不必自己夹紧视口。 */
  anchor,
  /** 与视口边缘保持的最小距离（翻转 / 收边的边界）。 */
  collisionPadding,
  sticky,
  /** 定位层（Positioner）的额外 class —— 需要改侧边偏移 / 层级时用。 */
  positionerClassName,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    | "align"
    | "alignOffset"
    | "side"
    | "sideOffset"
    | "anchor"
    | "collisionPadding"
    | "sticky"
  > & {
    positionerClassName?: string;
  }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        collisionPadding={collisionPadding}
        sticky={sticky}
        className={cn("z-popup isolate", positionerClassName)}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "border-border-strong bg-popover text-popover-foreground data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-popup flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg border p-2.5 text-sm shadow-lg ring-1 shadow-black/5 ring-(--ring-shadow) outline-hidden duration-100 dark:shadow-black/40",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  );
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
};
