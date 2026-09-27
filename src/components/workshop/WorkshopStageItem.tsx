"use client";

// 一个阶段在导航里长什么样 —— 横向阶段条与竖向阶段轨道**共用**这一件。
//
// 为什么要单独出来：一处是「六段横排在顶部」，一处是「六段竖排在左侧」，两者的
// 布局方向相反，但每个条目要回答的是同一组判据 —— 完成度徽章三态（完成换勾、
// 当前段品牌色、未开始是序号）、小字说明取哪句、选中态的底色与环。复制一份的话，
// 这三条判据就会各漂各的（徽章在完成段显示勾还是数字，两处可以长得不一样）。
//
// 宽度不在这里定：按规范 03 §3.8.1.1，基元不预设 `w-full`/`flex-1` 这类占位方式，
// 由调用处的布局给（横排传 `flex-1`，竖排传 `w-full`）。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { cn } from "~/lib/utils";

export interface WorkshopStageItemProps {
  /** 阶段名（「剧本」「角色卡」…）。 */
  label: string;
  /** 完成度小字，由 `stageSubtitle` 算好传入 —— 本件不重复判进度。 */
  subtitle: string;
  /** 序号（1 起）；未完成时直接显示在徽章里。 */
  ordinal: number;
  /** 该段完成度（0~1）。≥1 即换成勾。 */
  ratio: number;
  /** 是否当前所在段（决定 `aria-current` 与选中配色）。 */
  isCurrent: boolean;
  onSelect: () => void;
  /** 占位方式由调用处决定（见文件头）。 */
  className?: string;
}

export function WorkshopStageItem({
  label,
  subtitle,
  ordinal,
  ratio,
  isCurrent,
  onSelect,
  className,
}: WorkshopStageItemProps) {
  const done = ratio >= 1;
  return (
    <Button
      variant="ghost"
      onClick={onSelect}
      aria-current={isCurrent ? "step" : undefined}
      className={cn(
        "flex h-auto items-center gap-3 rounded-xl px-4 py-3 font-normal",
        isCurrent
          ? "bg-primary/12 ring-primary/25 hover:bg-primary/12 ring-1"
          : "bg-surface hover:bg-surface",
        className,
      )}
    >
      {/* 等宽高只写一个出处（size-9），不再 h-9 + w-9 凑 */}
      <span
        className={cn(
          "grid size-9 place-items-center rounded-[11px] text-[15px] font-bold",
          done
            ? "bg-success/80 text-white"
            : isCurrent
              ? "bg-primary text-white"
              : "bg-elevated text-muted-foreground",
        )}
      >
        {done ? <Icon name="check" size={14} /> : ordinal}
      </span>
      <div className="leading-tight">
        <div
          className={cn(
            "text-[13.5px] font-semibold",
            isCurrent ? "text-primary" : "text-ink",
          )}
        >
          {label}
        </div>
        <div
          className={cn(
            "text-[11px]",
            done ? "text-success-strong" : "text-muted-foreground",
          )}
        >
          {subtitle}
        </div>
      </div>
    </Button>
  );
}
