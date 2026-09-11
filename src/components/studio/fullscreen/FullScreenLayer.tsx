"use client";

/* ── FullScreenLayer · 全屏视图层（让出窗口标题行的「全屏」）─────────
 *
 * 背景（ISSUE #310 回归）：应用级页签搬到窗口标题行后，应用内的「全屏」
 * 视图（设置、工作流编辑器、脚本编辑器、消息中心…）仍用 `fixed inset-0`
 * 铺满整个视口，把标题行里的页签整条盖住 —— 用户打开这些视图后就再也
 * 看不到页签，也切不回其它页签。
 *
 * 做法：全屏视图统一改为「顶部让出标题行、其余铺满」`top-title-bar
 * bottom-0`（样式判据集中在 `~/lib/full-screen-layer.ts`，本组件只做
 * 渲染，规范 17 §17.2 第③层）。
 *
 * 为什么不做成「把标题行复制一份盖在上层」：页签状态与窗口按钮动作都
 * 只应有一处持有（`shell-tabs-store` + `TitleBarTabs`），复制一份必然
 * 出现两套状态各自漂移。让位最简单，也不给标题行引入第二真源。
 */

import type { ReactNode } from "react";

import { fullScreenLayerClass } from "~/lib/full-screen-layer";

interface FullScreenLayerProps {
  /** z-index 的 tailwind 工具类（如 `z-50`），各视图按浮层高低自选。 */
  zClass: string;
  /** 该视图自身的布局 class（`flex flex-col` / `bg-bg` 等）。 */
  className?: string;
  /** 语义角色（遮罩式全屏面板如消息中心用 `dialog`）。 */
  role?: string;
  /** 遮罩式面板标记模态，配合 role="dialog" 由读屏器播报。 */
  "aria-modal"?: boolean | "true" | "false";
  /** 无障碍名称（读屏器播报的面板标题）。 */
  "aria-label"?: string;
  children: ReactNode;
}

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
      className={fullScreenLayerClass(zClass, className)}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
