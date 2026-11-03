"use client";

/* ── FullScreenLayer · 全屏视图层（让出窗口标题行的「全屏」）──
 * 背景（ISSUE #310 回归）：页签搬到窗口标题行后，应用内全屏视图仍用 fixed inset-0 铺满视口、
 * 盖住标题行，用户打开后看不到页签也切不回。
 * 做法：统一为 top-title-bar bottom-0（顶部让出标题行、其余铺满）；样式判据集中在 ~/lib/full-screen-layer.ts，
 * 本组件只做渲染（规范 17 §17.2 第③层）。不复制标题行：页签状态与窗口按钮只应有一处持有。 */

import type { ReactNode } from "react";

import { fullScreenLayerClass } from "~/lib/full-screen-layer";

type FullScreenLayerProps = {
  /** 无障碍名称（读屏器播报的面板标题）。 */
  "aria-label"?: string;
  /** 遮罩式面板标记模态，配合 role="dialog" 由读屏器播报。 */
  "aria-modal"?: boolean | "true" | "false";
  children: ReactNode;
  /** 该视图自身的布局 class（`flex flex-col` / `bg-bg` 等）。 */
  className?: string;
  /** 语义角色（遮罩式全屏面板如消息中心用 `dialog`）。 */
  role?: string;
  /** z-index 的 tailwind 工具类。取自浮层刻度表（规范 16 §16.2.5）：
   *  常规全屏视图用 `${zClass("modal")}`，调试类视图可下探到 `Z.base`。 */
  zClass: string;
};

/** 全屏视图的根容器：铺满标题行下方的内容区，不盖住页签。 */
export function FullScreenLayer({
  zClass,
  className,
  role,
  "aria-modal": ariaModal,
  "aria-label": ariaLabel,
  children,
}: FullScreenLayerProps) {
  return (
    <div
      aria-label={ariaLabel}
      aria-modal={ariaModal}
      className={fullScreenLayerClass(zClass, className)}
      role={role}
    >
      {children}
    </div>
  );
}
