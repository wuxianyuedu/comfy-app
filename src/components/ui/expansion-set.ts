"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * 「一棵树的展开 / 收起」状态的**唯一出口**（规范 16 §16.2.4.17）。
 *
 * 这条账的形状是**「父子映射 + 展开集合」这套状态管理没有出口**：`NodesTab`
 * 一棵树用了**三份同形的 `Record<string, boolean>`**（`expandedParents` /
 * `expandedNodeList` / `nodeExpanded`），每份都配一组「自己写一遍的」读写代码：
 *
 * 读：`const isOpen = !!expandedParents[parent];`（关不关只看这一个取值）
 * 写：`setExpandedParents((prev) => ({ ...prev, [parent]: !prev[parent] }));`
 * （翻转该键）—— 三份实现逐字同形，只有键的来源不同。
 *
 * 三件事散在调用处，各自的缺陷都能对上号：
 *
 * 1. **「默认展开」那段逐字抄了两遍**（`use-custom-nodes-settings` 的
 *    冷路径与热路径各一份）：
 *    先复制一份原映射：`const out = { ...prev };`
 *    再按「键在不在」逐个补（`in`，不是看取值）：
 *    `for (const p of paths) if (!(p in out)) out[p] = true;` —— 键已存在就跳过，
 *    最后 `return out;`。
 *    它的语义是「**已经存在的那一项不许被覆盖**」——用户手动收起过的目录，
 *    在下一轮刷新后不该自己弹回来。这条语义在一个块里，抄两遍就有两份会漂。
 * 2. **`isOpen` 的读取全靠 `!!map[key]`**，于是 `undefined` 与 `false` 谁也
 *    分不出来 —— 而这正是上面那条「不许覆盖」判据要用的区分（`in` 判的是
 *    键存在，不是值）。出口把两者分开表达（`isExpanded` / `hasKey`）。
 * 3. **没有「全收起 / 全展开」这个动作**，于是每处需要时又各写一段
 *    `Object.fromEntries(...)`。
 *
 * 与 `use-flash-state` / `use-interval` 同族：**这是 hook，不是组件** ——
 * 树的渲染由调用处决定（`Disclosure` 管的是「一行怎么折」，本模块管的是
 * 「一棵树的哪些行折着」）。两者配合使用，不互相替代。
 */

/** 展开集合（键 → 是否展开）。缺键表示「从未表态」，由调用处决定默认。 */
export type ExpansionMap = Record<string, boolean>;

export interface ExpansionSet {
  /** 当前展开集合。直接用 `Record` 是为了让调用处可以整体交给别的 `map` 用。 */
  map: ExpansionMap;
  /** 某一项是否展开（缺键 = 未表态 = 折叠）。 */
  isExpanded: (key: string) => boolean;
  /**
   * 该键**有没有被表过态**（无论展开还是收起）。
   *
   * 为什么必须与 `isExpanded` 分开：`!!map[key]` 把「用户手动收起过」与
   * 「从没碰过」压成同一个 `false`，而「补默认值时不覆盖已有表态」这条判据
   * 恰恰要区分它们 —— 这是 `in` 与取值两种判据，不是一个。
   */
  hasKey: (key: string) => boolean;
  /** 切换一项（未表态 → 展开；已展开 → 收起）。 */
  toggle: (key: string) => void;
  /** 显式设置一项。 */
  set: (key: string, open: boolean) => void;
  /**
   * 为**尚未表态**的键补默认值，不覆盖已有的表态。
   *
   * 用途正是那条抄了两遍的「首次打开时默认展开所有已配置的目录」：刷新回来
   * 时用户收起的那个不该自己弹开。要「全部重置」用 `replace`（那是另一件事，
   * 不是「补默认」）。
   */
  seedDefaults: (keys: readonly string[], open?: boolean) => void;
  /** 整体替换（全展开 / 全收起 / 从持久化恢复）。 */
  replace: (next: ExpansionMap) => void;
  /** 全收起。 */
  collapseAll: () => void;
}

/**
 * 展开集合的状态出口。
 *
 * 取出口：`const nodes = useExpansionSet();`
 * 读：`const open = nodes.isExpanded(sub.path);`
 * 写（交给 `Disclosure`）：`<Disclosure open={open} onOpenChange={() => nodes.toggle(sub.path)} />`
 * 补默认（此前是一段抄两遍的合并器）：`nodes.seedDefaults(savedPaths);`
 */
export function useExpansionSet(
  /** 初始集合（一般给 `{}`；从持久化恢复时给读出来的值）。 */
  initial: ExpansionMap = {},
): ExpansionSet {
  const [map, setMap] = useState<ExpansionMap>(initial);

  const isExpanded = useCallback((key: string) => map[key] === true, [map]);
  const hasKey = useCallback((key: string) => key in map, [map]);

  const toggle = useCallback((key: string) => {
    /* 函数式 updater：连点两次不会因为闭包里的旧 `map` 而互相盖掉
     * （规范 13 的 React 函数式 updater 纯净性硬规则；`check-react-updater-purity`
     * 也认这条 —— updater 里没有副作用、只读 `prev`）。 */
    setMap((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const set = useCallback((key: string, open: boolean) => {
    setMap((prev) => ({ ...prev, [key]: open }));
  }, []);

  const seedDefaults = useCallback((keys: readonly string[], open = true) => {
    setMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of keys) {
        if (key in next) continue; // 已有表态（含用户手动收起）不动
        next[key] = open;
        changed = true;
      }
      /* 没有变化时返回原引用：`seedDefaults` 会在 effect 里被调用，
       * 每次都给新对象会让订阅它的子组件白渲染一轮。 */
      return changed ? next : prev;
    });
  }, []);

  const replace = useCallback((next: ExpansionMap) => {
    setMap({ ...next });
  }, []);

  const collapseAll = useCallback(() => {
    setMap({});
  }, []);

  return useMemo(
    () => ({
      map,
      isExpanded,
      hasKey,
      toggle,
      set,
      seedDefaults,
      replace,
      collapseAll,
    }),
    [map, isExpanded, hasKey, toggle, set, seedDefaults, replace, collapseAll],
  );
}
