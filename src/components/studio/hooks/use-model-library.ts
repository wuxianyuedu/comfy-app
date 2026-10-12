"use client";

// ── 工作室模型库：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载模型列表（tRPC useQuery + 静默同步）与筛选状态。ModelLibrary 视图只消费
// 本 hook 返回的 controller，不再出现 `trpc.model.*` 的 options 调用。
//
// 挂载时先 sync 再 refetch 的顺序不可换：后端 sync 会重新扫描 ComfyUI 目录，
// 用户不必手动点「重新扫描」就能看到最新模型（原组件行为，保留语义）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const trpc = useTRPC();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>(ALL_TYPES);
  const [configOpen, setConfigOpen] = useState(false);

  const listQ = useQuery(trpc.model.list.queryOptions());
  const syncMut = useMutation(trpc.model.sync.mutationOptions());

  /* 卸载标记：refetch 是一条**脱离组件生命周期的游离 promise 链**——
   * 它的 .finally 会在「组件已卸载、测试的 jsdom 环境已拆除」之后才 resolve，
   * 此时 setLoading 会打到已销毁的环境上。实测形态是 vitest 的
   * 表现为 Unhandled Rejection: ReferenceError: window is not defined
   * （react-dom 的 resolveUpdatePriority 读 window），退出码非零、
   * 而报错点名的文件**每次都不同**（谁回包慢就点谁）。
   * cleanup() 只卸载组件、不会取消这条已发出的 promise，所以必须自己判存活。 */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /* `useQuery` / `useMutation` 返回的**对象每次渲染都是新引用**，
   * 把它们（或依赖它们的 `loadModels`）放进下面那个 effect 的依赖数组，
   * 会让「effect 跑一次」变成「每渲染一次跑一次」——
   * 而 effect 体内的 sync mutation 完成又会触发一次渲染，
   * 于是自激成循环：实测静置时 `model.sync` 每 10~12ms 打一次（6 秒 505 次）、
   * 当时打开的整个视图每秒被重渲染上千次。
   *
   * 修法是**把不稳的引用收进 ref**，effect 只依赖 `[]`：
   * 它要的语义本来就是「挂载时同步一次」，不是「依赖变化时同步」。
   * `loadModels` 每次渲染都是新函数（它依赖 `listQ`），收进 ref；
   * `syncMut.mutate` 本身是 mutation 稳定引用，直接用即可。 */
  const loadModelsRef = useRef<(() => void) | null>(null);

  const loadModels = useCallback(() => {
    setLoading(true);
    void listQ
      .refetch()
      .catch(() => {
        /* refetch 错误由 query 自身的 error 态承载 */
      })
      .finally(() => {
        /* 卸载后不再 setState：否则触发 React 的更新调度，进而读到已拆除的
         * window（见上方 aliveRef 的注释）。 */
        if (aliveRef.current) setLoading(false);
      });
  }, [listQ]);

  /* 把最新一份 `loadModels` 同步进 ref。写在 effect 里而不是渲染期直接赋值：
   * 后者是并发渲染下不允许的副作用（被丢弃的那次渲染也会改 ref）。 */
  useEffect(() => {
    loadModelsRef.current = loadModels;
  });

  useEffect(() => {
    // 挂载时静默同步一次，让库反映当前配置；defer 出 effect body
    //（React 19 规则：effect 内不直接 setState）。
    const t = setTimeout(
      () =>
        syncMut.mutate(undefined, {
          onSettled: () => loadModelsRef.current?.(),
        }),
      0,
    );
    return () => clearTimeout(t);
    /* 刻意只依赖 `[]`：本 effect 的语义就是「挂载时同步一次」。`syncMut` 是
     * mutation 稳定引用、`loadModels` 已收进 ref；把它们列进来正是上面那条
     * 自激循环的成因，不是「漏了依赖」。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
