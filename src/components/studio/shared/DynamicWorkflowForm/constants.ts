import type { ControlKind } from "../workflow-io";

/** v2 (2026-08-14) Aligned with Ardot 3:40 PortRow1:
 *  - bg #0F0F14 (深于卡片 #16161C)
 *  - rounded-[6px]  +  no border
 *  - 11pt Inter Regular, color #C9C9D6
 *  - p-2.5 (10px) on all sides
 *  - leading-relaxed (16-17px line-height for 11pt)
 *  - resize-none — 稿是固定 52h，不该出现 webkit resize 把手
 *  - placeholder #5A5A6B */
export const inputCls =
  "nodrag nopan w-full resize-none rounded-md bg-(--color-canvas-deep) p-2.5 text-[11px] leading-relaxed text-(--color-ink-soft) outline-none transition-colors placeholder:text-(--color-ink-placeholder) focus:ring-1 focus:ring-(--color-primary)/40";

/** Colour accent per control kind — mirrors the canvas port palette. */
export const ACCENT: Record<ControlKind, string> = {
  image: "#5BE3C4",
  textarea: "#FF9C5B",
  text: "#FF9C5B",
  select: "#8B7CFC",
  switch: "#67E89D",
  int: "#B584FF",
  float: "#FFD571",
  link: "#5BC6FF",
};
