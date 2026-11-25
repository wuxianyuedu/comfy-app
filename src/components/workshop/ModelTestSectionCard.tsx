"use client";

// ── 测试模型页的卡片外壳（§12.18：≥2 处消费 → 抽成一份）───────────────
// 标题行（图标 + 名称 + 右侧弱化说明 / 动作）+ 内容。ModelTestView 的各分区
// 与「队列」页的左树面板（QueueMonitorView）共用这一个壳，排版不再各写一份。

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

export function SectionCard({
  actions,
  children,
  className,
  hint,
  icon,
  title,
}: {
  /** 标题行右侧的动作区（按钮 / 计数）。给了 hint 时排在 hint 之后。 */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  hint?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-primary-strong [&_svg]:size-3.5">{icon}</span>
        <span className="text-sm font-semibold">{title}</span>
        {hint !== undefined && hint !== "" && (
          <span className="text-2xs text-muted-foreground ml-auto font-normal">{hint}</span>
        )}
        {actions !== undefined && (
          <span className={cn("flex items-center gap-2", hint === undefined && "ml-auto")}>
            {actions}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
