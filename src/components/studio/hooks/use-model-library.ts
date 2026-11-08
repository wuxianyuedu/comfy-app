"use client";

// ── 工作室模型库：逻辑层（规范 17 §17.2 第②层）
// 承载模型列表（useQuery + 静默同步）与「当前目录 + 搜索」状态；视图只消费 controller，不直呼 options。
// 目录列由已同步的模型派生（所有 ComfyUI 目录默认启用，见 `~/lib/models` 的 `syncModels`）。
// 首屏口径：`list` 与 `sync` **并行**发车，`loading` 只表示「列表首次还没有数据」，
// 不被 sync 的全目录扫描挡住（串行会让用户对着空白等整轮扫描）；sync 后的 refetch 不置 loading。
// 因此这里没有「refetch 游离 promise + aliveRef」记账，也没有本地 loading state。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";

import { type ModelFolder, type ModelRow, filterModels, foldersOf } from "../model-library-config";

export type ModelLibraryController = {
  /** 当前目录；`null` 表示还没有任何目录（空库）。 */
  activeFolder: string | null;
  /** 设置里是否填了 ComfyUI 路径（空态文案据此区分「没配路径」与「没模型」）。 */
  comfyuiPathConfigured: boolean;
  /** 当前目录 + 搜索词筛选后的行（视图直接渲染）。 */
  filtered: Array<ModelRow>;
  /** 左侧目录列（由模型数据派生，只含有模型的目录）。 */
  folders: Array<ModelFolder>;
  /** 列表首次加载中（尚无数据）—— 驱动首屏骨架，不等后台同步。 */
  loading: boolean;
  models: Array<ModelRow>;
  /** 搜索关键字。 */
  q: string;
  /** 后台同步 / 刷新进行中：不挡首屏，只给轻指示。 */
  refreshing: boolean;
  setActiveFolder: (folder: string) => void;
  setQ: (q: string) => void;
};

export function useModelLibrary(): ModelLibraryController {
  const trpc = useTRPC();
  const [q, setQ] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const listQ = useQuery(trpc.model.list.queryOptions());
  const configQ = useQuery(trpc.model.configList.queryOptions());
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
    // 挂载时静默同步一次，让库反映磁盘现状；它与 list 的首帧**并行**发车，
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
   * 服务端返回 `Model` 全行，`ModelRow` 是它的**子集**，结构上天然兼容。 */
  const models: Array<ModelRow> = useMemo(() => listQ.data?.models ?? [], [listQ.data]);

  const folders = useMemo(() => foldersOf(models), [models]);
  /* 选中目录失效（该目录已无模型 / 首次进入）时回落到第一项 —— 选择本身是 UI 状态，
   * 目录列表是数据的派生，两者不一致时以数据为准。 */
  const activeFolder = useMemo(() => {
    if (selectedFolder !== null && folders.some((folder) => folder.type === selectedFolder)) {
      return selectedFolder;
    }
    return folders[0]?.type ?? null;
  }, [folders, selectedFolder]);

  const filtered = useMemo(() => filterModels(models, activeFolder, q), [models, activeFolder, q]);

  return {
    models,
    folders,
    activeFolder,
    filtered,
    loading: listQ.isLoading,
    refreshing: syncMut.isPending || listQ.isFetching,
    q,
    setQ,
    /* 配置查询未回包前按「已配置」处理：避免空库首帧闪一句「没有配置 ComfyUI」。 */
    comfyuiPathConfigured: configQ.data?.comfyuiPathConfigured ?? true,
    setActiveFolder: setSelectedFolder,
  };
}
