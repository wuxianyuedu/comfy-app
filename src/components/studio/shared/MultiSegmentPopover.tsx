"use client";
/* 统一的多段浮层下拉 —— 从 GroupedControls.tsx 抽出。 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Z } from "~/lib/shell/overlay-z";

/* ─────────────────────────────────────────────────────────────────────────
 * 改版：用一个统一的多段浮层下拉
 * 替换此前「两个独立 DarkSelect」的预设 UI。触发器把当前选择
 * 收成一颗摘要章
 *（如 `16:9 / 2K`），点它打开一个面板，每个
 * 参数一行 —— 比例（图标行，单选）、清晰度（分段，单选）、
 * 质量（分段，单选，可选）。每行内部是
 * 单选，但整个下拉让用户在一处就能从 N 个段里挑 —— 故名
 * 「多选浮层」。
 *
 * 点击外部关闭用 mousedown 监听实现，监听
 * 排除包裹 ref，这样浮层不会和父级
 * 表单自己的点击处理器打架。
 * ───────────────────────────────────────────────────────────────────────── */

/** 视觉上镜像宽高比的小矩形。 */
export function RatioIcon({
  ratio,
  className = "",
}: {
  ratio: number;
  className?: string;
}) {
  const MAX = 18;
  const width = ratio >= 1 ? MAX : Math.max(4, Math.round(MAX * ratio));
  const height = ratio >= 1 ? Math.max(4, Math.round(MAX / ratio)) : MAX;
  return (
    <span
      aria-hidden
      className={`inline-block rounded-[2px] border-[1.5px] border-current ${className}`}
      style={{ width: `${width}px`, height: `${height}px` }}
    />
  );
}

/** Strip a "16:9 横屏" → "16:9" short label for compact triggers and chips. */
export function shortRatioLabel(label: string): string {
  return label.split(/\s+/)[0] ?? label;
}

/** 多段浮层里的一个段。 */
export interface SegmentSection<T extends string = string> {
  /** 段头标签（大写，如「比例」）。 */
  label: string;
  /** 当前选中的选项值（必须是 `options.value` 之一）。 */
  value: T;
  /** 这个段的可选项。 */
  options: {
    value: T;
    label: string;
    render?: React.ReactNode;
    /** 可选的子分组标签。两个选项
     *  带不同 `subgroup` 字符串时，该段把它们渲染在
     *  分开的行里，中间夹一个小号大写标签。没有
     *  subgroup 的选项默认归入一行无标签行。 */
    subgroup?: string;
  }[];
  /** 用户在本段里选了别的选项时调用。 */
  onChange: (value: T) => void;
}

function MultiSegmentPopoverInner({
  triggerContent,
  sections,
  align = "left",
  ariaLabel,
  footer,
  disabled,
}: {
  triggerContent: React.ReactNode;
  sections: SegmentSection<string>[];
  align?: "left" | "right";
  ariaLabel?: string;
  /** 宿主表单禁用时置灰 + 阻止打开。 */
  disabled?: boolean;
  /** 可选插槽，渲染在浮层卡片内
   *  各段下方。用于百万像素对齐倍数
   *  步进器（一个连续数值控件，套不进
   *  `SegmentSection` 的形状）。保持通用，好让日后用例（如
   *  视频码率 / 帧率覆盖）复用同一套管线。 */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  /* portal + fixed 定位：面板可能出现在 overflow 容器里（IO 预览面板、
   *  滚动表单），absolute 定位会被裁掉。挂在 body 上按触发器 rect 摆位，
   *  触发器下方空间不足时自动翻到上方。 */
  const [pos, setPos] = useState({ left: 0, top: 0, width: 280 });

  const reposition = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const width = Math.max(280, Math.min(rect.width, 420));
    const margin = 8;
    let left = align === "right" ? rect.right - width : rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - width));
    const popHeight = popRef.current?.offsetHeight ?? 420;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above =
      spaceBelow < Math.min(420, popHeight + 12) && rect.top > spaceBelow;
    const top = above
      ? Math.max(margin, rect.top - popHeight - 6)
      : Math.min(window.innerHeight - margin - popHeight, rect.bottom + 6);
    setPos({ left, top, width });
  }, [align]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapRef.current &&
        !wrapRef.current.contains(target) &&
        popRef.current &&
        !popRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    /* 节点失去焦点（Tab 离开、画布切到另一节点）时也要收起下拉，单靠
     *  mousedown 不够：React Flow 画布可能吞掉点击事件，而键盘导航会触发
     *  focus 移动但不会触发 mousedown。 */
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Node;
      const inWrap = wrapRef.current?.contains(target);
      const inPop = popRef.current?.contains(target);
      if (!inWrap && !inPop) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("focusin", onFocusIn);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  const handleToggle = () => {
    if (disabled) return;
    setOpen((open) => !open);
  };

  /* 打开后测量实际高度再校正一次位置（above 分支依赖真实高度）。 */
  useEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={handleToggle}
        className={`nodrag nopan border-primary/35 bg-canvas-deep text-ink-bright focus:border-primary/70 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[12px] transition-colors outline-none ${
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-primary/70"
        }`}
      >
        <span className="flex-1 truncate">{triggerContent}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`text-ink-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M2 4l3 3 3-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              width: pos.width,
              maxHeight: "min(60vh, 460px)",
              overflowY: "auto",
              zIndex: Z.overlay,
            }}
            className="bg-panel/95 ring-border-strong rounded-xl p-3 shadow-2xl ring-1 shadow-black/10 backdrop-blur-md dark:shadow-black/50"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {sections.map((section, i) => (
              <Section
                key={section.label + ":" + (section.value ?? "")}
                section={section}
                first={i === 0}
              />
            ))}
            {footer ? (
              <div className="border-border-strong mt-3 border-t pt-3">
                {footer}
              </div>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* 把内层段渲染器拆出来，好让
 *  （可能较重的）子分组归组只在其输入
 *  真的变了时才重跑。此前内联的 `.map` 会在 CreatePanel 每次
 *  按键时重建 Map 与数组，叠加 `onChange` 回调重建后
 *  让切换预设摸起来发涩。 */
const Section = React.memo(function Section({
  section,
  first,
}: {
  section: SegmentSection<string>;
  first: boolean;
}) {
  const grouped = useMemo(() => {
    const hasSubgroups = section.options.some((option) => option.subgroup);
    if (!hasSubgroups) {
      return [{ key: "_", label: undefined, options: section.options }];
    }
    const order: string[] = [];
    const map = new Map<
      string,
      { key: string; label?: string; options: typeof section.options }
    >();
    for (const option of section.options) {
      const key = option.subgroup ?? "_";
      if (!map.has(key)) {
        order.push(key);
        map.set(key, {
          key: key,
          label: option.subgroup,
          options: [] as typeof section.options,
        });
      }
      map.get(key)!.options.push(option);
    }
    return order.map((key) => map.get(key)!);
  }, [section]);

  const onPick = useCallback(
    (value: string) => section.onChange(value),
    [section],
  );

  return (
    <div className={first ? "" : "mt-3"}>
      <div className="text-ink-muted mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
        {section.label}
      </div>
      {grouped.map((group, gi) => (
        <div key={group.key} className={gi > 0 ? "mt-2" : ""}>
          {group.label && (
            <div className="text-ink-icon mb-1 text-[9px] tracking-wider uppercase">
              {group.label}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {group.options.map((opt) => {
              const selected = opt.value === section.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onPick(opt.value)}
                  className={`nodrag nopan flex min-w-[52px] flex-col items-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] transition-colors ${
                    selected
                      ? "bg-primary/20 text-ink-bright ring-primary/55 ring-1"
                      : "text-ink-muted hover:bg-subtle hover:text-ink-bright"
                  }`}
                >
                  {opt.render}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});

/* 浮层以前会在父级每次重渲染时
 *  重建，即使它的 `sections` 数组引用没变。
 *  用 React.memo 包起来，点选路径就不再为
 *  每次 CreatePanel 重渲染重建全部 6 个段按钮付代价。 */
export const MultiSegmentPopover = React.memo(MultiSegmentPopoverInner);
