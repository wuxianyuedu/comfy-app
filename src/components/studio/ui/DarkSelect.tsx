"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Z } from "~/lib/shell/overlay-z";

/**
 * 深色主题的自定义 <select> 替代品。
 *
 * 原生 <select> 下拉在 Chromium/Windows 上会忽略 <option> 的 CSS
 * background-color（那是 OS 级控件）。本组件渲染一模一样
 * 的视觉外壳，但为选项列表弹出一个完全自绘的深色浮层。
 *
 * 把 `labels` 从 `Record<string, string>` 放宽到
 * `Record<string, ReactNode>`，好让调用方给每行点缀
 * 彩色圆点 /「本机」/「在线」徽标等。向后兼容 ——
 * `string` 本身就是合法的 ReactNode。
 */
interface DarkSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** 选项值 → 显示标签的映射。省略时回落到原始值。 */
  labels?: Record<string, React.ReactNode>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * 浮层最小宽度，单位 px。默认 480，好让装饰丰富的行
   *（圆点 + 名字 + taskType + 本机/在线 徽标）在窄的
   * 触发器容器上也能舒展；触发器比这个下限更宽时，浮层仍
   * 回落到 `trigger.width`。以视口封顶并
   * 自动左移，永不溢出右边缘。
   *
   * `autoFitFromOptions` 打开时，**有效**最小值是
   * `max(popoverMinWidth, longestLabelChars × 8 + 56)`，好让长模型文件
   * 名 / workflowIO 标签在窄画布节点上也放得下，无需每个
   * 调用方各自调这个 prop。以 720 封顶，单个荒唐的长字符串
   * 也不会把浮层顶出屏幕。
   */
  popoverMinWidth?: number;
  /**
   * 自动加宽浮层以放下最长的选项标签。
   * 只测量字符串 / 数字标签 —— 富 ReactNode 标签（例如
   * 徽标、图标）跳过，因为不渲染到屏幕外就量不出来。默认 true。
   *
   */
  autoFitFromOptions?: boolean;
  /**
   * 可选底栏，渲染在浮层底部（在可滚动
   * 选项列表之外）—— 用于分组空态提示，它必须
   * 无论有多少选项都保持可见。
   */
  footer?: React.ReactNode;
  /**
   * 浮层开 / 关时调用。开合状态住在组件内部；
   * 调用方用它来在列表即将可见时懒加载选项。
   *
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
  /* 浮层位置（fixed，视口坐标）。由触发器按钮的
   * bounding rect 算出，好让下拉逃出任何父级溢出裁剪。 */
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    placement: "down" | "up";
  }>({
    left: 0,
    top: 0,
    width: 0,
    placement: "down",
  });

  /* Escape / 点击外部时关闭。
   *  capture-phase + click 双重兜底
   *  诊断结论同样适用于 DarkSelect：组件挂在项目画布节点里，React
   *  Flow Pane 在 bubble 阶段会 stopPropagation，document 永远收不到
   *  mousedown → setOpen(false) 永远跑不到 → popover 卡住。capture
   *  阶段先于任何 stopPropagation 之前跑到 document。click 监听则
   *  防 Pane 的 onPaneClick 只在 click 阶段拦截（单独 mousedown 不够）。 */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") {
        setOpen(false);
        emitOpenChange(false);
        return;
      }
      if (e instanceof MouseEvent) {
        if (
          ref.current?.contains(e.target as Node) ||
          listRef.current?.contains(e.target as Node)
        )
          return;
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

  /* 打开时重置高亮（渲染期间调整，React 19 模式） */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      const idx = options.indexOf(value);
      setHighlighted(idx >= 0 ? idx : -1);
    }
  }
  /* 渲染后把高亮项滚进视野 */
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        const idx = highlighted >= 0 ? highlighted : 0;
        const el = listRef.current?.children[idx] as HTMLElement | undefined;
        el?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [open, highlighted]);

  /* 打开时 / 视口变化时重算浮层位置。
   * 若下拉会在视口下方溢出则自动向上翻转。
   * 浮层宽度是 `max(trigger.width, popoverMinWidth)`，
   * 且更宽的浮层会溢出右侧视口边缘时
   * 左边缘会左移。
   *
   * `autoFitFromOptions` 打开时，有效最小值
   * 加宽到放下最长的**字符串**标签，长模型文件名
   * 不会在窄画布节点上被裁掉。以 720 封顶。 */
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
      const maxAllowedWidth = Math.max(
        0,
        window.innerWidth - VIEWPORT_MARGIN * 2,
      );
      const popoverWidth = Math.min(desiredWidth, maxAllowedWidth);
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(
          VIEWPORT_MARGIN,
          window.innerWidth - VIEWPORT_MARGIN - popoverWidth,
        );
      }
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const place: "down" | "up" =
        spaceBelow >= POPOVER_MAX_H || spaceBelow >= rect.top ? "down" : "up";
      setPos({
        left,
        top:
          place === "down"
            ? rect.bottom + 4
            : Math.max(VIEWPORT_MARGIN, rect.top - POPOVER_MAX_H - 4),
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((index) => Math.min(index + 1, options.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((index) => Math.max(index - 1, 0));
      }
    },
    [options.length],
  );

  const listKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && highlighted >= 0) {
        e.preventDefault();
        pick(options[highlighted]!);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((index) => Math.min(index + 1, options.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((index) => Math.max(index - 1, 0));
      }
    },
    [highlighted, options, pick],
  );

  const label = value
    ? (labels?.[value] ??
      options.find((option) => option === value) ??
      placeholder)
    : placeholder;

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
        className={`border-border bg-subtle text-ink-bright flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-[12px] transition-colors outline-none focus:border-violet-500/40 ${className}`}
      >
        {/* min-w-0 + flex-1 + truncate 让富 ReactNode 标签裁切
         *  干净；想要右对齐徽标（如「本机」/
         *  「在线」）的调用方应在徽标前放一个 `flex-1` 占位，好在
         *  这个 `truncate`（nowrap）上下文下也向右顶。 */}
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
              zIndex: Z.overlay,
            }}
            className="border-border-strong bg-card max-h-60 overflow-y-auto rounded-lg border py-1 shadow-lg shadow-black/5 dark:shadow-black/40"
          >
            {options.map((opt, i) => (
              <li
                key={opt}
                role="option"
                aria-selected={value === opt}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => pick(opt)}
                className={`flex cursor-pointer items-center gap-1.5 truncate px-2.5 py-1 text-[12px] transition-colors ${
                  value === opt
                    ? "bg-violet-500/20 font-medium text-violet-700 dark:text-violet-300"
                    : i === highlighted
                      ? "bg-surface-2 text-ink-bright"
                      : "text-ink-faint hover:bg-subtle hover:text-ink-bright"
                }`}
              >
                {labels?.[opt] ?? opt}
              </li>
            ))}
          </ul>,
          document.body,
        )}
      {open &&
        footer &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={footerRef}
            style={{
              position: "fixed",
              left: pos.left,
              top:
                pos.placement === "down"
                  ? pos.top + Math.min(listHeight, POPOVER_MAX_H) + 4
                  : pos.top - footerHeight - 4,
              width: pos.width,
              zIndex: Z.overlay,
            }}
          >
            {footer}
          </div>,
          document.body,
        )}
    </div>
  );
}
