"use client";

// ── 工作室模型库：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载模型列表（tRPC useQuery + 静默同步）与筛选状态。ModelLibrary 视图只消费
// 本 hook 返回的 controller，不再出现 `api.model.*.useQuery`。
//
// 挂载时先 sync 再 refetch 的顺序不可换：后端 sync 会重新扫描 ComfyUI 目录，
// 用户不必手动点「重新扫描」就能看到最新模型（原组件行为，保留语义）。

import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "~/trpc/react";

import {
  ALL_TYPES,
  type ModelRow,
  countByType,
  filterModels,
} from "../model-library-config";

export interface ModelLibraryController {
  models: ModelRow[];
  loading: boolean;
  /** 搜索关键字。 */
  q: string;
  setQ: (q: string) => void;
  /** 当前类型筛选；ALL_TYPES 表示全部。 */
  filter: string;
  setFilter: (filter: string) => void;
  /** 筛选后的行（视图直接渲染）。 */
  filtered: ModelRow[];
  /** 数据里出现过的类型及其数量，驱动筛选 chips。 */
  typeChips: Array<[string, number]>;
  /** 目录配置弹层开关。 */
  configOpen: boolean;
  setConfigOpen: (open: boolean) => void;
  /** 手动刷新（配置弹层关闭后调用）。 */
  reload: () => void;
}

export function useModelLibrary(): ModelLibraryController {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>(ALL_TYPES);
  const [configOpen, setConfigOpen] = useState(false);

  const listQ = api.model.list.useQuery();
  const syncMut = api.model.sync.useMutation();

  const loadModels = useCallback(() => {
    setLoading(true);
    void listQ
      .refetch()
      .catch(() => {
        /* refetch 错误由 query 自身的 error 态承载 */
      })
      .finally(() => setLoading(false));
  }, [listQ]);

  useEffect(() => {
    // 挂载时静默同步一次，让库反映当前配置；defer 出 effect body
    //（React 19 规则：effect 内不直接 setState）。
    const t = setTimeout(
      () => syncMut.mutate(undefined, { onSettled: () => loadModels() }),
      0,
    );
    return () => clearTimeout(t);
  }, [syncMut, loadModels]);

  // react-query data → 本地行（渲染期调整，React 19 模式）。
  const [prevListData, setPrevListData] = useState(listQ.data);
  if (listQ.data && listQ.data !== prevListData) {
    setPrevListData(listQ.data);
    setModels((listQ.data.models ?? []) as unknown as ModelRow[]);
  }

  const filtered = useMemo(
    () => filterModels(models, filter, q),
    [models, filter, q],
  );
  const typeChips = useMemo(() => countByType(models), [models]);

  return {
    models,
    loading,
    q,
    setQ,
    filter,
    setFilter,
    filtered,
    typeChips,
    configOpen,
    setConfigOpen,
    reload: loadModels,
  };
}
