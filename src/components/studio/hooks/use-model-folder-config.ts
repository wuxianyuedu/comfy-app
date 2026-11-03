"use client";

// ── 模型目录配置弹层：逻辑层（规范 17 §17.2 第②层）
// 承载目录列表拉取、启用/停用/删除配置与重新扫描；视图只消费本 hook，不再直呼 options。
// 三个写操作都走同一个 runMutate 包装：失败统一落 err，结束后统一 reload，不会再有
// 「某个分支忘了刷新」的漏网之鱼。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { runAsyncAction } from "~/lib/async-action";
import { errorMessage } from "~/lib/error-message";
import { useBusyAction } from "~/components/ui/use-busy-action";
import { useTRPC } from "~/trpc/react";

import { type FolderConfigRow, splitFolders } from "../model-library-config";

/** 「还没有答案」时复用的空列表 —— 引用必须稳定，理由见 hook 内那一行。 */
const EMPTY_FOLDERS: Array<FolderConfigRow> = [];

export type ModelFolderConfigController = {
  add: (folder: string) => Promise<void>;
  availableRows: Array<FolderConfigRow>;
  comfyReachable: boolean;
  /** 筛选后的已启用 / 可添加两组。 */
  enabledRows: Array<FolderConfigRow>;
  /** 最近一次操作的错误文案；null 表示无错误。 */
  err: string | null;
  folders: Array<FolderConfigRow>;
  loading: boolean;
  /** 「仅显示已启用」开关。 */
  onlyEnabled: boolean;
  /** 目录关键字。 */
  q: string;
  remove: (folder: string) => Promise<void>;
  rescan: () => Promise<void>;
  /** 扫描中（全量重新扫描 ComfyUI 目录）。 */
  scanning: boolean;
  setOnlyEnabled: (value: boolean) => void;
  setQ: (q: string) => void;
  toggle: (folder: string, enabled: boolean) => Promise<void>;
  totalCount: number;
};

export function useModelFolderConfig(): ModelFolderConfigController {
  const trpc = useTRPC();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  /* 忙碌位走唯一出口（规范 16 §16.2.4.71）。 */
  const scanBusy = useBusyAction();
  const [err, setErr] = useState<string | null>(null);
  const [onlyEnabled, setOnlyEnabled] = useState(false);

  const configQ = useQuery(trpc.model.configList.queryOptions());
  const saveMut = useMutation(trpc.model.configSave.mutationOptions());
  const delMut = useMutation(trpc.model.configDelete.mutationOptions());
  const syncMut = useMutation(trpc.model.sync.mutationOptions());

  /**
   * 拉取目录列表。**注意这里不清 err**：原来是 load() 开头 `setErr(null)`，而每个写操作都是
   * 「失败 → setErr → await load()」，错误刚写进去就被清掉（与 §17.5.4 素材库同源）。现改为
   * err 由发起动作方开始时清除，load 只在这一次请求真失败时写 err，成功路径不碰它。
   */
  const load = useCallback(async () => {
    setLoading(true);
    /* `refetch()` 失败时**不 reject**，它 resolve 一个带 `isError` 的结果（v5 语义）。
     * 原来这里写成 `try { await refetch() } catch { setErr("网络错误") }` —— 那个 catch
     * 永远进不来，列表拉不下来时既不报错、也不改连接状态，于是「没拿到答案」被显示成
     * 「已连接 + 一个目录都没有」两条假结论。成败要看返回值，不能等异常。 */
    const result = await configQ.refetch();
    if (result.isError) {
      setErr(errorMessage(result.error, "网络错误"));
    }
    setLoading(false);
  }, [configQ]);

  /* 首次加载只跑一次。依赖 `load` 会失效 —— 它依赖 `configQ`，而 `useQuery`
   * 返回的对象**每次渲染都是新引用** ⇒ 「effect 跑一次」变成「每渲染一次跑一次」
   * ⇒ 反复 refetch ⇒ 数据到达又触发渲染 ⇒ 自激。实测弹层打开后静置时
   * `model.configList` 每 25ms 打一次（5 秒 194 次，ISSUE #1803）。
   * `load` 收进 ref 取最新一份；effect 只依赖 `[]`。 */
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    // 把首次加载延出 effect 体（React 19 规则）。
    // oxlint-disable-next-line no-void -- reject 由 action 内部捕获
    const t = setTimeout(() => void loadRef.current(), 0);
    return () => {
      clearTimeout(t);
    };
  }, []);

  /* 列表与连接状态**直接从查询派生**，不再镜像进 local state。原来的「渲染期同步」
   * 在弹层第二次挂载时不会发生：QueryClient 是模块级单例（staleTime 30s），首帧就带缓存，
   * `prevCfgData` 初值即当前数据；refetch 拿回逐字相同载荷，结构共享连引用也不换。
   * 后果是 `comfyReachable` 停在 `useState(true)` 乐观默认值上（服务端已回不可达）。
   * 派生后「答案到了却没落到状态」这一格消失；空列表用 `EMPTY_FOLDERS` 避免 useMemo 每渲染必算。 */
  const folders = configQ.data?.folders ?? EMPTY_FOLDERS;
  const comfyReachable = Boolean(configQ.data?.comfyReachable);

  /** 写操作统一包装：失败落 err，结束后必刷新。 */
  const runMutate = useCallback(
    async (fn: () => Promise<unknown>) => {
      setErr(null);
      /* 反馈通道是这块行内错误条（`setErr`），成功静默（列表刷新即结果）。
       * 出口负责「失败文案走 `errorMessage`」这一半（规范 16 §16.2.4.30）。 */
      await runAsyncAction(fn, {
        report: (kind, detail) => {
          if (kind === "err") {
            setErr(detail);
          }
        },
        failureText: "网络错误",
      });
      await load();
    },
    [load],
  );

  const toggle = useCallback(
    (folder: string, enabled: boolean) => runMutate(() => saveMut.mutateAsync({ folder, enabled })),
    [runMutate, saveMut],
  );
  const add = useCallback(
    (folder: string) => runMutate(() => saveMut.mutateAsync({ folder, enabled: true })),
    [runMutate, saveMut],
  );
  const remove = useCallback(
    (folder: string) => runMutate(() => delMut.mutateAsync({ folder })),
    [runMutate, delMut],
  );

  const rescan = useCallback(async () => {
    setErr(null);
    await scanBusy.run(() =>
      runAsyncAction(() => syncMut.mutateAsync(), {
        report: (kind, detail) => {
          if (kind === "err") {
            setErr(detail);
          }
        },
        failureText: "扫描失败",
      }),
    );
    await load();
  }, [load, scanBusy, syncMut]);

  const { enabled, available } = useMemo(() => splitFolders(folders, q), [folders, q]);

  return {
    folders,
    comfyReachable,
    loading,
    scanning: scanBusy.busy,
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
