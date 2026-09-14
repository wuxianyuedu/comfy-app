"use client";

/**
 * ModalDialog — centered confirmation dialog that follows the app theme.
 *
 * Replaces `window.confirm()` / `window.alert()` so prompts match the
 * app's visual system instead of showing the native browser chrome
 * (which sits awkwardly in the top-left / center of the viewport
 * and ignores dark CSS).
 *
 * Visual language matches the global design tokens (Light / Dark 两态):
 *   - backdrop:  bg-canvas-deep (Light) / bg-black/65 (Dark) + backdrop-blur-sm
 *   - card:      bg-panel/95 + 中性 ring(浅色深 ring、深色浅 ring)
 *                + border border-red-500/30 (danger) /
 *                border-violet-500/25 (info)
 *   - spacing:   p-6, gap-4, rounded-2xl
 *   - buttons:   ghost secondary + brand/danger primary
 *
 * Behavior:
 *   - Click backdrop or press Esc → onClose()
 *   - Confirm button is auto-focused so Enter fires it immediately
 *   - Disabled confirm stays disabled until re-enabled (handy for async)
 *   - Portal: document.body so the dialog escapes any transformed ancestor
 *   - `pending` prop puts the confirm button into a spinner state
 */

import React, { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Info, LoaderCircle, TriangleAlert } from "lucide-react";
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

  // Esc closes; nothing else needs keyboard handling.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // Auto-focus confirm so Enter fires it immediately, matching native
  // confirm() muscle memory.  Reset on every open.
  useEffect(() => {
    if (open) {
      // Wait one frame so the portal-mounted node exists.
      const id = requestAnimationFrame(() => confirmRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const accentIcon = icon ?? (danger ? ICON_WARN : ICON_INFO);
  const ringClass = danger
    ? "border-red-500/30 ring-red-500/10 shadow-lg shadow-black/5 dark:shadow-black/5 dark:shadow-red-950/20"
    : "border-violet-500/25 ring-violet-500/10 shadow-lg shadow-black/5 dark:shadow-black/5 dark:shadow-none";
  const iconColor = danger
    ? "text-red-600 dark:text-red-400"
    : "text-violet-600 dark:text-violet-400";
  const confirmClass = danger
    ? "bg-red-500/90 hover:bg-red-500 focus-visible:ring-red-400/60 text-white shadow-sm shadow-red-950/40"
    : "bg-violet-500/90 hover:bg-violet-500 focus-visible:ring-violet-400/60 text-white shadow-sm shadow-violet-950/40";
  const cancelClass =
    "bg-subtle hover:bg-surface-2 focus-visible:ring-foreground/20 text-ink-strong";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className={overlayClass("modal", "z-200 flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm dark:bg-black/65")}
    >
      <div
        onClick={stop}
        className={`bg-panel/95 relative w-full max-w-[420px] overflow-hidden rounded-2xl border p-6 ring-1 backdrop-blur-md ${ringClass}`}
      >
        {/* Soft accent wash — sets the mood without dominating */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 top-0 h-24 ${
            danger
              ? "bg-linear-to-b from-red-500/10 via-red-500/0"
              : "bg-linear-to-b from-violet-500/10 via-violet-500/0"
          }`}
        />

        <div className="relative flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              danger ? "bg-red-500/10" : "bg-violet-500/10"
            } ${iconColor}`}
          >
            {accentIcon}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-ink text-[15px] font-semibold leading-tight"
            >
              {title}
            </h2>
            {description && (
              <div className="text-ink-faint mt-1.5 whitespace-pre-line text-[13px] leading-relaxed">
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
    </div>,
    document.body
  );
}
