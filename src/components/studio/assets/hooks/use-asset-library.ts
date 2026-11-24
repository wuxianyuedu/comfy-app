"use client";

// ── 资产库：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载列表查询（归属 / 分类 / 关键词）、卡片尺寸档（本地记忆）、详情弹层与删除。
// AssetLibrary 视图只消费本 hook 返回的 controller，不再自己发请求。

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { readStorageJson, writeStorageJson } from "~/lib/browser-storage";
import { runAsyncAction } from "~/lib/async-action";
import type { RouterOutputs } from "~/trpc/react";

import { useToast } from "../../ToastProvider";
import { useTRPC } from "~/trpc/react";
import {
  ASSET_SIZE_PRESETS,
  isAssetSizeKey,
  type AssetCategoryKey,
  type AssetSizeKey,
} from "../asset-categories";

/** 尺寸档的本地记忆键（v1：换档位结构时开新键）。 */
const SIZE_STORAGE_KEY = "comfyapp:asset-grid-size:v1";

/** 尺寸档的默认档：与设计稿主视图一致（4 列）。 */
const DEFAULT_SIZE: AssetSizeKey = "standard";

function readStoredSize(): AssetSizeKey {
  const stored = readStorageJson<string>(SIZE_STORAGE_KEY, DEFAULT_SIZE);
  return isAssetSizeKey(stored) ? stored : DEFAULT_SIZE;
}

/** 列表接口的行形状（服务端响应原样；createdAt 跨 JSON 边界转字符串）。 */
export type AssetListItem = Omit<RouterOutputs["asset"]["list"]["items"][number], "createdAt"> & {
  createdAt: string;
};

/** 详情接口的行形状（含完整生成参数快照）。 */
export type AssetDetail = RouterOutputs["asset"]["detail"];

export type AssetLibraryController = {
  /** 取消删除（ConfirmDialog 的关闭侧）。 */
  cancelRemove: () => void;
  category: string;
  /** 分类角标（scope / q 过滤后的计数）。 */
  categoryCounts: Array<{ category: string; count: number }>;
  /** 关闭详情弹层。 */
  closeDetail: () => void;
  /** 删除（非阻塞确认由视图挂 ConfirmDialog 承接）。 */
  confirmRemove: () => Promise<void>;
  /** 删除进行中（按钮禁用）。 */
  deleting: boolean;
  /** 详情弹层的内容（打开时现取；关闭时为 null）。 */
  detail: AssetDetail | null;
  /** 详情弹层正在展示的资产 id。 */
  detailId: string | null;
  detailLoading: boolean;
  /** 空态文案（区分「还没有资产」与「当前筛选下没有」）。 */
  empty: { hint: string; title: string };
  /** 资产行（列表接口返回的形状）。 */
  items: Array<AssetListItem & { createdAt: string }>;
  loading: boolean;
  /** 打开 / 关闭详情弹层。 */
  openDetail: (id: string) => void;
  /** 打开删除确认弹窗（非阻塞，与历史页同一纪律）。 */
  openRemove: (id: string) => void;
  /** 关键词（受控输入）。 */
  q: string;
  refresh: () => void;
  /** 待删除目标（ConfirmDialog 的 open 侧）。 */
  removeTarget: string | null;
  scope: "all" | "public" | "project";
  setQ: (q: string) => void;
  setScope: (scope: "all" | "public" | "project") => void;
  /** 网格尺寸档（本地记忆，跨会话保留）。 */
  setSize: (size: AssetSizeKey) => void;
  size: AssetSizeKey;
  switchCategory: (category: string) => void;
};

/**
 * 资产库的全部逻辑。列表按 take 截断（一次 120 行，超出走「加载更多」）；
 * 详情在打开时现取；删除走非阻塞确认（与历史页同一纪律）。
 */
export function useAssetLibrary(): AssetLibraryController {
  const trpc = useTRPC();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<"all" | "public" | "project">("all");
  const [category, setCategory] = useState<string>("all");
  const [q, setQ] = useState<string>("");
  const [size, setSize] = useState<AssetSizeKey>(DEFAULT_SIZE);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  /* 尺寸档从 localStorage 恢复（SSR / 隐私模式回落默认档）。 */
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 本地记忆 hydrate（与 canvas-settings 同族）
    setSize(readStoredSize());
  }, []);

  const setSizeAndRemember = useCallback((next: AssetSizeKey) => {
    setSize(next);
    writeStorageJson(SIZE_STORAGE_KEY, next);
  }, []);

  const listQ = useQuery(
    trpc.asset.list.queryOptions({
      scope,
      category,
      mediaType: "all",
      q: q.trim() === "" ? undefined : q.trim(),
    }),
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.asset.list.queryKey() });
  }, [queryClient, trpc]);

  const deleteMutation = useMutation(trpc.asset.delete.mutationOptions());
  const confirmRemove = useCallback(async () => {
    const id = removeTarget;
    if (id === null) {
      return;
    }
    setRemoveTarget(null);
    await runAsyncAction(
      async () => {
        await deleteMutation.mutateAsync({ id });
        return { ok: true as const };
      },
      {
        report: (kind, detail) => (kind === "ok" ? toast.info(detail) : toast.error(detail)),
        failureText: "删除资产失败",
        successText: "已删除资产",
      },
    );
    refresh();
  }, [deleteMutation, refresh, removeTarget, toast]);

  const detailQ = useQuery(
    trpc.asset.detail.queryOptions({ id: detailId ?? "" }, { enabled: detailId !== null }),
  );

  const items = useMemo(() => {
    const rows = listQ.data?.items ?? [];
    return rows.map((row) => ({ ...row, createdAt: String(row.createdAt) }));
  }, [listQ.data]);

  const empty = useMemo(() => {
    if (q.trim() !== "" || category !== "all" || scope !== "all") {
      return { title: "没有符合条件的资产", hint: "换个分类或关键词，或先把生成结果加入资产库。" };
    }
    return {
      title: "资产库还是空的",
      hint: "到「历史」页把满意的生成结果「加入资产库」，或直接上传文件——它们会带着完整生成参数沉淀在这里。",
    };
  }, [category, q, scope]);

  return {
    categoryCounts: listQ.data?.categories ?? [],
    category,
    confirmRemove,
    deleting: deleteMutation.isPending,
    detail: detailQ.isSuccess ? detailQ.data : null,
    detailLoading: detailQ.isPending,
    empty,
    loading: listQ.isPending,
    removeTarget,
    cancelRemove: () => {
      setRemoveTarget(null);
    },
    openDetail: (id) => {
      setDetailId(id);
    },
    closeDetail: () => {
      setDetailId(null);
    },
    detailId,
    openRemove: (id) => {
      setRemoveTarget(id);
    },
    q,
    setQ,
    size,
    setSize: setSizeAndRemember,
    scope,
    setScope,
    switchCategory: (next) => {
      setCategory(next);
    },
    items,
    refresh,
  };
}

/** 「加入资产库」弹窗的逻辑（历史页挂它；与列表页互不共享状态）。 */
export function useAddToAssetLibrary(onDone?: () => void) {
  const trpc = useTRPC();
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation(trpc.asset.createFromTask.mutationOptions());

  const addToLibrary = useCallback(
    async (args: {
      category: AssetCategoryKey;
      projectId?: string;
      scope: "public" | "project";
      subdir?: string;
      taskId: string;
    }): Promise<boolean> => {
      const result = await runAsyncAction(
        async () => {
          const res = await mutation.mutateAsync({
            category: args.category,
            ...(args.projectId === undefined ? {} : { projectId: args.projectId }),
            scope: args.scope,
            ...(args.subdir === undefined || args.subdir === "" ? {} : { subdir: args.subdir }),
            taskId: args.taskId,
          });
          return res;
        },
        {
          report: (kind, detail) => (kind === "ok" ? toast.info(detail) : toast.error(detail)),
          failureText: "加入资产库失败，请稍后重试",
          successText: "已加入资产库",
        },
      );
      if (result.ok) {
        /* 写后失效列表缓存：全局 staleTime 30s（src/trpc/query-client.ts）内，
         * 资产库页会继续显示加入前的旧列表（空态 / 角标不变），像「加入了
         * 却没进去」。与同文件删除路径的 refresh() 同一纪律：写成功即失效
         * asset.list，两个视图立刻看到新资产。 */
        await queryClient.invalidateQueries({ queryKey: trpc.asset.list.queryKey() });
        onDone?.();
      }
      return result.ok;
    },
    [mutation, onDone, queryClient, toast, trpc],
  );

  return { addToLibrary, pending: mutation.isPending };
}

/** 尺寸档 → 网格列宽（Tailwind 任意值走 style，避免动态类名被 purge）。 */
export function assetGridStyle(size: AssetSizeKey): CSSProperties {
  const preset = ASSET_SIZE_PRESETS[size];
  return {
    gridTemplateColumns: `repeat(auto-fill, minmax(${preset.minWidth}px, 1fr))`,
  };
}
