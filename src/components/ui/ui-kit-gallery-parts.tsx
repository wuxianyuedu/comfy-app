"use client";

import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { SectionLabel } from "~/components/ui/section-label";

/**
 * 控件总览页（`/ui-kit`，ISSUE #3525）的演示脚手架。
 *
 * 这页的目的只有一个：把全部基元摆到同一屏上，让「控件颜色 / 背景色错档」在
 * 明暗两态下都能一眼看出来（错档最典型的形态是控件底色与承载面互相混色）。
 * 所以演示面统一落两层：页面底 `bg-bg` 与卡片面 `bg-card` —— 基元在这两层上
 * 都该有可辨认的边界；token 墙再单独把两态的取值并排摆出来。
 * 逐 prop 的形态矩阵不在这页的量程里（那是 Storybook 的活）。
 */

/** 一个分组：段级标题 + 一句「这组看什么」+ 演示面（卡片面）。 */
export function GallerySection({
  title,
  note,
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  /** 这组的观察要点，一句话；没有就传 undefined，不渲染。 */
  note?: string;
  title: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-0.5">
        <SectionLabel>{title}</SectionLabel>
        {note ? <p className="text-ink-muted text-xs">{note}</p> : null}
      </div>
      <div className="bg-card border-border rounded-xl border p-4">{children}</div>
    </section>
  );
}

/** 一小格演示：等宽记号标签写「这是哪个基元 / 哪一态」，下面摆控件本体。 */
export function GalleryCell({
  label,
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-ink-faint text-2xs font-mono">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** 一排演示格：窄屏换行，各格按内容取宽。 */
export function GalleryGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] items-start gap-x-6 gap-y-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
