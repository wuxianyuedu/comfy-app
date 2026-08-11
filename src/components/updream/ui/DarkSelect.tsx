import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Dark-themed custom <select> replacement.
 *
 * Native <select> dropdowns ignore CSS background-color on <option> in
 * Chromium/Windows (OS-level widget).  This component renders an identical
 * visual shell but drops a fully-styled dark popover for the option list.
 *
 * 2026-08-11 (R55): widened `labels` from `Record<string, string>` to
 * `Record<string, ReactNode>` so callers can decorate each row with
 * coloured dots / "本机" / "在线" badges etc.  Backward-compatible —
 * `string` is a valid ReactNode.
 */
interface DarkSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Map from option value → display label. Falls back to raw value if omitted. */
  labels?: Record<string, React.ReactNode>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DarkSelect({
  value,
  onChange,
  options,
  labels,
  placeholder = "选择…",
  disabled = false,
  className = "",
}: DarkSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [highlighted, setHighlighted] = useState(-1);
  /* Popover position (fixed, in viewport coords). Computed from the trigger
   * button's bounding rect so the dropdown escapes any parent overflow. */
  const [pos, setPos] = useState<{ left: number; top: number; width: number; placement: "down" | "up" }>({
    left: 0,
    top: 0,
    width: 0,
    placement: "down",
  });

  /* Close on Escape / click outside */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") { setOpen(false); return; }
      if (e instanceof MouseEvent) {
        if (ref.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node)) return;
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("keydown", handler); };
  }, [open]);

  /* Reset highlight when opening */
  useEffect(() => {
    if (open) {
      const idx = options.indexOf(value);
      setHighlighted(idx >= 0 ? idx : -1);
      /* Scroll highlighted into view after render */
      requestAnimationFrame(() => {
        const el = listRef.current?.children[idx >= 0 ? idx : 0] as HTMLElement | undefined;
        el?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Recompute popover position when opening / on viewport changes.
   * Auto-flips upward if the dropdown would overflow below the viewport. */
  useLayoutEffect(() => {
    if (!open) return;
    const recompute = () => {
      const btn = ref.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const POPOVER_MAX_H = 240; // ~max-h-60 (6-7 items @ py-1.5)
      const MARGIN = 8;
      const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
      const place: "down" | "up" = spaceBelow >= POPOVER_MAX_H || spaceBelow >= rect.top ? "down" : "up";
      setPos({
        left: rect.left,
        top: place === "down" ? rect.bottom + 4 : rect.top - POPOVER_MAX_H - 4,
        width: rect.width,
        placement: place,
      });
    };
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  const pick = useCallback((v: string) => { onChange(v); setOpen(false); }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, options.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
  }, [options.length]);

  const listKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && highlighted >= 0) { e.preventDefault(); pick(options[highlighted]); }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, options.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
  }, [highlighted, options, pick]);

  const label = value ? (labels?.[value] ?? options.find((o) => o === value) ?? placeholder) : placeholder;

  return (
    <div className={`relative ${disabled ? "opacity-50" : ""}`}>
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-violet-500/40 ${className}`}
      >
        {/* R55: min-w-0 + flex-1 lets rich ReactNode labels (e.g. with
         *  an ml-auto badge) take all remaining space and clip cleanly. */}
        <span className="flex min-w-0 flex-1 items-center truncate">{label}</span>
        <svg className={`ml-2 shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            onKeyDown={listKeyDown}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              zIndex: 9999,
            }}
            className="max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[#16161C] py-1 shadow-lg shadow-black/40"
          >
            {options.map((opt, i) => (
              <li
                key={opt}
                role="option"
                aria-selected={value === opt}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => pick(opt)}
                className={`flex items-center gap-1.5 cursor-pointer truncate px-3 py-1.5 text-sm transition-colors ${
                  value === opt
                    ? "bg-violet-500/20 font-medium text-violet-200"
                    : i === highlighted
                      ? "bg-white/[0.06] text-gray-200"
                      : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-200"
                }`}
              >
                {labels?.[opt] ?? opt}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
