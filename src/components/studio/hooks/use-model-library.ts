"use client";

// ── 工作室模型库：逻辑层（规范 17 §17.2 第②层）
// 承载模型列表（useQuery + 静默同步）与筛选状态；视图只消费 controller，不直呼 options。
// 首屏口径：`list` 与 `sync` **并行**发车，`loading` 只表示「列表首次还没有数据」，
// 不被 sync 的全目录扫描挡住（串行会让用户对着空白等整轮扫描）；sync 后的 refetch 不置 loading。
// 因此这里没有「refetch 游离 promise + aliveRef」记账，也没有本地 loading state。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

import { ALL_TYPES, type ModelRow, countByType, filterModels } from "../model-library-config";

export type ModelLibraryController = {
  /** 目录配置弹层开关。 */
  configOpen: boolean;
  /** 当前类型筛选；ALL_TYPES 表示全部。 */
  filter: string;
  /** 筛选后的行（视图直接渲染）。 */
  filtered: Array<ModelRow>;
  /** 列表首次加载中（尚无数据）—— 驱动首屏骨架，不等后台同步。 */
  loading: boolean;
  models: Array<ModelRow>;
  /** 搜索关键字。 */
  q: string;
  /** 后台同步 / 刷新进行中：不挡首屏，只在筛选行给轻指示。 */
  refreshing: boolean;
  /** 手动刷新（配置弹层关闭后调用）。 */
  reload: () => void;
  setConfigOpen: (open: boolean) => void;
  setFilter: (filter: string) => void;
  setQ: (q: string) => void;
  /** 数据里出现过的类型及其数量，驱动筛选 chips。 */
  typeChips: Array<[string, number]>;
};

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

  /* `useQuery` / `useMutation` 返回的**对象每次渲染都是新引用**，把依赖它们的 `reload`
   * 放进 effect 依赖数组会让「effect 跑一次」变成「每渲染一次跑一次」；effect 体内
   * sync 完成又触发渲染，于是自激：实测静置时 `model.sync` 每 10~12ms 打一次（6 秒 505 次）。
   * 修法：把不稳的引用收进 ref，effect 只依赖 `[]` —— 语义本就是「挂载时同步一次」。
   * `reload` 每次渲染都是新函数，收进 ref；`syncMut.mutate` 是 mutation 稳定引用，直接用。 */
  const reloadRef = useRef(reload);

  /* 把最新一份 `reload` 同步进 ref。写在 effect 里而不是渲染期直接赋值：
   * 后者是并发渲染下不允许的副作用（被丢弃的那次渲染也会改 ref）。 */
  useEffect(() => {
    reloadRef.current = reload;
  });

  useEffect(() => {
    // 挂载时静默同步一次，让库反映当前配置；它与 list 的首帧**并行**发车，
    // defer 出 effect body（React 19 规则：effect 内不直接 setState）。
    const t = setTimeout(() => {
      syncMut.mutate(undefined, {
        onSettled: () => {
          reloadRef.current();
        },
      });
    }, 0);
    return () => {
      clearTimeout(t);
    };
    /* 刻意只依赖 `[]`：本 effect 的语义就是「挂载时同步一次」。`syncMut` 是
     * mutation 稳定引用、`reload` 已收进 ref；把它们列进来正是上面那条
     * 自激循环的成因，不是「漏了依赖」。 */
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  /* react-query 数据 → 本地行：`models` 是 `listQ.data` 的纯派生，不是独立可变状态。
   * 不需要断言：服务端返回 `Model` 全行，`ModelRow` 是它的**子集**，结构上天然兼容，
   * 字段名与类型逐项对上就能过编译。此前 `as unknown as ModelRow[]` 双跳断言丢掉了
   * 这份检查：服务端把 `fileName` 改名这里不会红，只会在渲染时静默变 undefined。 */
  const models: Array<ModelRow> = useMemo(() => listQ.data?.models ?? [], [listQ.data]);

  const filtered = useMemo(() => filterModels(models, filter, q), [models, filter, q]);
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
