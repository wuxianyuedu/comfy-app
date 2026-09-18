import type { ControlKind } from "../workflow-io";

/** 输入框基础样式。取值来自设计稿规格：底色比卡片更深（#0F0F14 vs 卡片
 *  #16161C）、6px 圆角无描边、11pt 正文、四边 10px 内边距、relaxed 行高。
 *  `resize-none` 是刻意的：设计稿为固定高度，出现 webkit 缩放把手会破坏
 *  紧凑节点的行高对齐。 */
export const inputCls =
  "nodrag nopan w-full resize-none rounded-md bg-canvas-deep p-2.5 text-[11px] leading-relaxed text-ink-soft outline-none transition-colors placeholder:text-ink-placeholder focus:ring-1 focus:ring-primary/40";

/** 按控件类型的强调色 —— 镜像画布端口配色。 */
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
