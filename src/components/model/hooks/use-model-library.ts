"use client";

// ── /models 页面模型卡片库：逻辑层（规范 17 §17.2 第②层）────────────────────
// 承载类型筛选、关键字搜索、列表拉取与同步。ModelLibrary 视图只消费本 hook，
// 不再出现 vanillaApi。

import { useEffect, useState } from "react";

import { beginStaleRun } from "~/lib/stale-run";
import { vanillaApi } from "~/trpc/vanilla";

import type { ModelCardData } from "../ModelCard";

export interface ModelLibraryController {
  models: ModelCardData[];
  /** 当前类型筛选；空串 = 全部。 */
  type: string;
  setType: (type: string) => void;
  /** 搜索关键字（与 type 一起构成查询参数）。 */
  q: string;
  setQ: (q: string) => void;
  loading: boolean;
  syncing: boolean;
  /** 同步（重新扫描本地模型）后自动按当前筛选刷新列表。 */
  sync: () => Promise<void>;
}

/** 查询参数：空值不传给后端（与 model.list 的 optional 入参一致）。 */
export function modelListParams(
  type: string,
  q: string,
): { type?: string; q?: string } {
  const params: { type?: string; q?: string } = {};
  if (type) params.type = type;
  if (q) params.q = q;
  return params;
}

export function useModelLibrary(): ModelLibraryController {
  const [models, setModels] = useState<ModelCardData[]>([]);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const params = modelListParams(type, q);

  /* 筛选变化即重新查询。loading 的置位放在渲染期（React 19 的「渲染期调整 state」
   * 范式）：effect body 里同步 setState 会触发级联渲染（react-hooks/set-state-in-effect）。 */
  const [queryKey, setQueryKey] = useState(() => JSON.stringify(params));
  const nextKey = JSON.stringify(params);
  if (nextKey !== queryKey) {
    setQueryKey(nextKey);
    setLoading(true);
  }

  useEffect(() => {
    /* 这一轮的作废守卫（规范 16 §16.2.4.34）：换类型 / 换关键字会重开一轮，
     * 旧轮次的结果（含 `loading` 位）一律不落地。 */
    const guard = beginStaleRun();
    void vanillaApi.model.list
      .query(params)
      .then((data) => {
        guard.commit(() =>
          setModels((data.models ?? []) as unknown as ModelCardData[]),
        );
      })
      .catch(() => {
        /* 拉取失败保留上一次列表，不让页面弹空白 */
      })
      .finally(() => {
        guard.commit(() => setLoading(false));
      });
    return () => guard.dispose();
    // `params` 每次渲染都是新对象，故按它的两个分量声明依赖（值等量即可）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, q]);

  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      await vanillaApi.model.sync.mutate();
      const data = await vanillaApi.model.list.query(params);
      setModels((data.models ?? []) as unknown as ModelCardData[]);
    } finally {
      setSyncing(false);
    }
  };

  return { models, type, setType, q, setQ, loading, syncing, sync };
}
