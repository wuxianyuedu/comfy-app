"use client";

/**
 * FullScreenDialog —— 全屏视图形态的弹窗原语（铺满标题行下方的内容区）。
 *
 * 与 `ui/dialog` 的 `DialogContent` 是同族但**形态不同**：后者是「居中卡片」
 * （`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`），而全屏视图要的是
 * 「让出窗口标题行、铺满其余内容区」。两者不能靠调用处覆盖拼出来：
 * `overlayClass("full", …)` 带的 `top-title-bar` 是本项目的自定义工具类，
 * class 合并器（`cn`）不认识它，于是默认的 `top-1/2` 与 `-translate-y-1/2`
 * 会**残留**下来（实测），把面板顶到标题行上方、底部还留一条缝。
 * 形态因此在基元这一层分家：定位只由 `overlayClass("full")` 给出，
 * 调用处只提供布局类（§17.2 第③层只渲染）。
 *
 * 行为沿用 base-ui 的 Dialog 原语：Esc 关闭、焦点锁在面板内、关闭后焦点归还，
 * 渲染走 Portal（因此不受调用方祖先的 `backdrop-filter` / `transform` 影响 ——
 * 它们会给 `position: fixed` 另建包含块，让面板缩进某个卡片里）。
 */

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "~/lib/utils";
import { overlayClass } from "~/lib/full-screen-layer";
import { dialogBackdropClass } from "~/components/ui/dialog-overlay";

export interface FullScreenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 无障碍名称：渲染成只读屏器可见的标题，并自动接到弹窗的 `aria-labelledby`。 */
  label: string;
  /** 面板内定位层的 z-index 工具类，须高于它要盖住的那层浮层（默认 `z-100`）。 */
  zClass?: string;
  /** 该视图自身的布局 class（`bg-bg` 之外的补充）。 */
  className?: string;
  children: ReactNode;
}

export function FullScreenDialog({
  open,
  onOpenChange,
  label,
  zClass = "z-100",
  className,
  children,
}: FullScreenDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* 遮罩与 `ui/dialog` 共用同一份 class（`dialog-overlay.ts`）：它同时
            满足「让出标题行」的硬判据，另写一份必然漂移。 */}
        <DialogPrimitive.Backdrop
          className={dialogBackdropClass("bg-black/40")}
        />
        <DialogPrimitive.Popup
          data-slot="fullscreen-dialog"
          className={cn(
            overlayClass(
              "full",
              `${zClass} text-ink flex flex-col outline-none`,
            ),
            "data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 duration-100",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {label}
          </DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
