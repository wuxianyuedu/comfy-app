"use client";
/* ui-customized: 覆盖前先看 docs/standards/16 §16.8（本文件在 shadcn 官方版之上有改动） */

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

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 isolate",
        dialogBackdropClass(),
        className,
      )}
      data-slot="dialog-overlay"
      {...props}
    />
  );
}

function DialogContent({
  className,
  /** 给弹窗本体的额外 class（如形态按状态切换的宽度/边框）；与调用处传入的
   *  `className` 分开，是为了让「内容体」与「外层容器」各自可覆盖。 */
  children,
  popupClassName,
  /** 是否渲染内置的右上角关闭按钮（`absolute top-2 right-2`）。
   *
   *  **调用处只要自绘了关闭按钮，就必须传 `false`**：本仓库的弹窗形态约定
   *  是「自绘 header + 自绘关闭」，漏传会同时渲染出两枚位置几乎重合的关闭
   *  按钮 —— 点下去命中的是 DOM 靠后 + 绝对定位的内置那枚，两枚之间的间隙
   *  还成了「点了没反应」的死区，用户看到的就是「两个 ✕ 且关不掉」。
   *  默认 `true` 只服务「不自绘 header、直接用基元卡片」这一种形态。 */
  showCloseButton = true,
  /** 是否渲染共享遮罩（`DialogOverlay` → base-ui 的 `Backdrop`）。
   *
   *  **默认 `true` 是本仓库的统一口径**：模态弹窗背后必须有一层**带色**的压暗底，
   *  否则「弹窗浮在一堆还能点、还一样亮的界面之上」——用户分不清哪块是活的、
   *  也看不出这是个需要先处理掉的对话框（ISSUE #1742）。这一层同时承担
   *  「点遮罩即关闭」与「遮住并挡住背后内容」两件事。
   *
   *  只有「本就要贴在宿主里、不该压暗背后」的极少数内嵌场景才传 `false`。 */
  showOverlay = true,
  /** 给共享遮罩的额外 class（如全屏视图那档更重的底）。 */
  overlayClassName,
  ...props
}: DialogPrimitive.Popup.Props & {
  overlayClassName?: string;
  /** 弹窗本体（Popup）自身的 class，便于调用处只改形态、不动外层定位。 */
  popupClassName?: string;
  showCloseButton?: boolean;
  showOverlay?: boolean;
}) {
  return (
    <DialogPortal>
      {/* 遮罩（带色压暗底 + 挡住背后点击）由本组件**默认渲染**：base-ui 的
          `Dialog.Backdrop` 是**独立的一层**，`DialogPortal` 只自动注入一层
          **无色的** `InternalBackdrop`（`role="presentation"`、仅用于外部点击
          判定与 `pointer-events` 兜底），肉眼看不见 —— 此前只有部分调用处
          （`ui/fullscreen-dialog`）自己补了 `Backdrop`，于是**绝大多数弹窗背后
          都是亮的、看起来还能点**（ISSUE #1742）。

          样式与「让出标题行」的硬判据（ISSUE #310）都收口在
          `~/components/ui/dialog-overlay` 的 `dialogBackdropClass()` 里，
          `ui/sheet` 的 `SheetContent` 共用同一份。 */}
      {showOverlay && <DialogOverlay className={overlayClassName} />}
      <DialogPrimitive.Popup
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
        data-slot="dialog-content"
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button className="absolute top-2 right-2" size="icon-sm" variant="ghost" />}
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
    <div className={cn("flex flex-col gap-2", className)} data-slot="dialog-header" {...props} />
  );
}

function DialogFooter({
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-muted/50 -mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t p-4 sm:flex-row sm:justify-end",
        className,
      )}
      data-slot="dialog-footer"
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("font-heading text-base leading-none font-medium", className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn(
        "text-muted-foreground *:[a]:hover:text-foreground text-sm *:[a]:underline *:[a]:underline-offset-3",
        className,
      )}
      data-slot="dialog-description"
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
