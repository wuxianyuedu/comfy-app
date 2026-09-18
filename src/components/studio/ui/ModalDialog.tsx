"use client";

/**
 * ModalDialog — centered confirmation dialog that follows the app theme.
 *
 * Replaces `window.confirm()` / `window.alert()` so prompts match the
 * app's visual system instead of showing the native browser chrome
 * (which sits awkwardly in the top-left / center of the viewport
 * and ignores dark CSS).
 *
 * 实现基于 `~/components/ui/dialog`（规范 16 §16.2.3 P2）：此前这里自搓了一套
 * `createPortal` + 手写 Esc + 手写遮罩点击关闭，于是同一件「模态对话框」在库里
 * 有 `ui/dialog`（零引用）与它两份实现 —— 焦点陷阱、Esc 语义、焦点归还这些
 * 无障碍行为只在一边有。现在动作语义交给 base-ui Dialog 原语（Esc / 点遮罩关闭、
 * 焦点锁在弹窗内、关闭后焦点归还触发元素），本组件只负责「确认弹窗」的形态。
 *
 * Visual language matches the global design tokens (Light / Dark 两态):
 *   - backdrop:  bg-canvas-deep (Light) / bg-black/65 (Dark) + backdrop-blur-sm
 *   - card:      bg-panel/95 + 中性 ring(浅色深 ring、深色浅 ring)
 *                + border-destructive/30 (danger) /
 *                border-primary-500/25 (info)
 *
 * 颜色全部走语义 token（规范 03 §3.6.2）：这里曾把 `violet-500/600` 写死
 * 6 处，于是「改品牌色」对确认弹窗不起作用 —— 它绕开了 `--color-primary`。
 *   - spacing:   p-6, gap-4, rounded-2xl
 *   - buttons:   ghost secondary + brand/danger primary
 *
 * Behavior:
 *   - Click backdrop or press Esc → onClose()
 *   - Confirm button is auto-focused so Enter fires it immediately
 *   - Disabled confirm stays disabled until re-enabled (handy for async)
 *   - `pending` prop puts the confirm button into a spinner state
 */

import React, { useEffect, useId, useRef } from "react";
import { Info, LoaderCircle, TriangleAlert } from "lucide-react";

import { Dialog, DialogContent } from "~/components/ui/dialog";
import { overlayClass } from "~/lib/full-screen-layer";

export interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  /** Short headline. */
  title: string;
  /** Optional descriptive text (supports newlines). */
  description?: React.ReactNode;
  /** Confirm button label. */
  confirmLabel?: string;
  /** Cancel button label. */
  cancelLabel?: string;
  /** Toggles the destructive red-button variant. */
  danger?: boolean;
  /** When true, the confirm button is disabled. Useful for async ops. */
  pending?: boolean;
  /** Fired when the user confirms. */
  onConfirm: () => void;
  /**
   * Optional small icon displayed next to the title. Defaults to a glyph
   * matching the `danger` variant; pass a node to override.
   */
  icon?: React.ReactNode;
}

const ICON_WARN = <TriangleAlert size={22} strokeWidth={1.8} />;

const ICON_INFO = <Info size={22} strokeWidth={1.8} />;

export function ModalDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  pending = false,
  onConfirm,
  icon,
}: ModalDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Unique id per instance — a static "modal-dialog-title" would collide
  // when multiple dialogs mount at once, breaking aria-labelledby wiring.
  const titleId = useId();

  // Auto-focus confirm so Enter fires it immediately, matching native
  // confirm() muscle memory.  Reset on every open.
  useEffect(() => {
    if (open) {
      // Wait one frame so the portal-mounted node exists.
      const id = requestAnimationFrame(() => confirmRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const accentIcon = icon ?? (danger ? ICON_WARN : ICON_INFO);
  const ringClass = danger
    ? "border-destructive/30 ring-destructive/10 shadow-lg shadow-black/5 dark:shadow-black/5 dark:shadow-destructive/20"
    : "border-primary-500/25 ring-primary-500/10 shadow-lg shadow-black/5 dark:shadow-black/5 dark:shadow-none";
  const iconColor = danger ? "text-destructive" : "text-primary-strong";
  const confirmClass = danger
    ? "bg-destructive/90 hover:bg-destructive focus-visible:ring-destructive/60 text-white shadow-sm"
    : "bg-primary-500/90 hover:bg-primary-500 focus-visible:ring-primary-500/60 text-white shadow-sm";
  const cancelClass =
    "bg-subtle hover:bg-surface-2 focus-visible:ring-foreground/20 text-ink-strong";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-labelledby={titleId}
        showCloseButton={false}
        className={overlayClass("modal", "p-0")}
        /* 外观仍由本组件决定（弹窗形态是产品语言，不是 shadcn 默认卡片）：
           遮罩自定义在内容层上，base-ui 弹窗本体只作「居中 + 无障碍」的容器。 */
        data-testid="modal-dialog"
      >
        <div
          className={`bg-panel/95 relative w-full max-w-[420px] overflow-hidden rounded-2xl border p-6 ring-1 backdrop-blur-md ${ringClass}`}
        >
          {/* Soft accent wash — sets the mood without dominating */}
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 top-0 h-24 ${
              danger
                ? "from-destructive/10 via-destructive/0 bg-linear-to-b"
                : "from-primary-500/10 via-primary-500/0 bg-linear-to-b"
            }`}
          />

          <div className="relative flex items-start gap-3">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                danger ? "bg-destructive/10" : "bg-primary-500/10"
              } ${iconColor}`}
            >
              {accentIcon}
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-ink text-[15px] leading-tight font-semibold"
              >
                {title}
              </h2>
              {description && (
                <div className="text-ink-faint mt-1.5 text-[13px] leading-relaxed whitespace-pre-line">
                  {description}
                </div>
              )}
            </div>
          </div>

          <div className="relative mt-6 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className={`rounded-lg px-4 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:opacity-50 ${cancelClass}`}
            >
              {cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-70 ${confirmClass}`}
            >
              {pending && (
                <LoaderCircle
                  size={14}
                  strokeWidth={2.5}
                  className="animate-spin"
                />
              )}
              {confirmLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
