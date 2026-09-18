"use client";

/* 多段式下拉面板（比例 / 像素 / 倍数… 一组参数一次选完）。
 *
 * 触发按钮把当前选择折成一行摘要（如 `16:9 / 2K`），点开后面板里每个参数
 * 各占一行：比例（图标行，单选）、清晰度（分段，单选）、质量（分段，单选，
 * 可选）。行内各自单选，整面板允许多段并排展示 —— 故名「multi-segment」。
 *
 * 浮层走 `~/components/ui/popover`（规范 16 §16.2.3 P2）：此前这里自搓了
 * `createPortal` + fixed 定位 + 上下翻转 + 滚动重定位 + 手写 mousedown /
 * focusin 关闭 + z-index 魔数。定位、翻转、收边、外点关闭交给 base-ui 的
 * Positioner 与 Root 之后，本组件只留「多段面板」这件事自己的渲染。
 *
 * 触发按钮与选项行都是 `ui/button` 的 `<Button>`（同 §16.2.4.2 第 1 条：
 * `PopoverTrigger` 用 `render` 把按钮本体交给基元，base-ui 会把 `aria-*`
 * 与委托事件原样透传）。
 */

import React, { useMemo } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

/** Small rectangle that visually mirrors a width/height ratio. */
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

export function MultiSegmentPopover({
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
  return (
    <Popover>
      <PopoverTrigger
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            /* h-auto 覆盖基元写死的 h-8；`hover:bg-*` 交给基元的 ghost，
               其余边框 / 底色沿用本控件原来的形态。 */
            className="nodrag nopan border-primary/35 bg-canvas-deep text-ink-bright hover:bg-canvas-deep hover:border-primary/70 focus-visible:border-primary/70 h-auto w-full justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[12px]"
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">{triggerContent}</span>
        <ChevronDown size={10} className="text-ink-muted shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        role="listbox"
        align={align === "right" ? "end" : "start"}
        sideOffset={6}
        /* 面板自身滚动：段数与选项数都不固定，给高度封顶。
           `p-3` 是该面板原来的内距，`gap-0` 抵消基元默认的 `gap-2.5`。 */
        className="bg-panel/95 ring-border-strong max-h-[min(60vh,460px)] w-[min(92vw,360px)] gap-0 overflow-y-auto rounded-xl p-3 shadow-2xl ring-1 shadow-black/10 backdrop-blur-md dark:shadow-black/50"
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
      </PopoverContent>
    </Popover>
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
                <Button
                  key={String(opt.value)}
                  variant="ghost"
                  role="option"
                  aria-selected={selected}
                  onClick={() => section.onChange(opt.value)}
                  className={`nodrag nopan min-w-[52px] flex-col gap-1 rounded-md px-1.5 py-1.5 text-[11px] ${
                    selected
                      ? "bg-primary/20 text-ink-bright hover:bg-primary/20 ring-primary/55 ring-1"
                      : "text-ink-muted hover:bg-subtle hover:text-ink-bright"
                  }`}
                >
                  {opt.render}
                  <span>{opt.label}</span>
                </Button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
});
