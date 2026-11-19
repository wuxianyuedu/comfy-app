"use client";

import { cn } from "~/lib/utils";

/**
 * 「一棵树的展开状态画成缩进列表」的唯一实现（规范 16 §16.2.4.39）。`expansion-set` 只解决状态那一侧，渲染这一侧此前每层手写「缩进档 + 子行集合容器」：`NodesTab` 一棵树三层各写各的（`border-t p-2` / `ml-3 border-l-2 border-dashed` / 卡片内分区），都编译、都运行，差别只在缩进语义，且无报错。
 * 收：缩进档（`TREE_INDENT_STEP` / `indentClass(depth)`）、子行容器形态与引导线、`TreeChildren` 与 `TreeRow` 的关系；不收：一行长什么样（调用处 `className`）、折叠的键盘与 a11y（`Disclosure`）、展开集合（`ExpansionSet`）。
 */

/**
 * 每下一层的缩进档（父行 → 子行容器）。必须是常量而不是各处写 `ml-3`：同一棵树的三层要用同一个值，各写各的会出现「第二层缩 12px、第三层缩 8px」这种只在深树可见的错位。
 */
export const TREE_INDENT_STEP = "ml-3 pl-3";

/** 引导线（子行集合左侧那条虚线）。与缩进档**同处一个类**，是一组。 */
export const TREE_INDENT_RAIL = "border-l-2 border-dashed";

/**
 * 第 `depth` 层的子行容器缩进档（`depth` 从 0 起 = 第一层子行）。用它而不是手拼，因为缩进与引导线是一组语义，分开写就有机会只写一半（`NodesTab` 此前父级只有 `border-t`、子包两样都有）。
 */
export function indentClass(depth = 0): string {
  /* 两层以上再加档：第一层由父行自己承载（父行通常是卡片 / 分组头），
   * 再往里才是「缩进 + 引导线」的形态。 */
  return depth <= 0 ? "" : `${TREE_INDENT_STEP} ${TREE_INDENT_RAIL}`;
}

/**
 * 子行集合的容器 —— 一颗「有父行」的子树。它替代每层手写的 `{expanded && <div className="ml-3 border-l-2 …">}`：只在子行真属于某条父行时渲染，缩进档与引导线一次给全。
 * `className` 承载调用处特有的间隔与底色，不动缩进档（§16.2.4.2 第 9 条：验收标准是渲染结果不变）。
 */
export function TreeChildren({
  depth = 1,
  /** 引导线的状态色（如 `border-warning/20`）；留空则用默认边框色。 */
  railClassName,
  className,
  children,
}: {
  children: React.ReactNode;
  className?: string;
  depth?: number;
  railClassName?: string;
}) {
  return (
    <div
      className={cn("mt-1 py-1", indentClass(depth), railClassName, className)}
      data-slot="tree-children"
    >
      {children}
    </div>
  );
}

/**
 * 树里的一行 —— 把「这一行」与「它的子行」绑成一对。不写这一层时，「子容器属于哪条父行」只能靠缩进目测（`NodesTab` 的 `subs.map` 就是靠 JSX 相邻位置表达）；本件把关系说成一个 prop，行与子行不可能错位。
 * 折叠交互不在这里：需要折叠时 `row` 传 `<Disclosure>`，本组件只管层级。
 */
export function TreeRow({
  row,
  children,
  /** 子行的缩进档（默认第一层）。 */
  depth = 1,
  railClassName,
  /** 子行容器的 class（间隔 / 底色 / 状态 rail 色）。 */
  childrenClassName,
}: {
  children?: React.ReactNode;
  childrenClassName?: string;
  depth?: number;
  railClassName?: string;
  row: React.ReactNode;
}) {
  return (
    <div data-slot="tree-row">
      {row}
      {children !== null && children !== undefined && (
        <TreeChildren className={childrenClassName} depth={depth} railClassName={railClassName}>
          {children}
        </TreeChildren>
      )}
    </div>
  );
}
