"use client";
/* ui-customized: 覆盖前先看 docs/standards/16 §16.8（本文件在 shadcn 官方版之上有改动） */

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "~/lib/utils";
import { useOverlayBoundary } from "~/components/ui/use-overlay-boundary";

function TooltipProvider({
  /* 300ms 是「悬停提示」的节奏档：贴近原生 `title=` 的出现速度，避免鼠标划过
   * 密集工具条时一串浮层连弹（`hint.tsx` 的调用点大半在工具条上）。
   * Base UI 自己给 trigger 的默认值是 600，这里显式定档、不靠默认值漂移。 */
  delay = 300,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/* 提示气泡与窗口边缘之间保留的安全边距（px）。
 *
 * 基元默认只留 5px —— 于是在右上角 / 右下角这类贴边控件上，气泡的右边缘
 * 会**紧贴窗口边**（实测右边缘落在 1435/1440）：窗口边框与内阴影正好压住
 * 最后那几个像素，长文案读起来像「被屏幕裁掉了」。这不是定位算错
 *（Base UI 的 `shift` 确实把它夹回来了），而是**夹得太靠边**。
 *
 * 12 是「气泡圆角 + `px-3` 内边距」的自然读数：再小会让圆角弧线贴着窗口边，
 * 再大则窄窗下气泡被无谓地推离锚点。 */
const TOOLTIP_COLLISION_PADDING = 12;

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  collisionPadding = TOOLTIP_COLLISION_PADDING,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionPadding"
  >) {
  /* 可用区域由「视口减去应用级标题行」得来（壳态才有标题行）—— 见
   * `useOverlayBoundary` 的说明。首帧量不到视口时返回 `null`，此时**不传**
   * 这一档，退回基元默认的 `clipping-ancestors`（而不是拿假矩形摆位）。 */
  const boundary = useOverlayBoundary();
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        collisionBoundary={boundary ?? undefined}
        className="z-popup isolate"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "bg-foreground text-background data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-popup inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md px-3 py-1.5 text-xs wrap-break-word has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-popup size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
