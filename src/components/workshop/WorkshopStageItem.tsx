"use client";

// 一个阶段在导航里长什么样 —— 横向阶段条与竖向阶段轨道**共用**这一件：
// 布局方向相反，但判据同一份（徽章三态、小字来源、选中态），复制一份就会各漂各的。
// 宽度不在这里定：规范 03 §3.8.1.1 基元不预设 `w-full`/`flex-1`，由调用处布局给。

import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";
import { cn } from "~/lib/utils";

export type WorkshopStageItemProps = {
  /** 占位方式由调用处决定（见文件头）。 */
  className?: string;
  /** 是否当前所在段（决定 `aria-current` 与选中配色）。 */
  isCurrent: boolean;
  /** 阶段名（「剧本」「角色卡」…）。 */
  label: string;
  onSelect: () => void;
  /** 序号（1 起）；未完成时直接显示在徽章里。 */
  ordinal: number;
  /** 该段完成度（0~1）。≥1 即换成勾。 */
  ratio: number;
  /** 完成度小字，由 `stageSubtitle` 算好传入 —— 本件不重复判进度。 */
  subtitle: string;
};

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
      aria-current={isCurrent ? "step" : undefined}
      className={cn(
        "flex h-auto items-center gap-3 rounded-xl px-4 py-3 font-normal",
        isCurrent
          ? "bg-primary/12 ring-primary/25 hover:bg-primary/12 ring-1"
          : "bg-surface hover:bg-surface",
        className,
      )}
      onClick={onSelect}
      variant="ghost"
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
        <div className={cn("text-[13.5px] font-semibold", isCurrent ? "text-primary" : "text-ink")}>
          {label}
        </div>
        <div className={cn("text-2xs", done ? "text-success-strong" : "text-muted-foreground")}>
          {subtitle}
        </div>
      </div>
    </Button>
  );
}
