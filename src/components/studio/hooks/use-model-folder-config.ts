"use client";

// ── 模型目录配置弹层：逻辑层（规范 17 §17.2 第②层）──────────────────────────
// 承载目录列表拉取、启用/停用/删除配置与重新扫描。ModelConfigModal 视图只消费
// 本 hook，不再出现 `trpc.model.*` 的 options 调用。
//
// 三个写操作（toggle / add / delete）都走同一个 runMutate 包装：
// 失败统一落到 err，结束后统一 reload——原组件就是这个语义，收敛后不会再有
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

export interface ModelFolderConfigController {
  folders: Array<FolderConfigRow>;
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
  enabledRows: Array<FolderConfigRow>;
  availableRows: Array<FolderConfigRow>;
  totalCount: number;
  toggle: (folder: string, enabled: boolean) => Promise<void>;
  add: (folder: string) => Promise<void>;
  remove: (folder: string) => Promise<void>;
  rescan: () => Promise<void>;
}

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
   * 拉取目录列表。**注意这里不清 err**：
   * 原实现在 load() 开头 `setErr(null)`，而每个写操作（toggle/add/remove）都是
   * 「失败 → setErr → await load()」——错误刚写进去就被随后的 load 清掉了，
   * 用户看到的提示条闪一下就没（与 §17.5.4 素材库那条同源）。
   * 现改为：err 由**发起动作的一方**在开始时清除；load 只在**这一次请求真失败**时写 err，
   * 成功路径不碰它。
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
    const t = setTimeout(() => void loadRef.current(), 0);
    return () => clearTimeout(t);
  }, []);

  /* 列表与连接状态**直接从查询派生**，不再镜像进 local state。
   *
   * 原来是一段「渲染期同步」：`if (configQ.data && configQ.data !== prevCfgData)` 才把
   * `folders` / `comfyReachable` 写回状态。而弹层随开随卸载（`{c.configOpen && <ModelConfigModal/>}`）、
   * QueryClient 是模块级单例（`src/trpc/query-client.ts`：staleTime 30s、gcTime 默认 5min）
   * ⇒ **第二次挂载的首帧就带着缓存数据**，`prevCfgData` 的初值即那份数据 ⇒ 同步永不发生；
   * 随后 `refetch()` 拿回逐字相同的载荷，react-query 的结构共享（`replaceEqualDeep`）连引用都不换
   * ⇒ 仍然不同步。实测后果：第二次打开弹层显示「● ComfyUI 已连接 · 共 0 个目录」，
   * 而 `comfyReachable` 停在 `useState(true)` 那个乐观默认值上 —— 没配 ComfyUI 路径的机器上
   * 服务端明确回了不可达，界面仍报已连接；同一格还会把真有目录的实例显示成空列表。
   *
   * 派生之后没有「答案到了却没落到状态」这一格：`comfyReachable` 只在服务端说可达时才为真，
   * 「还没拿到答案」表现为 false（视图用 `loading` 把它与「确认不可达」分开说）。
   * 空列表走模块级常量 `EMPTY_FOLDERS`：字面量 `[]` 每次渲染都是新引用，会把下面
   * `splitFolders` 的 useMemo 打成「每渲染必算」（exhaustive-deps 当场警告）。 */
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
