"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Dark-themed custom <select> replacement.
 *
 * Native <select> dropdowns ignore CSS background-color on <option> in
 * Chromium/Windows (OS-level widget).  This component renders an identical
 * visual shell but drops a fully-styled dark popover for the option list.
 *
 * widened `labels` from `Record<string, string>` to
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
  /**
   * Minimum popover width, in px.  Defaults to 480 so richly-decorated rows
   * (dot + name + taskType + local/online badge) can breathe on narrow
   * trigger containers; the popover still snaps back to `trigger.width`
   * when the trigger is wider than this floor.  Capped to viewport with
   * automatic left-shift so it never overflows the right edge.
   *
   * when `autoFitFromOptions` is on, the *effective* minimum is
   * `max(popoverMinWidth, longestLabelChars × 8 + 56)` so long model file
   * names / workflowIO labels fit on narrow canvas nodes without each
   * caller tuning this prop.  Capped at 720 so a single absurd string
   * can't blow the popover off-screen.
   */
  popoverMinWidth?: number;
  /**
   * Auto-widen the popover to fit the longest option label.
   * Only string/number labels are measured — rich ReactNode labels (e.g.
   * badges, icons) are skipped because we can't measure them without
   * rendering off-screen.  Defaults to true.
   */
  autoFitFromOptions?: boolean;
  /**
   * Optional footer rendered at the bottom of the popover (outside the
   * scrollable option list) — used for group empty-state hints that must
   * stay visible regardless of how many options exist.
   */
  footer?: React.ReactNode;
  /**
   * Called when the popover opens/closes. The open state lives inside the
   * component; callers use this to lazily load options right as the list
   * becomes visible.
   */
  onOpenChange?: (open: boolean) => void;
}

export function DarkSelect({
  value,
  onChange,
  options,
  labels,
  placeholder = "选择…",
  disabled = false,
  className = "",
  popoverMinWidth = 480,
  autoFitFromOptions = true,
  footer,
  onOpenChange,
}: DarkSelectProps) {
  /* 用 ref 持有最新的 onOpenChange，effect deps 不依赖函数引用：
   * 调用方每次渲染传入的新箭头函数不会导致 effect 反复重建。 */
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  /** 归一化关闭回调：onOpenChange 未传时静默。 */
  const emitOpenChange = useCallback((next: boolean) => {
    onOpenChangeRef.current?.(next);
  }, []);
  /* a11y：role="combobox" 必须能通过 aria-controls 指向它控制的 listbox，
   *  否则读屏软件无法把触发按钮与选项列表关联起来。useId 保证同一页面上
   *  多个 DarkSelect 实例不会撞 id。 */
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [highlighted, setHighlighted] = useState(-1);
  /* footer 紧贴选项列表渲染：测量实际列表高度（选项不足时远小于 240），
   * 替代旧的固定 +240 偏移——那会在短列表与 footer 之间留出一大段空白。 */
  const footerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  useLayoutEffect(() => {
    if (!open) return;
    setListHeight(listRef.current?.offsetHeight ?? 0);
    setFooterHeight(footerRef.current?.offsetHeight ?? 0);
  }, [open, options, footer]);
  /* Popover position (fixed, in viewport coords). Computed from the trigger
   * button's bounding rect so the dropdown escapes any parent overflow. */
  const [pos, setPos] = useState<{ left: number; top: number; width: number; placement: "down" | "up" }>({
    left: 0,
    top: 0,
    width: 0,
    placement: "down",
  });

  /* Close on Escape / click outside.
   *  capture-phase + click 双重兜底
   *  诊断结论同样适用于 DarkSelect：组件挂在项目画布节点里，React
   *  Flow Pane 在 bubble 阶段会 stopPropagation，document 永远收不到
   *  mousedown → setOpen(false) 永远跑不到 → popover 卡住。capture
   *  阶段先于任何 stopPropagation 之前跑到 document。click 监听则
   *  防 Pane 的 onPaneClick 只在 click 阶段拦截（单独 mousedown 不够）。 */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") { setOpen(false); emitOpenChange(false); return; }
      if (e instanceof MouseEvent) {
        if (ref.current?.contains(e.target as Node) || listRef.current?.contains(e.target as Node)) return;
        setOpen(false);
        emitOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler, true);
    document.addEventListener("click", handler, true);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler, true);
      document.removeEventListener("click", handler, true);
      document.removeEventListener("keydown", handler);
    };
  }, [open, emitOpenChange]);

  /* Reset highlight when opening (adjusted during render, React 19 pattern) */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const idx = options.indexOf(value);
      setHighlighted(idx >= 0 ? idx : -1);
    }
  }
  /* Scroll highlighted into view after render */
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        const idx = highlighted >= 0 ? highlighted : 0;
        const el = listRef.current?.children[idx] as HTMLElement | undefined;
        el?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [open, highlighted]);

  /* Recompute popover position when opening / on viewport changes.
   * Auto-flips upward if the dropdown would overflow below the viewport.
   * popover width is `max(trigger.width, popoverMinWidth)`,
   * and the left edge is left-shifted if the wider popover would overflow
   * the right viewport edge.
   *
   * when `autoFitFromOptions` is on, the effective minimum is
   * widened to fit the longest *string* label so long model file names
   * don't get clipped on narrow canvas nodes.  Capped at 720. */
  const POPOVER_MAX_H = 240; // ~max-h-60 (6-7 items @ py-1.5)
  const VIEWPORT_MARGIN = 8;
  const POPOVER_AUTO_MAX = 720;
  const POPOVER_AUTO_HEADROOM = 56; // 24 px padding + ~32 px for dot / arrow
  const POPOVER_PER_CHAR_PX = 8; // ~8 px per text-sm (14px) glyph in Inter
  const POPOVER_AUTO_MIN = 160;
  const effectiveMinWidth = useMemo(() => {
    if (!autoFitFromOptions) return popoverMinWidth;
    let longest = 0;
    for (const opt of options) {
      const node = labels?.[opt];
      const text =
        typeof node === "string" || typeof node === "number"
          ? String(node)
          : opt;
      if (text.length > longest) longest = text.length;
    }
    const approx = longest * POPOVER_PER_CHAR_PX + POPOVER_AUTO_HEADROOM;
    const bounded = Math.max(POPOVER_AUTO_MIN, approx);
    const effective = Math.max(popoverMinWidth, bounded);
    return Math.min(POPOVER_AUTO_MAX, effective);
  }, [autoFitFromOptions, options, labels, popoverMinWidth]);
  useLayoutEffect(() => {
    if (!open) return;
    const recompute = () => {
      const btn = ref.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const desiredWidth = Math.max(rect.width, effectiveMinWidth);
      const maxAllowedWidth = Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2);
      const popoverWidth = Math.min(desiredWidth, maxAllowedWidth);
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - popoverWidth);
      }
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const place: "down" | "up" = spaceBelow >= POPOVER_MAX_H || spaceBelow >= rect.top ? "down" : "up";
      setPos({
        left,
        top: place === "down" ? rect.bottom + 4 : Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_MAX_H - 4),
        width: popoverWidth,
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
  }, [open, effectiveMinWidth]);

  const pick = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
      emitOpenChange(false);
    },
    [onChange, emitOpenChange],
  );

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((value) => !value); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((index) => Math.min(index + 1, options.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((index) => Math.max(index - 1, 0)); }
  }, [options.length]);

  const listKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && highlighted >= 0) { e.preventDefault(); pick(options[highlighted]!); }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((index) => Math.min(index + 1, options.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((index) => Math.max(index - 1, 0)); }
  }, [highlighted, options, pick]);

  const label = value ? (labels?.[value] ?? options.find((option) => option === value) ?? placeholder) : placeholder;

  return (
    <div className={`relative ${disabled ? "opacity-50" : ""}`}>
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          emitOpenChange(nextOpen);
        }}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center justify-between rounded-md border border-(--color-border) bg-(--color-subtle) px-2.5 py-1.5 text-[12px] text-(--color-ink-bright) outline-none transition-colors focus:border-violet-500/40 ${className}`}
      >
        {/* min-w-0 + flex-1 + truncate lets rich ReactNode labels clip
         *  cleanly; callers that want a right-aligned badge (e.g. "本机" /
         *  "在线") should place a `flex-1` spacer before the badge so it
         *  pushes right even under this `truncate` (nowrap) context. */}
        <span className="flex min-w-0 flex-1 items-center truncate">{label}</span>
        <svg className={`ml-2 shrink-0 text-(--color-ink-muted) transition-transform ${open ? "rotate-180" : ""}`} width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            id={listboxId}
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
            className="max-h-60 overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-card) py-1 shadow-lg shadow-black/40"
          >
            {options.map((opt, i) => (
              <li
                key={opt}
                role="option"
                aria-selected={value === opt}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => pick(opt)}
                className={`flex items-center gap-1.5 cursor-pointer truncate px-2.5 py-1 text-[12px] transition-colors ${
                  value === opt
                    ? "bg-violet-500/20 font-medium text-violet-600"
                    : i === highlighted
                      ? "bg-(--color-surface-2) text-(--color-ink-bright)"
                      : "text-(--color-ink-faint) hover:bg-(--color-subtle) hover:text-(--color-ink-bright)"
                }`}
              >
                {labels?.[opt] ?? opt}
              </li>
            ))}
          </ul>,
          document.body
        )}
      {open && footer &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={footerRef}
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.placement === "down"
                ? pos.top + Math.min(listHeight, POPOVER_MAX_H) + 4
                : pos.top - footerHeight - 4,
              width: pos.width,
              zIndex: 9999,
            }}
          >
            {footer}
          </div>,
          document.body
        )}
    </div>
  );
}
