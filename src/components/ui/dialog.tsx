"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "~/lib/utils";
import { dialogBackdropClass } from "~/components/ui/dialog-overlay";
import { Button } from "~/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 isolate",
        dialogBackdropClass(),
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  /** 给弹窗本体的额外 class（如形态按状态切换的宽度/边框）；与调用处传入的
   *  `className` 分开，是为了让「内容体」与「外层容器」各自可覆盖。 */
  popupClassName,
  children,
  /** 是否渲染内置的右上角关闭按钮（`absolute top-2 right-2`）。
   *
   *  **调用处只要自绘了关闭按钮，就必须传 `false`**：本仓库的弹窗形态约定
   *  是「自绘 header + 自绘关闭」，漏传会同时渲染出两枚位置几乎重合的关闭
   *  按钮 —— 点下去命中的是 DOM 靠后 + 绝对定位的内置那枚，两枚之间的间隙
   *  还成了「点了没反应」的死区，用户看到的就是「两个 ✕ 且关不掉」。
   *  默认 `true` 只服务「不自绘 header、直接用基元卡片」这一种形态。 */
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  /** 弹窗本体（Popup）自身的 class，便于调用处只改形态、不动外层定位。 */
  popupClassName?: string;
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      {/* 内容层不再自绘遮罩：遮罩由 base-ui 的 Backdrop 负责（打开时点遮罩
          即关闭），样式与实际渲染串在 dialog-overlay.ts 里收口一次 ——
          它同时要满足「让出标题行」的硬判据（ISSUE #310：遮罩曾整片盖住
          页签与右上角窗口按钮）。 */}
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          /* 默认卡片。宽度**只有一处下限**：`max-w-[calc(100%-2rem)]`（不贴满
             视口两侧），**不再在 sm 断点压到 `max-w-sm`**（ISSUE #720）。

             为什么要把 `sm:max-w-sm` 删掉：它是**带变体的** max-width，
             Tailwind 的产序把它排在所有无变体 utility 之后 —— 于是它不只压
             默认，连调用处传进来的宽度一起压。三个日志弹窗的「加宽」按钮因此
             长期是**按了没反应**：`popupClassName` 里的 `max-w-[96vw]` 比不过
             它，连换成 `w-6xl` 这种跨族写法也没用（实测 1430×900 视口下三种
             写法量到的都是同一个 384px = 24rem `max-w-sm`）。

             调用处现在只传 `w-*`（见 `~/components/ui/dialog-width`）：跟一条
             `max-w-*` 打架只会得到「谁赢看产序」的结果，跨族的 `width` 才有
             确定的结论，而这里的 `max-w-*` 继续只做「别贴满视口」的兜底 ——
             正是它该管的那件事。 */
          "bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-modal fixed top-1/2 left-1/2 grid max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-4 text-sm ring-1 duration-100 outline-none",
          /* `w-full` 由调用处决定：默认卡片仍要「占满到自己的上限」（与删掉
             `sm:max-w-sm` 之前一致），但 `w-full` 属无变体宽度，同样会被调用处
             的 `w-*` 覆盖掉。 */
          "w-full",
          popupClassName,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "bg-muted/50 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
