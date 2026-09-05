"use client";
/* Unified multi-section popover dropdown — extracted from GroupedControls.tsx. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ─────────────────────────────────────────────────────────────────────────
 * redesign: a unified multi-section popover dropdown
 * replaces the previous "two separate DarkSelects" preset UI.  The trigger
 * collapses the current selection into a single summary chip
 * (e.g. `16:9 / 2K`) and clicking it opens a panel with one row per
 * parameter — 比例 (icon row, single-select), 清晰度 (segmented, single-
 * select), 质量 (segmented, single-select, optional).  Each row is
 * single-select within itself but the dropdown as a whole lets the user
 * pick from N sections in one place — hence "multi-select popover".
 *
 * Click-outside-to-close is wired with a mousedown listener that
 * excludes the wrapper ref, so the popover doesn't fight the parent
 * form's own click handlers.
 * ───────────────────────────────────────────────────────────────────────── */

/** Small rectangle that visually mirrors a width/height ratio. */
export function RatioIcon({ ratio, className = "" }: { ratio: number; className?: string }) {
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

/** One section inside the multi-segment popover. */
export interface SegmentSection<T extends string = string> {
  /** Section header label (uppercase, e.g. "比例"). */
  label: string;
  /** Currently-selected option value (must match one of `options.value`). */
  value: T;
  /** Available choices for this section. */
  options: {
    value: T;
    label: string;
    render?: React.ReactNode;
    /** optional sub-group label. When two options
     *  carry different `subgroup` strings, the section renders them in
     *  separate rows with a small uppercase label between.  Options without
     *  a subgroup default to a single unlabeled row. */
    subgroup?: string;
  }[];
  /** Called when the user picks a different option in this section. */
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
  /** grey out + block opening while the owning form is disabled. */
  disabled?: boolean;
  /** optional slot rendered below the sections
   *  inside the popover card.  Used for the megapixel alignment-multiple
   *  stepper (a continuous number control that doesn't fit the
   *  `SegmentSection` shape).  Kept generic so future use-cases (e.g.
   *  video bitrate / fps override) can ride the same plumbing. */
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
    const above = spaceBelow < Math.min(420, popHeight + 12) && rect.top > spaceBelow;
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
        className={`nodrag nopan flex w-full items-center gap-2 rounded-lg border border-(--color-primary)/35 bg-(--color-canvas-deep) px-3 py-2 text-left text-[12px] text-(--color-ink-bright) outline-none transition-colors focus:border-(--color-primary)/70 ${
          disabled ? "cursor-not-allowed opacity-50" : "hover:border-(--color-primary)/70"
        }`}
      >
        <span className="flex-1 truncate">{triggerContent}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`shrink-0 text-(--color-ink-muted) transition-transform ${open ? "rotate-180" : ""}`}
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
              zIndex: 9999,
            }}
            className="rounded-xl bg-[#14141C]/95 p-3 shadow-2xl shadow-black/50 ring-1 ring-white/8 backdrop-blur-md"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {sections.map((section, i) => (
              <Section key={section.label + ":" + (section.value ?? "")} section={section} first={i === 0} />
            ))}
            {footer ? <div className="mt-3 border-t border-white/6 pt-3">{footer}</div> : null}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* split the inner section renderer out so the
 *  (potentially heavy) subgroup grouping only re-runs when its input
 *  actually changes.  The previous inline `.map` rebuilt the Map and
 *  array on every keystroke in CreatePanel, which combined with the
 *  `onChange` callback recreations made switching presets feel sticky. */
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
    const map = new Map<string, { key: string; label?: string; options: typeof section.options }>();
    for (const option of section.options) {
      const key = option.subgroup ?? "_";
      if (!map.has(key)) {
        order.push(key);
        map.set(key, { key: key, label: option.subgroup, options: [] as typeof section.options });
      }
      map.get(key)!.options.push(option);
    }
    return order.map((key) => map.get(key)!);
  }, [section]);

  const onPick = useCallback(
    (value: string) => section.onChange(value),
    [section]
  );

  return (
    <div className={first ? "" : "mt-3"}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-(--color-ink-muted)">
        {section.label}
      </div>
      {grouped.map((group, gi) => (
        <div key={group.key} className={gi > 0 ? "mt-2" : ""}>
          {group.label && (
            <div className="mb-1 text-[9px] uppercase tracking-wider text-(--color-ink-icon)">
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
                      ? "bg-(--color-primary)/20 text-(--color-ink-bright) ring-1 ring-(--color-primary)/55"
                      : "text-(--color-ink-muted) hover:bg-white/6 hover:text-(--color-ink-bright)"
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

/* the popover used to be rebuilt on every parent
 *  re-render even when its `sections` array was referentially the same.
 *  Wrap in React.memo so the click-to-select path no longer pays the cost
 *  of recreating all 6 segment buttons on each CreatePanel re-render. */
export const MultiSegmentPopover = React.memo(MultiSegmentPopoverInner);
