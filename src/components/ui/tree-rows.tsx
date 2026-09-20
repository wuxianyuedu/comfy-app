"use client";

import { cn } from "~/lib/utils";

/**
 * 「一棵树的展开状态**画成缩进列表**」的**唯一实现**（规范 16 §16.2.4.39）。
 *
 * ## 这条账的形状
 *
 * 上一批收口的 `~/components/ui/expansion-set` 只解决了**状态**那一侧 ——
 * 「哪些行是展开的、某个键有没有被表过态」。渲染那一侧当时没动：一棵树
 * 每往下走一层，都要再手写一遍「**缩进档 + 子行集合容器**」。
 *
 * `NodesTab` 是这条账的完整样本，一棵树三层，三层的子容器各写各的：
 *
 * ```text
 * 父目录行  → 子容器 {/* border-t p-2 *\/}              ← 无缩进档，靠边框分隔
 * 子包行    → 子容器 {/* ml-3 border-l-2 border-dashed pl-3 *\/}  ← 引导线 + 缩进
 * 节点卡    → 子容器 {/* 卡片内自己的分区 *\/}            ← 又是另一套
 * ```
 *
 * 三处都编译、都运行、外观「看着都对」，差别只在**缩进的语义**上：
 * 引导线的颜色取自哪一档、缩进是 `ml-3` 还是靠 `border-t` 分隔、
 * 「这个容器属于哪条父行」有没有说出来。这类差异**没有报错、没有告警**，
 * tsc / eslint 也都不看 —— 只能靠「同一件事只允许一处实现」从结构上消除。
 *
 * ## 收什么、不收什么
 *
 * **收**：缩进档（`TREE_INDENT_STEP` / `indentClass(depth)`）、子行集合的容器
 * 形态与引导线、`TreeChildren` 与 `TreeRow` 之间的关系（行 → 它的子行）。
 * **不收**：一行长什么样（归调用处的 `className`）、折叠开关的键盘与 a11y 语义
 * （归 `~/components/ui/disclosure`）、展开集合的状态（归
 * `~/components/ui/expansion-set`）。
 *
 * ## 与 `Disclosure` / `ExpansionSet` 的分工
 *
 * 三者是**同一件事的三层**，配合使用、不互相替代：
 *
 * | 出口 | 回答的问题 |
 * | ---- | ---------- |
 * | `ExpansionSet` | **哪些行**折着（状态） |
 * | `Disclosure`   | **一行**怎么折（交互与 a11y） |
 * | `TreeRow` / `TreeChildren` | 一棵树的**层级关系**怎么画（缩进与子行归属） |
 *
 * 判据（`scripts/check-ui-primitives.cjs` 的 P36）按**形态**取锚点：
 * 同一个 JSX 里既有展开判据（`isExpanded` / `expanded &&` 这一族），
 * 又有**手写的缩进档**（`ml-*` 与引导线 `border-l-*` 同处一个 class 串）。
 * 只看缩进会把「卡片左内边距」算上；只看展开判据会把任何条件渲染算上。
 */

/**
 * 每下一层的缩进档（父行 → 子行容器）。
 *
 * **为什么是常量而不是让调用处自己写 `ml-3`**：缩进档是**树的阶梯**，
 * 同一棵树的三层必须用同一个值 —— 各写各的就会出现「第二层缩了 12px、
 * 第三层缩了 8px」这种只有在深树上才看得出来的错位。
 */
export const TREE_INDENT_STEP = "ml-3 pl-3";

/** 引导线（子行集合左侧那条虚线）。与缩进档**同处一个类**，是一组。 */
export const TREE_INDENT_RAIL = "border-l-2 border-dashed";

/**
 * 第 `depth` 层的子行容器缩进档（`depth` 从 0 起 = 第一层子行）。
 *
 * 用它而不是手拼 `ml-3 border-l-2 ...`：缩进与引导线是一组语义，
 * 分开写就有机会只写一半（`NodesTab` 此前正是「父级那层只有 `border-t`
 * 没有引导线、子包那层两样都有」）。
 */
export function indentClass(depth = 0): string {
  /* 两层以上再加档：第一层由父行自己承载（父行通常是卡片 / 分组头），
   * 再往里才是「缩进 + 引导线」的形态。 */
  return depth <= 0 ? "" : `${TREE_INDENT_STEP} ${TREE_INDENT_RAIL}`;
}

/**
 * 子行集合的容器 —— 一颗「有父行」的子树。
 *
 * 它替代的是每层手写的那个 `{expanded && <div className="ml-3 border-l-2 …">…</div>}`：
 * **只在这些子行真的属于某条父行时**才渲染它，缩进档与引导线一次给全。
 *
 * `className` 承载调用处特有的间隔与底色（`space-y-1.5`、`py-1`、rail 的状态色），
 * 不动缩进档 —— 那是本模块的判据（§16.2.4.2 第 9 条：验收标准是渲染结果不变）。
 */
export function TreeChildren({
  depth = 1,
  /** 引导线的状态色（如 `border-warning/20`）；留空则用默认边框色。 */
  railClassName,
  className,
  children,
}: {
  depth?: number;
  railClassName?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="tree-children"
      className={cn("mt-1 py-1", indentClass(depth), railClassName, className)}
    >
      {children}
    </div>
  );
}

/**
 * 树里的一行 —— 把「这一行」与「它的子行」绑成一对。
 *
 * **为什么需要它**：不写这一层时，「子容器属于哪条父行」只能靠缩进目测
 * （`NodesTab` 的 `subs.map` 里，子包行与它的节点清单 rail 就是靠 JSX 相邻位置
 * 表达的）。`TreeRow` 把这条关系说成一个 prop，行与子行不可能再错位。
 *
 * 折叠交互**不在这里** —— 需要折叠时，`row` 传一个
 * `~/components/ui/disclosure` 的 `<Disclosure>`；本组件只管层级。
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
  row: React.ReactNode;
  children?: React.ReactNode;
  depth?: number;
  railClassName?: string;
  childrenClassName?: string;
}) {
  return (
    <div data-slot="tree-row">
      {row}
      {children != null && (
        <TreeChildren
          depth={depth}
          railClassName={railClassName}
          className={childrenClassName}
        >
          {children}
        </TreeChildren>
      )}
    </div>
  );
}
