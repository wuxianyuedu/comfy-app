"use client";

// ── 侧栏行上的「关闭页签」按钮（ISSUE #3740 引入，#4981 起折叠态也弹出）──────
// 三处同形（全局导航项 / 项目分组行 / 临时页签组）共用这一份：展开态挂在行右缘
// 居中、悬停 / 聚焦浮现；折叠成图标轨时不再隐藏（基元 menu-action 的默认行为是
// 折叠即藏，此前关页签必须先展开侧栏）—— 收成图标右侧的一枚实底小圆徽
// （#5040：此前压在图标右上角会盖住图标），落在打开态胶片右缘仍可读。
// 关闭交互走 pointerdown（ISSUE #3789）：行级 tooltip
// 收起引发的重渲染会让 click 落到行 <li> 上关不掉页签，pointerdown 阶段目标
// 稳定是这枚按钮本身。

import { X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** 悬停组名：默认 `menu-item`（行自身就是普通侧栏行）。项目分组里的行要传
 *  `row` —— 那个面板嵌在外层「项目」行（也是一个 menu-item）里，Tailwind 命名
 *  组变体是「任一祖先命中」，不吃独立组名会让悬停串到别的行（ISSUE #4812）。 */
export type SidebarRowCloseGroup = "menu-item" | "row";

export function SidebarRowClose({
  className,
  group = "menu-item",
  label,
  onClose,
}: {
  className?: string;
  group?: SidebarRowCloseGroup;
  label: string;
  onClose: () => void;
}) {
  /* 悬停组类名必须写字面量（Tailwind 按字面扫描，动态拼串不会被编译进去）。 */
  const hover =
    group === "row"
      ? "group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      : "group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100";
  return (
    <Button
      aria-label={`关闭 ${label} 页签`}
      className={cn(
        "absolute top-1/2 right-2 -translate-y-1/2",
        "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "opacity-0 transition-opacity",
        hover,
        "focus-visible:opacity-100",
        /* 折叠态（图标轨）：关闭按钮移到图标**右侧**（#5040）——此前压在图标右上角
         * 盖住图标中心。行宽 32px、图标占 x=8..24，按钮垂直居中靠行右缘，右移 6px
         * 落在 x≈22..38：与图标主体分离、仍在 48px 轨内不越界。缩到 size-3 减少占用。 */
        "group-data-[collapsible=icon]:top-1/2 group-data-[collapsible=icon]:right-[-6px]",
        "group-data-[collapsible=icon]:-translate-y-1/2 group-data-[collapsible=icon]:size-3",
        "group-data-[collapsible=icon]:rounded-full group-data-[collapsible=icon]:p-0",
        "group-data-[collapsible=icon]:bg-sidebar group-data-[collapsible=icon]:text-sidebar-foreground",
        "group-data-[collapsible=icon]:ring-1 group-data-[collapsible=icon]:ring-sidebar-border",
        /* 局部叠层取刻度表下限（§16.2.5：z-base，不写裸数字）。 */
        "z-base",
        className,
      )}
      data-sidebar="menu-action"
      onPointerDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      <X data-icon="inline-start" size={12} />
    </Button>
  );
}
