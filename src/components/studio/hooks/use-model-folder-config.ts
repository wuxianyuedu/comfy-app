"use client";

// ── 模型目录配置弹层：逻辑层（规范 17 §17.2 第②层）──────────────────────────
// 承载目录列表拉取、启用/停用/删除配置与重新扫描。ModelConfigModal 视图只消费
// 本 hook，不再出现 `api.model.*.useQuery/useMutation`。
//
// 三个写操作（toggle / add / delete）都走同一个 runMutate 包装：
// 失败统一落到 err，结束后统一 reload——原组件就是这个语义，收敛后不会再有
// 「某个分支忘了刷新」的漏网之鱼。

import { useCallback, useEffect, useMemo, useState } from "react";

import { errorMessage } from "~/lib/error-message";
import { api } from "~/trpc/react";

import { type FolderConfigRow, splitFolders } from "../model-library-config";

export interface ModelFolderConfigController {
  folders: FolderConfigRow[];
  comfyReachable: boolean;
  loading: boolean;
  /** 扫描中（全量重新扫描 ComfyUI 目录）。 */
  scanning: boolean;
  /** 最近一次操作的错误文案；null 表示无错误。 */
  err: string | null;
  /** 目录关键字。 */
  q: string;
  setQ: (q: string) => void;
  /** 「仅显示已启用」开关。 */
  onlyEnabled: boolean;
  setOnlyEnabled: (value: boolean) => void;
  /** 筛选后的已启用 / 可添加两组。 */
  enabledRows: FolderConfigRow[];
  availableRows: FolderConfigRow[];
  totalCount: number;
  toggle: (folder: string, enabled: boolean) => Promise<void>;
  add: (folder: string) => Promise<void>;
  remove: (folder: string) => Promise<void>;
  rescan: () => Promise<void>;
}

export function useModelFolderConfig(): ModelFolderConfigController {
  const [folders, setFolders] = useState<FolderConfigRow[]>([]);
  const [comfyReachable, setComfyReachable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [onlyEnabled, setOnlyEnabled] = useState(false);

  const configQ = api.model.configList.useQuery();
  const saveMut = api.model.configSave.useMutation();
  const delMut = api.model.configDelete.useMutation();
  const syncMut = api.model.sync.useMutation();

  /**
   * 拉取目录列表。**注意这里不清 err**：
   * 原实现在 load() 开头 `setErr(null)`，而每个写操作（toggle/add/remove）都是
   * 「失败 → setErr → await load()」——错误刚写进去就被随后的 load 清掉了，
   * 用户看到的提示条闪一下就没（与 §17.5.4 素材库那条同源）。
   * 现改为：err 由**发起动作的一方**在开始时清除，刷新只负责更新数据。
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      await configQ.refetch();
    } catch {
      setErr("网络错误");
    } finally {
      setLoading(false);
    }
  }, [configQ]);

  useEffect(() => {
    // Defer the initial load out of the effect body (React 19 rule).
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // react-query config data -> local folders state（渲染期调整，React 19 模式）
  const [prevCfgData, setPrevCfgData] = useState(configQ.data);
  if (configQ.data && configQ.data !== prevCfgData) {
    setPrevCfgData(configQ.data);
    setFolders(configQ.data.folders ?? []);
    setComfyReachable(Boolean(configQ.data.comfyReachable));
  }

  /** 写操作统一包装：失败落 err，结束后必刷新。 */
  const runMutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      setErr(null);
      try {
        await fn();
      } catch (e) {
        setErr(errorMessage(e, "网络错误"));
      }
      await load();
    },
    [load],
  );

  const toggle = useCallback(
    (folder: string, enabled: boolean) =>
      runMutate(() => saveMut.mutateAsync({ folder, enabled })),
    [runMutate, saveMut],
  );
  const add = useCallback(
    (folder: string) =>
      runMutate(() => saveMut.mutateAsync({ folder, enabled: true })),
    [runMutate, saveMut],
  );
  const remove = useCallback(
    (folder: string) => runMutate(() => delMut.mutateAsync({ folder })),
    [runMutate, delMut],
  );

  const rescan = useCallback(async () => {
    setScanning(true);
    setErr(null);
    try {
      await syncMut.mutateAsync();
    } catch (e) {
      setErr(errorMessage(e, "扫描失败"));
    }
    setScanning(false);
    await load();
  }, [load, syncMut]);

  const { enabled, available } = useMemo(
    () => splitFolders(folders, q),
    [folders, q],
  );

  return {
    folders,
    comfyReachable,
    loading,
    scanning,
    err,
    q,
    setQ,
    onlyEnabled,
    setOnlyEnabled,
    enabledRows: enabled,
    availableRows: available,
    totalCount: folders.length,
    toggle,
    add,
    remove,
    rescan,
  };
}
