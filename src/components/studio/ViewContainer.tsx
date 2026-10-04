"use client";

/**
 * 项目内视图的统一容器：只分两类 —— 文档型与工作区型。
 *
 * 为什么要收这一刀：八个文档型视图各自写一遍「外层滚动 + 居中列 + 宽度上限」，
 * 工作区型视图各自吃满父级，同一个形状重复了十几遍，而宽度数（960 / 1100 / 1200）
 * 散在三处。收口后形状只有一处、宽度只有三个档位名（`globals.css` 的 `--container-*`）。
 *
 * 两类的分界判据不是「内容多不多」，而是**滚动归谁**：
 *   · 文档型：整屏一条纵向滚动条，内容由居中窄栏承载 —— 读的东西不许横向铺满，
 *     一行铺到 2560px 是没法读的；
 *   · 工作区型：容器自己**不滚**（`overflow-hidden`），高度吃满父级，滚动与分栏由
 *     视图内部管（画布是无限平移、成片与工坊是三栏、工作流库是可拖分栏）。
 *     把这一类塞进文档型的窄栏等于直接砍掉一半工作面积，所以两类必须分开写。
 *
 * 宽度与内边距都由**调用处**决定（规范 03 §3.8.1.1：宽度是布局决定，不是组件属性），
 * 但**宽度只从 `width` 档位进来**：实测合并器认不出 `--container-*` 派生的档位名，
 * 在 `className` 里再写一份 `max-w-*` 不会盖掉档位，只会留下两份并存的类，谁生效
 * 取决于样式表顺序 —— 那是未定义行为，不是覆盖点。`className` 用来传内边距与列间距。
 *
 * 命名说明：`Frame` 而不是 `View` —— 这一带「视图」已经指代侧栏里那些可切换的屏
 * （`WorkspaceView` 是导航项的类型名，63 处在用），容器是承载它们的框，不抢同一个词。
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/** 内容列的宽度档位。数值只在 `globals.css` 一处（`--container-narrow/medium/wide`）。 */
export type DocumentWidth = "narrow" | "medium" | "wide";

const WIDTH_CLASS: Record<DocumentWidth, string> = {
  narrow: "max-w-narrow",
  medium: "max-w-medium",
  wide: "max-w-wide",
};

/**
 * 两类共用的外框：吃满父级高度、自己不出滚动条。
 *
 * 每一层都带 `min-h-0`：flex 列里的子项默认 `min-height: auto`，不会缩到比内容
 * 还小，于是内容溢出父容器被 `overflow-hidden` 裁掉（首页上下两部分曾经就这么
 * 看不到）。显式 `min-h-0` 之后，滚动层才能按 `flex-1` 正确收缩并真的出滚动条。
 *
 * 各层都是 `<div>` 而不是 `<main>`：外壳的 `SidebarInset` 才是这些屏唯一的
 * `<main>`（规范 06 §语义标签），再套一个会破坏地标导航。
 */
function ViewFrame({
  kind,
  className,
  children,
}: {
  kind: "document" | "workspace";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-view-container={kind}
      className={cn(
        "bg-canvas text-ink relative flex h-full min-h-0 w-full flex-col overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * 文档型：整屏滚动 + 居中窄栏。
 *
 * `className` 加在**居中列**上（各视图的内边距 / 列间距本来就不一样，那是它们的
 * 决定，不是容器的）。`backdrop` 挂在**外框**里、是滚动层的兄弟：铺底（如光斑）
 * 若塞进 `children` 就成了居中列的第一个子节点，位置语义会变。
 * 页眉页脚若要固定，应由视图自己在 `backdrop` 之外另起一层，而不是把这一层
 * 再套进另一个滚动容器里。
 */
export function DocumentFrame({
  width = "wide",
  className,
  backdrop,
  children,
}: {
  width?: DocumentWidth;
  className?: string;
  backdrop?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ViewFrame kind="document">
      {backdrop}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className={cn("mx-auto w-full", WIDTH_CLASS[width], className)}>
          {children}
        </div>
      </div>
    </ViewFrame>
  );
}

/**
 * 工作区型：吃满父级，**不**产生页面级滚动条。
 *
 * 内部怎么分栏、哪一栏自己滚，是视图的事。这里的 `overflow-hidden` 是判据的一部分：
 * 工作区型一旦长出外层滚动条，就会出现「整屏滚 + 画布也滚」的双层滚动（工坊屏
 * 原先正是这个形状）。
 */
export function WorkspaceFrame({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <ViewFrame kind="workspace" className={className}>
      {children}
    </ViewFrame>
  );
}
