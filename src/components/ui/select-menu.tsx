"use client";

/**
 * SelectMenu —— 深色主题的下拉选择（替换原生 `<select>`）。
 *
 * 为什么不能直接用原生控件：Chromium / Windows 上原生 `<option>` 忽略
 * CSS `background-color`（它是 OS 级控件），深色主题里会闪出一块白底列表。
 *
 * 浮层走 `~/components/ui/popover`（规范 16 §16.2.3 P2）：此前这里自搓了
 * `createPortal` + 手写 fixed 定位 + 滚动重定位 + 手写 Esc / 外点关闭 +
 * z-index 魔数，与 `ui/popover` 是同一个能力的第二份实现。现在翻上翻下、
 * 收边、滚动重定位、Esc / 点外部关闭全部交给 base-ui 的 Positioner 与 Root，
 * 本组件只保留「下拉选择」这件事自己的语义。
 *
 * `labels` 是 `Record<string, ReactNode>`（不是 `string`），调用处才能在每行
 * 挂彩色圆点 /「本机」/「在线」徽标 —— `string` 本身是合法 ReactNode，因此
 * 这个签名向后兼容。
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

interface SelectMenuProps {
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

export function SelectMenu({
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
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  /* 用 ref 持有最新的 onOpenChange，effect deps 不依赖函数引用：
   * 调用方每次渲染传入的新箭头函数不会导致 effect 反复重建。 */
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  /* a11y：role="combobox" 必须能通过 aria-controls 指向它控制的 listbox，
   *  否则读屏软件无法把触发按钮与选项列表关联起来。useId 保证同一页面上
   *  多个 SelectMenu 实例不会撞 id。 */
  const listboxId = React.useId();

  const emitOpenChange = useCallback((next: boolean) => {
    onOpenChangeRef.current?.(next);
  }, []);

  /* Reset highlight when opening. */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const idx = options.indexOf(value);
      setHighlighted(idx >= 0 ? idx : -1);
    }
  }

  /* 打开后把高亮项滚进可视区。 */
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const idx = highlighted >= 0 ? highlighted : 0;
      const el = listRef.current?.children[idx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, highlighted]);

  const pick = useCallback(
    (v: string) => {
      onChange(v);
      setOpen(false);
      emitOpenChange(false);
    },
    [onChange, emitOpenChange],
  );

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

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          emitOpenChange(true);
          return;
        }
        setHighlighted((index) => Math.min(index + 1, options.length - 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted((index) => Math.max(index - 1, 0));
      }
      if (event.key === "Enter" && open && highlighted >= 0) {
        event.preventDefault();
        pick(options[highlighted]!);
      }
    },
    [open, options, highlighted, pick, emitOpenChange],
  );

  const label = value
    ? (labels?.[value] ??
      options.find((option) => option === value) ??
      placeholder)
    : placeholder;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        emitOpenChange(next);
      }}
    >
      <PopoverTrigger
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onKeyDown={handleKeyDown}
        className={`border-border bg-subtle text-ink-bright focus:border-primary-500/40 flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-[12px] transition-colors outline-none ${className}`}
      >
        {/* min-w-0 + flex-1 + truncate lets rich ReactNode labels clip
         *  cleanly; callers that want a right-aligned badge (e.g. "本机" /
         *  "在线") should place a `flex-1` spacer before the badge so it
         *  pushes right even under this `truncate` (nowrap) context. */}
        <span className="flex min-w-0 flex-1 items-center truncate">
          {label}
        </span>
        <svg
          className={`text-ink-muted ml-2 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={4}
        /* `min-w`/`w` 由调用处的 popoverMinWidth 与单选行文案共同决定；
           `p-1` 抵消基元默认的 `p-2.5`，保住选项行的边到边观感。 */
        className="border-border-strong bg-card gap-0 p-1 shadow-lg shadow-black/5 dark:shadow-black/40"
        style={{ width: `min(${effectiveMinWidth}px, 92vw)` }}
        role="presentation"
      >
        <ul
          id={listboxId}
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          className="max-h-60 overflow-y-auto outline-none"
        >
          {options.map((opt, i) => (
            <li
              key={opt}
              role="option"
              aria-selected={value === opt}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => pick(opt)}
              className={`flex cursor-pointer items-center gap-1.5 truncate rounded-sm px-2.5 py-1 text-[12px] transition-colors ${
                value === opt
                  ? "bg-primary-500/20 text-primary-strong font-medium"
                  : i === highlighted
                    ? "bg-surface-2 text-ink-bright"
                    : "text-ink-faint hover:bg-subtle hover:text-ink-bright"
              }`}
            >
              {labels?.[opt] ?? opt}
            </li>
          ))}
        </ul>
        {footer ? (
          <div className="border-border-strong mt-1 border-t pt-1">
            {footer}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
