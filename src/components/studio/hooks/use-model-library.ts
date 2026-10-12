"use client";

// ── 工作室模型库：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载模型列表（tRPC useQuery + 静默同步）与筛选状态。ModelLibrary 视图只消费
// 本 hook 返回的 controller，不再出现 `trpc.model.*` 的 options 调用。
//
// 首屏口径（ISSUE 反馈「一打开就是加载中、等好久」）：
//   · `list` 与 `sync` **并行**发车 —— useQuery 挂载即拉 DB 存量，sync 在后台
//     重扫 ComfyUI 目录；`loading` 只表示「列表首次还没有数据」，不再被
//     sync 的全目录扫描挡住。此前是「sync 完成 → 才 refetch」的串行链，
//     用户对着空白等的是整轮目录扫描（多目录时以秒计）。
//   · sync 完成后的 refetch **不置 loading**：那是一次静默替换，由
//     `refreshing` 在筛选行给一颗轻指示，不打断阅读。
//   · 因此这里不再有「refetch 的游离 promise 链 + aliveRef」那套记账：
//     不 setState 就没有卸载后击穿环境的入口。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

import {
  ALL_TYPES,
  type ModelRow,
  countByType,
  filterModels,
} from "../model-library-config";

export interface ModelLibraryController {
  models: ModelRow[];
  /** 列表首次加载中（尚无数据）—— 驱动首屏骨架，不等后台同步。 */
  loading: boolean;
  /** 后台同步 / 刷新进行中：不挡首屏，只在筛选行给轻指示。 */
  refreshing: boolean;
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
  const trpc = useTRPC();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>(ALL_TYPES);
  const [configOpen, setConfigOpen] = useState(false);

  const listQ = useQuery(trpc.model.list.queryOptions());
  const syncMut = useMutation(trpc.model.sync.mutationOptions());

  /* 静默刷新：不置 `loading`（首屏骨架由 listQ.isLoading 驱动），
   * refetch 失败由 query 自身的 error 态承载 —— 这里不补 setState，
   * 也就没有「卸载后击穿环境」的入口（见文件头）。 */
  const reload = useCallback(() => {
    void listQ.refetch().catch(() => {
      /* 同上：错误态走 react-query */
    });
  }, [listQ]);

  useEffect(() => {
    // 挂载时静默同步一次，让库反映当前配置；它与 list 的首帧**并行**发车，
    // defer 出 effect body（React 19 规则：effect 内不直接 setState）。
    const t = setTimeout(
      () => syncMut.mutate(undefined, { onSettled: () => reload() }),
      0,
    );
    return () => clearTimeout(t);
  }, [syncMut, reload]);

  /* react-query 数据 → 本地行：`models` 是 `listQ.data` 的纯派生（P2：去掉
   * 「prev 引用对比 + 渲染期 setState」的记账 state），不再是独立可变状态。
   * 手动刷新走 `listQ.refetch()`，同样体现为 `listQ.data` 变化。
   *
   * 这里**不需要**断言：服务端返回的是 `Model` 全行（含 `folder` / `source` /
   * `updatedAt` 等本视图不读的列），而 `ModelRow` 是它的**子集** —— 结构上天然兼容，
   * 单靠「字段名与类型逐项对上」就能过编译。此前写的 `as unknown as ModelRow[]`
   * 是双跳断言，它把这份兼容性检查也一起丢掉了：服务端哪天把 `fileName` 改名，
   * 这里不会红，只会在渲染时静默变 `undefined`。 */
  const models: ModelRow[] = useMemo(
    () => listQ.data?.models ?? [],
    [listQ.data],
  );

  const filtered = useMemo(
    () => filterModels(models, filter, q),
    [models, filter, q],
  );
  const typeChips = useMemo(() => countByType(models), [models]);

  return {
    models,
    loading: listQ.isLoading,
    refreshing: syncMut.isPending || listQ.isFetching,
    q,
    setQ,
    filter,
    setFilter,
    filtered,
    typeChips,
    configOpen,
    setConfigOpen,
    reload,
  };
}
