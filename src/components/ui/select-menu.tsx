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
import { onNextFrame } from "~/lib/next-frame";

interface SelectMenuProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** 选项值 → 显示文案的映射；缺省时回退到原始值。 */
  labels?: Record<string, React.ReactNode>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * 浮层最小宽度（px），默认 480 —— 装饰较丰富的行
   *（圆点 + 名称 + 任务类型 + 本机/在线徽标）在窄触发器里也能舒展；
   *  触发器本身比这个下限宽时，浮层仍会回落到 `trigger.width`。
   *  并按视口做上限裁剪 + 自动左移，保证不会溢出右边缘。
   *
   * 开启 `autoFitFromOptions` 时，**生效**的下限为
   * `max(popoverMinWidth, 最长标签字符数 × 8 + 56)`，好让较长的模型文件名 /
   * workflowIO 标签在窄画布节点里也放得下，不必每个调用处各调一遍；
   *  上限封顶 720，免得单个异常长的字符串把浮层顶出屏幕。
   */
  popoverMinWidth?: number;
  /**
   * 触发器取**固定宽度**（铺满容器）而不是「随内容自适应」。
   *
   * 缺省是自适应：触发器宽度由标签撑开、外层容器多宽都不管 —— 并排的
   * 一排筛选控件要的就是这个（宽度一致会让短文案两侧空一块，不一致又
   * 会在窄窗口里被压）。需要「一个下拉独占一行」时传 `true`。
   */
  fullWidth?: boolean;
  /**
   * 自动加宽浮层以容纳最长的选项标签。
   *  只测量字符串 / 数字标签 —— 富 ReactNode 标签（如徽标、图标）会被跳过，
   *  因为不渲染到屏幕外就无法测量它的宽度。默认 true。
   */
  autoFitFromOptions?: boolean;
  /**
   * 可选页脚，渲染在浮层底部（可滚动的选项列表之外）——
   *  用于分组空态提示：无论有多少选项，它都必须始终可见。
   */
  footer?: React.ReactNode;
  /**
   * 浮层打开 / 关闭时调用。打开状态由组件自身持有；
   *  调用方借此在列表即将可见时惰性加载选项。
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
  fullWidth = false,
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

  /* 打开时重置高亮项。 */
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
    return onNextFrame(() => {
      const idx = highlighted >= 0 ? highlighted : 0;
      const el = listRef.current?.children[idx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    });
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
        /* 基础样式里**没有** `w-full`：默认宽度由调用处决定（`w-full` 用在
         *  需要铺满容器的地方，`w-auto` 用在并排的一排控件里）。基础样式里带
         *  `w-full` 时，调用处的 `w-auto` **覆盖不掉**它 —— 两个同属性 utility
         *  同时出现时按 Tailwind 的输出顺序决胜，而 `w-full` 与 `w-auto` 同属
         *  宽度族、顺序不受调用处控制，结果是「写了 `w-auto` 但一排放不下、
         *  每个都铺满整行」（工作流库页头的三个筛选下拉就撞上了这一条）。 */
        className={`border-border bg-subtle text-ink-bright focus:border-primary-500/40 flex items-center justify-between gap-x-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors outline-none ${fullWidth ? "w-full" : "w-auto"} ${className}`}
      >
        {/* min-w-0 + flex-1 + truncate 让富 ReactNode 标签能干净地裁剪；
         *  想让徽标（如「本机」/「在线」）右对齐的调用方，应在徽标前放一个
         *  `flex-1` 占位，这样在 `truncate`（nowrap）上下文里它才会被推向右侧。 */}
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
