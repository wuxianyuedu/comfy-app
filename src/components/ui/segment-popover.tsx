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
 * 触发按钮是 `ui/button` 的 `<Button>`（同 §16.2.4.2 第 1 条：
 * `PopoverTrigger` 用 `render` 把按钮本体交给基元，base-ui 会把 `aria-*`
 * 与委托事件原样透传）。
 *
 * ## 段内选项是 `ui/toggle-group`（P67 系列尾单 · §12.18 中间地带）
 *
 * 每一段（Section）内部原本是「手写 `<Button variant="ghost"
 * role="option" aria-selected={selected} onClick={...}>` 循环」——
 * 与 `~/components/ui/toggle-group` 是同一件事的第二份实现：单选分段
 * 控件的「按状态上 `data-pressed`、点已在项不改动、点新项切换、
 * 键盘 ←/→ 与 Home/End 在段内游走」全部由 base-ui ToggleGroup 提供。
 * 本件把每段换成一个 `<ToggleGroup value={[section.value]} multiple={false}>`
 * 包住该段的所有子分组行（子分组之间共享一个 `section.value`、跨子分组
 * 互斥；这正是 ToggleGroup 的 React Context 语义），每行选项换成
 * `<ToggleGroupItem value={opt.value}>`。触发 Popover 保持。
 *
 * 顺带去掉旧 PopoverTrigger 的 `aria-haspopup="listbox"` 与
 * PopoverContent 的 `role="listbox"`：面板里已经是**分段单选组**、
 * 不再是 listbox；让 base-ui Popover 自己给 `aria-haspopup="dialog"` +
 * `aria-expanded`。
 *
 * `opt.render` 是任意 ReactNode（比例图标 / 清晰度小徽标），`children`
 * 通道原生支持。选中态用 `data-[pressed]:` 属性选择器 + tailwind-merge
 * 表达：`bg-primary/20 text-ink-bright ring-primary/55` 与旧三元一致。
 */

import React, { useMemo } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "~/components/ui/button";
import { getOrCreate, getOrThrow } from "~/lib/collections";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";

/** 用小矩形直观呈现宽高比。 */
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

/** 把 "16:9 横屏" 裁成 "16:9" 短标签，供紧凑触发器与 chip 使用。 */
export function shortRatioLabel(label: string): string {
  return label.split(/\s+/)[0] ?? label;
}

/** 多段式面板里的一个分组。 */
export interface SegmentSection<T extends string = string> {
  /** 分组标题（大写展示，如「比例」）。 */
  label: string;
  /** 当前选中的选项值（必须是 `options.value` 之一）。 */
  value: T;
  /** 本分组的可选项。 */
  options: {
    value: T;
    label: string;
    render?: React.ReactNode;
    /** 可选的子分组标签。当两个选项带着不同的 `subgroup` 字符串时，
     *  分组会把它们渲染到不同行，并在行间插一条小号大写标签；
     *  不带子分组的选项默认落在同一行、不加标签。 */
    subgroup?: string;
  }[];
  /** 用户在本分组中改选其他选项时调用。 */
  onChange: (value: T) => void;
  /** 可选：渲染在本分组**所有子分组之后**的自由控件。
   *
   *  给「不是从几个选项里挑一个、而是直接给一个值」的连续量控件留的位置
   *  （百万像素步进器：档位之外还要能填 2.5）。它属于这个分组（挨着它的选项
   *  渲染），但形状不是 `options`，所以不走 `options`。 */
  extra?: React.ReactNode;
}

/** 段内 ToggleGroup 的排布：跨子分组共享一个 `value`（互斥），
 *  每个子分组仍是「flex flex-wrap 横排、子分组间纵向堆叠」。
 *  ToggleGroup 默认 `flex w-fit flex-row items-center gap-[var(--gap)]`
 *  与我们的多行子分组不匹配——用 `flex-col items-stretch gap-0`
 *  顶掉、由内层 subgroup div 各自管横排与间距。 */
const SECTION_GROUP_CLASS = "flex w-full flex-col items-stretch gap-2";

/** ToggleGroupItem 的视觉档，与旧 `<Button variant="ghost" role="option">`
 *  循环里的两态**逐字对齐**：`min-w-[52px] flex-col gap-1 rounded-md
 *  px-1.5 py-1.5 text-[11px]`；未选 `text-ink-muted hover:bg-subtle
 *  hover:text-ink-bright`；已选 `bg-primary/20 text-ink-bright
 *  ring-primary/55`。base-ui Toggle 的选中态属性是 **`data-pressed`**
 *  （Radix 时代的 `data-[state=on]` 在 base-ui 上永不匹配、会让选中高亮整体
 *  消失，见 `@base-ui/react/toggle` 的 `ToggleDataAttributes`），由它取代旧
 *  的 `selected` 布尔类拼接。 */
const ITEM_CLASS =
  "nodrag nopan h-auto min-w-[52px] flex-col gap-1 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-[11px] font-normal text-ink-muted hover:bg-subtle hover:text-ink-bright data-[pressed]:bg-primary/20 data-[pressed]:text-ink-bright data-[pressed]:ring-1 data-[pressed]:ring-primary/55 data-[pressed]:hover:bg-primary/20";

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
  /** 所属表单禁用时，置灰并阻止打开。 */
  disabled?: boolean;
  /** 可选插槽，渲染在浮层卡片里各分组的下方。
   *  用于百万像素「对齐倍数」步进器（一种连续数值控件，不符合
   *  `SegmentSection` 的形状）。刻意保持通用，好让后续场景
   * （如视频码率 / 帧率覆盖）复用同一套管线。 */
  footer?: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={ariaLabel}
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

/* 把内部的分组渲染器拆出来，让（可能较重的）子分组归并只在输入真正变化时重跑。
 *  此前的内联 `.map` 会在 CreatePanel 每敲一次键时重建 Map 与数组；
 *  叠加 `onChange` 回调每次重建，切换预设会感到发黏。 */
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
      getOrCreate(map, key, () => {
        order.push(key);
        return {
          key,
          label: option.subgroup,
          options: [] as typeof section.options,
        };
      }).options.push(option);
    }
    return order.map((key) => getOrThrow(map, key, "子组桶缺失"));
  }, [section]);

  return (
    <div className={first ? "" : "mt-3"}>
      <div className="text-ink-muted mb-1.5 text-[10px] font-semibold tracking-wider uppercase">
        {section.label}
      </div>
      {/* 整段共享一个 ToggleGroup(单选,`multiple={false}`);跨子分组互斥
          由 base-ui 的 React Context 天然处理,不需要每 subgroup 各自持
          state。value 走数组是 base-ui ToggleGroup 的固定形状(单选也用
          长度 1 的数组);onValueChange 拿最新点击项(section.value 之外的
          那一个)回传给 onChange。multiple={false} 时数组长度恒 ≤1,
          `vals[0]` 就是唯一/最新值。 */}
      <ToggleGroup
        value={[section.value]}
        multiple={false}
        onValueChange={(vals) => {
          const next = vals[0];
          if (typeof next === "string" && next !== section.value) {
            section.onChange(next);
          }
        }}
        className={SECTION_GROUP_CLASS}
      >
        {grouped.map((group, gi) => (
          <div key={group.key} className={gi > 0 ? "mt-2" : ""}>
            {group.label && (
              <div className="text-ink-icon mb-1 text-[9px] tracking-wider uppercase">
                {group.label}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {group.options.map((opt) => (
                <ToggleGroupItem
                  key={String(opt.value)}
                  value={String(opt.value)}
                  className={ITEM_CLASS}
                >
                  {opt.render}
                  <span>{opt.label}</span>
                </ToggleGroupItem>
              ))}
            </div>
          </div>
        ))}
      </ToggleGroup>
      {section.extra ? <div className="mt-2">{section.extra}</div> : null}
    </div>
  );
});
