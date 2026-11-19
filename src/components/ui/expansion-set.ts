"use client";

import { useCallback, useMemo, useState } from "react";

/** 「一棵树的展开 / 收起」状态的唯一出口（规范 16 §16.2.4.17）。
 * 这条账的形状是「父子映射 + 展开集合」这套状态管理没有出口：`NodesTab` 一棵树用了三份同形的 `Record<string, boolean>`（expandedParents / expandedNodeList / nodeExpanded），各自写一遍读写（读 `!!map[key]`，写翻转该键），逐字同形、只有键的来源不同。
 * 三件事散在调用处：① 「默认展开」的合并器逐字抄了两遍（`use-custom-nodes-settings` 冷路径与热路径各一份），语义是「已经存在的那一项不许被覆盖」—— 用户手动收起过的目录，下一轮刷新后不该自己弹回来；② `isOpen` 全靠 `!!map[key]`，`undefined` 与 `false` 分不出来，而「不许覆盖」判据要的正是 `in`（键存在）与取值这两种判据；③ 没有「全收起 / 全展开」，每处需要时又各写一段 `Object.fromEntries(...)`。
 * 与 `use-flash-state` / `use-interval` 同族：这是 hook，不是组件 —— 树的渲染由调用处决定（`Disclosure` 管「一行怎么折」，本模块管「一棵树的哪些行折着」），配合使用、不互相替代。 */

/** 展开集合（键 → 是否展开）。缺键表示「从未表态」，由调用处决定默认。 */
export type ExpansionMap = Record<string, boolean>;

export type ExpansionSet = {
  /** 全收起。 */
  collapseAll: () => void;
  /** 该键有没有被表过态（无论展开还是收起）。
   * 为什么必须与 `isExpanded` 分开：`!!map[key]` 把「用户手动收起过」与「从没碰过」压成同一个 `false`，而「补默认值时不覆盖已有表态」这条判据恰恰要区分它们 —— `in` 与取值是两种判据，不是一个。 */
  hasKey: (key: string) => boolean;
  /** 某一项是否展开（缺键 = 未表态 = 折叠）。 */
  isExpanded: (key: string) => boolean;
  /** 当前展开集合。直接用 `Record` 是为了让调用处可以整体交给别的 `map` 用。 */
  map: ExpansionMap;
  /** 整体替换（全展开 / 全收起 / 从持久化恢复）。 */
  replace: (next: ExpansionMap) => void;
  /** 为尚未表态的键补默认值，不覆盖已有的表态。
   * 用途正是那条抄了两遍的「首次打开时默认展开所有已配置的目录」：刷新回来时用户收起的那个不该自己弹开。要「全部重置」用 `replace`（那是另一件事，不是「补默认」）。 */
  seedDefaults: (keys: ReadonlyArray<string>, open?: boolean) => void;
  /** 显式设置一项。 */
  set: (key: string, open: boolean) => void;
  /** 切换一项（未表态 → 展开；已展开 → 收起）。 */
  toggle: (key: string) => void;
};

/** 展开集合的状态出口。取：`const nodes = useExpansionSet();` 读：`const open = nodes.isExpanded(sub.path);`
 * 写（交给 `Disclosure`）：`<Disclosure open={open} onOpenChange={() => nodes.toggle(sub.path)} />`；补默认（此前是一段抄两遍的合并器）：`nodes.seedDefaults(savedPaths);` */
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
    setMap((prev) => ({ ...prev, [key]: prev[key] !== true }));
  }, []);

  const set = useCallback((key: string, open: boolean) => {
    setMap((prev) => ({ ...prev, [key]: open }));
  }, []);

  const seedDefaults = useCallback((keys: ReadonlyArray<string>, open = true) => {
    setMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of keys) {
        if (key in next) {
          continue;
        } // 已有表态（含用户手动收起）不动
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
