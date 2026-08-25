"use client";

/**
 * ModalDialog — centered, dark-themed confirmation dialog.
 *
 * Replaces `window.confirm()` / `window.alert()` so prompts match the
 * app's dark-aurora visual system instead of showing the native browser
 * chrome (which sits awkwardly in the top-left / center of the viewport
 * and ignores dark CSS).
 *
 * Visual language matches the global design tokens:
 *   - backdrop:  bg-black/65 + backdrop-blur-sm
 *   - card:      bg-[#1b1b22]/95, ring-1 ring-white/[0.06]
 *                + border border-violet-500/20 (info) /
 *                border-red-500/30 + glow (danger variant)
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

const ICON_WARN = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ICON_INFO = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

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
    ? "border-red-500/30 ring-red-500/10 shadow-lg shadow-red-950/20"
    : "border-violet-500/20 ring-violet-500/10";
  const iconColor = danger ? "text-red-400" : "text-violet-400";
  const confirmClass = danger
    ? "bg-red-500/90 hover:bg-red-500 focus-visible:ring-red-400/60 text-white shadow-sm shadow-red-950/40"
    : "bg-violet-500/90 hover:bg-violet-500 focus-visible:ring-violet-400/60 text-white shadow-sm shadow-violet-950/40";
  const cancelClass =
    "bg-white/[0.04] hover:bg-white/[0.08] focus-visible:ring-white/30 text-gray-300";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm"
    >
      <div
        onClick={stop}
        className={`relative w-full max-w-[420px] overflow-hidden rounded-2xl border bg-[#1b1b22]/95 p-6 ring-1 backdrop-blur-md ${ringClass}`}
      >
        {/* Soft accent wash — sets the mood without dominating */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 top-0 h-24 ${
            danger
              ? "bg-gradient-to-b from-red-500/10 via-red-500/0"
              : "bg-gradient-to-b from-violet-500/10 via-violet-500/0"
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
              className="text-[15px] font-semibold leading-tight text-gray-100"
            >
              {title}
            </h2>
            {description && (
              <div className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-gray-400">
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
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="animate-spin"
                aria-hidden
              >
                <path d="M21 12a9 9 0 1 1-6.22-8.56" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
