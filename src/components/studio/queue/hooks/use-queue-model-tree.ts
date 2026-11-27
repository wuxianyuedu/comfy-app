"use client";

// ── 队列页 · 左侧「用途 / 模式 / 模型」树（第②层：选中态与过滤编排）──────
// 树条目复用测试模型页的同一份候选口径（useModelTestTree：configGet / 工作流
// 清单 / 模式契约 / 适配器的 queryKey 相同，React Query 自动去重）。选中一片
// 叶子 = 按那个模型过滤队列三段列表；再点同一片 = 取消筛选。

import { useCallback, useMemo, useState } from "react";

import { useModelTestTree } from "~/components/workshop/hooks/use-model-test-tree";
import type { ModelTreeEntry } from "~/components/workshop/model-test-tree";

import {
  filterRowsByModelSelection,
  type ModelTreeSelection,
  type QueueRow,
} from "../queue-monitor-config";

export type QueueModelTreeController = {
  /** 选中叶子的显示名（筛选提示文案用）；null = 未筛选。 */
  activeLabel: string | null;
  /** 清除筛选。 */
  clear: () => void;
  /** 树条目（与测试模型页同一份候选装配）。 */
  entries: ReadonlyArray<ModelTreeEntry>;
  /** 同上，但返回应保留的行 id 集合（视图按 id 过滤三段列表更省事）。 */
  filterIds: (rows: ReadonlyArray<QueueRow>) => ReadonlySet<string>;
  /** 按选中叶子过滤队列行（三段列表共用同一条判据）。 */
  filterRows: (rows: ReadonlyArray<QueueRow>) => Array<QueueRow>;
  /** 候选取数的加载态。 */
  loading: boolean;
  /** 选中一片叶子；再点同一片 = 取消筛选。 */
  select: (kind: string, mode: string, value: string) => void;
  /** 当前选中的叶子；null = 未筛选（看全部）。 */
  selection: ModelTreeSelection;
};

export function useQueueModelTree(): QueueModelTreeController {
  const tree = useModelTestTree();
  const [selection, setSelection] = useState<ModelTreeSelection>(null);

  const select = useCallback((kind: string, mode: string, value: string) => {
    setSelection((current) =>
      current?.kind === kind && current?.mode === mode && current?.value === value
        ? null
        : { kind, mode, value },
    );
  }, []);

  const clear = useCallback(() => {
    setSelection(null);
  }, []);

  const filterRows = useCallback(
    (rows: ReadonlyArray<QueueRow>) => filterRowsByModelSelection(rows, selection, tree.entries),
    [selection, tree.entries],
  );
  const filterIds = useCallback(
    (rows: ReadonlyArray<QueueRow>) =>
      new Set(filterRowsByModelSelection(rows, selection, tree.entries).map((row) => row.id)),
    [selection, tree.entries],
  );

  const activeLabel = useMemo(() => {
    if (selection === null) {
      return null;
    }
    const entry = tree.entries.find(
      (candidate) =>
        candidate.kind === selection.kind &&
        candidate.mode === selection.mode &&
        candidate.value === selection.value,
    );
    return entry?.label ?? null;
  }, [selection, tree.entries]);

  /* 引用恒定：视图的 keepIds useMemo 以本对象为依赖，现造对象会让它每次渲染
   * 重算整份行 id 集合（队列 700 行时是一笔可观的 O(n) 开销）。 */
  return useMemo(
    () => ({
      activeLabel,
      clear,
      entries: tree.entries,
      filterIds,
      filterRows,
      loading: tree.loading,
      select,
      selection,
    }),
    [activeLabel, clear, tree.entries, filterIds, filterRows, tree.loading, select, selection],
  );
}
