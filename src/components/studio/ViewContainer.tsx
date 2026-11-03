"use client";

/**
 * 项目内视图的统一容器：只分两类 —— 文档型（整屏滚动 + 居中列，宽度走 narrow/medium/wide/full 档位；`full` 是工具型文档视图的例外）与工作区型（`overflow-hidden`、吃满父级、滚动与分栏归视图内部）。分界判据是「滚动归谁」，不是内容多不多。
 * 宽度只从 `width` 档位进来：合并器认不出 `--container-*` 派生的档位名，`className` 里再写 `max-w-*` 不会盖掉档位，只会留两份并存、谁生效取决于样式表顺序（未定义行为，不是覆盖点）；`className` 只传内边距与列间距（规范 03 §3.8.1.1）。
 * 命名 `Frame` 而不是 `View`：后者已指侧栏里的可切换屏（`WorkspaceView`，63 处在用），容器是承载它们的框。
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/** 内容列的宽度档位。前三档的数值只在 `globals.css` 一处（`--container-narrow/medium/wide`）；
 * `full` 是「不封顶」，没有数值可挂在令牌里，所以直接写 `max-w-none`
 * （`none` 是 Tailwind 内建关键词，不是本仓的档位名）。 */
export type DocumentWidth = "narrow" | "medium" | "wide" | "full";

const WIDTH_CLASS: Record<DocumentWidth, string> = {
  narrow: "max-w-narrow",
  medium: "max-w-medium",
  wide: "max-w-wide",
  full: "max-w-none",
};

/**
 * 两类共用的外框：**只管几何**（吃满父级、自己不出滚动条），不管颜色。每层带 `min-h-0`：flex 子项默认 `min-height: auto` 不缩到内容以下，内容会被 `overflow-hidden` 裁掉（首页上下两半曾因此看不全）；显式后滚动层才能按 `flex-1` 收缩并真的出滚动条。
 * 各层是 `<div>` 而不是 `<main>`：外壳的 `SidebarInset` 才是这些屏唯一的 `<main>`（规范 06 §语义标签），再套一个会破坏地标导航。
 */
function ViewFrame({
  kind,
  className,
  children,
}: {
  children: ReactNode;
  className?: string;
  kind: "document" | "workspace";
}) {
  return (
    <div
      className={cn("relative flex h-full min-h-0 w-full flex-col overflow-hidden", className)}
      data-view-container={kind}
    >
      {children}
    </div>
  );
}

/**
 * 文档型：整屏滚动 + 居中列（宽度由 `width` 档位给；`full` 不封顶，是工具型文档视图的例外，理由见文件头）。`className` 加在**居中列**上 —— 内边距 / 列间距是各视图的决定。
 * `backdrop` 挂在**外框**里、是滚动层的兄弟：铺底若塞进 `children` 就成了居中列的第一个子节点，位置语义会变。页眉页脚要固定应由视图自己在 `backdrop` 之外另起一层。
 */
export function DocumentFrame({
  width = "wide",
  className,
  backdrop,
  children,
}: {
  backdrop?: ReactNode;
  children: ReactNode;
  className?: string;
  width?: DocumentWidth;
}) {
  return (
    <ViewFrame className="bg-canvas text-ink" kind="document">
      {backdrop}
      {/* `data-document-scroll`：文档型的滚动锚 —— 视图深处的行虚拟化
          （如 ProjectOutputs 的产出网格）经 `closest()` 找到它作为
          `useVirtualizer` 的 scroll element（#2190），不依赖 class 名。 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-y-auto" data-document-scroll>
        <div className={cn("mx-auto w-full", WIDTH_CLASS[width], className)}>{children}</div>
      </div>
    </ViewFrame>
  );
}

/**
 * 工作区型：吃满父级，**不**产生页面级滚动条；内部怎么分栏、哪栏自己滚是视图的事。`overflow-hidden` 是判据的一部分 —— 否则会出现「整屏滚 + 画布也滚」（工坊屏原为此形）。
 * 背景**留给调用处**：三屏底色本就不同（成片 `bg-canvas`、工坊 `bg-bg`、工作流库靠外壳兜）。写死一颗等于偷改一屏的颜色，而 className 覆盖不可靠（合并器不保证认这两颗 token），所以这里干脆不写。
 */
export function WorkspaceFrame({
  className,
  children,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ViewFrame className={className} kind="workspace">
      {children}
    </ViewFrame>
  );
}
