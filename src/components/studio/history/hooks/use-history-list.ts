"use client";

// ── 历史记录列表：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载查询、筛选/排序/分页、详情弹层开关、取消/删除/重试三个动作。
// HistoryList 视图只消费本 hook 返回的 controller，不再自己发请求。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { useToast } from "../../ToastProvider";
import {
  countByStatus,
  emptyStateText,
  filterTasks,
  groupByDate,
  paginateGroups,
  sortTasks,
} from "../history-list-derive";
import {
  FILTERS,
  type FilterKey,
  type SortKey,
  type TaskDetail,
  type TaskItem,
} from "../history-types";
import { PAGE_SIZE, useSimulatedProgress } from "../history-utils";
import { api } from "~/trpc/react";

export interface HistoryListController {
  tasks: TaskItem[];
  loading: boolean;
  filter: FilterKey;
  sort: SortKey;
  /** 各状态计数，key 为 FilterKey 或任务 status。 */
  counts: Record<string, number>;
  /** 当前可见的日期分组（已按 displayCount 裁剪）。 */
  visibleGroups: Array<{ key: string; items: TaskItem[] }>;
  visibleTotal: number;
  filteredCount: number;
  canLoadMore: boolean;
  /** 空态文案（区分「一条都没有」与「当前筛选下没有」）。 */
  empty: { title: string; hint: string };
  /** 进行中任务的模拟进度 Map。 */
  progressMap: Record<string, number>;
  retryingId: string | null;
  detailId: string | null;
  detail: TaskDetail | null;
  detailLoading: boolean;
  /** 工作流默认值兜底（来自 /api/tasks/[id] 的 workflowHints 子字段）。 */
  workflowHints: unknown;
  setSort: (sort: SortKey) => void;
  switchFilter: (filter: FilterKey) => void;
  loadMore: () => void;
  refresh: () => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  cancel: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  retry: (task: TaskItem) => Promise<void>;
}

/**
 * 历史记录列表的全部逻辑。
 * 外部组件（如 VideoQueueModal 的「详情」按钮）通过 window 上的 `open-task`
 * 自定义事件请求打开详情——这里统一监听，避免为每个调用方加 prop。
 */
export function useHistoryList(): HistoryListController {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [sort, setSort] = useState<SortKey>("newest");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const tasksQ = api.task.list.useQuery(undefined, {
    /* 保持旧数据：refetch / 删除后回源不闪空列表 */
    placeholderData: (prev) => prev,
  });
  const tasks = useMemo<TaskItem[]>(
    () =>
      (tasksQ.data?.tasks ?? []).map((task) => ({
        ...task,
        createdAt: String(task.createdAt),
      })),
    [tasksQ.data?.tasks],
  );
  const loading = tasksQ.isLoading;
  const progressMap = useSimulatedProgress(tasks);

  const refresh = useCallback(() => {
    void tasksQ.refetch();
  }, [tasksQ]);

  const openDetail = useCallback((id: string) => setDetailId(id), []);
  const closeDetail = useCallback(() => setDetailId(null), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) openDetail(id);
    };
    window.addEventListener("open-task", handler);
    return () => window.removeEventListener("open-task", handler);
  }, [openDetail]);

  const detailQ = api.task.detail.useQuery(
    { id: detailId ?? "" },
    { enabled: !!detailId },
  );
  /* 详情直接派生自查询结果：detailId 切换时 isPending 自动为 true、data 为 null，
     open 清空逻辑不再需要本地镜像 state。 */
  const detail = detailQ.isSuccess ? detailQ.data : null;
  const detailLoading = detailQ.isPending;
  /** 工作流默认值兜底 —— 来自 /api/tasks/[id] 的 workflowHints 子字段。 */
  const workflowHints = detailQ.isSuccess
    ? ((detailQ.data as { workflowHints?: unknown } | null | undefined)
        ?.workflowHints ?? null)
    : null;

  const filtered = useMemo(
    () => sortTasks(filterTasks(tasks, filter), sort),
    [tasks, filter, sort],
  );
  const counts = useMemo(() => countByStatus(tasks), [tasks]);
  const { visibleGroups, visibleTotal, canLoadMore } = useMemo(
    () => paginateGroups(groupByDate(filtered), displayCount),
    [filtered, displayCount],
  );
  const empty = useMemo(() => {
    const label = FILTERS.find((f) => f.key === filter)?.label ?? "";
    return emptyStateText(filter, label);
  }, [filter]);

  const switchFilter = useCallback((filterKey: FilterKey) => {
    setFilter(filterKey);
    setDisplayCount(PAGE_SIZE);
  }, []);
  const loadMore = useCallback(
    () => setDisplayCount((count) => count + PAGE_SIZE),
    [],
  );

  const cancelTask = api.task.cancel.useMutation();
  const deleteTask = api.task.delete.useMutation();

  const cancel = useCallback(
    async (id: string) => {
      try {
        await cancelTask.mutateAsync({ id });
        toast.info("已发送取消请求");
      } catch {
        toast.error("取消失败，请稍后重试");
      }
      refresh();
    },
    [cancelTask, refresh, toast],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("删除此任务记录？已生成的文件不会从磁盘删除。")) return;
      try {
        await deleteTask.mutateAsync({ id });
        toast.success("已删除任务");
        /* 乐观移除：直接改查询缓存，避免本地镜像 state */
        queryClient.setQueryData(
          getQueryKey(api.task.list),
          (old: { tasks: Array<{ id: string }> } | undefined) =>
            old
              ? { ...old, tasks: old.tasks.filter((task) => task.id !== id) }
              : old,
        );
        if (detailId === id) setDetailId(null);
      } catch {
        toast.error("删除失败");
      }
    },
    [deleteTask, detailId, toast, queryClient],
  );

  const retry = useCallback(
    async (task: TaskItem) => {
      setRetryingId(task.id);
      try {
        // 原 REST /api/tasks/[id]/retry 从未实现（历史一直 404）；后端无
        // 重试接口，复制参数到剪贴板，请到创作台手动重跑。
        const params = JSON.stringify(task.params ?? {}, null, 2);
        try {
          await navigator.clipboard?.writeText(
            `prompt: ${task.prompt ?? ""}\nworkflow: ${task.workflowName}\ntype: ${task.type}\nparams: ${params}`,
          );
        } catch {
          /* noop */
        }
        toast.info(
          "后端尚未提供重试接口，已复制参数到剪贴板，请到创作台手动重跑",
        );
      } catch {
        toast.error("网络错误，重试请求未发送");
      } finally {
        setRetryingId(null);
        refresh();
      }
    },
    [refresh, toast],
  );

  return {
    tasks,
    loading,
    filter,
    sort,
    counts,
    visibleGroups,
    visibleTotal,
    filteredCount: filtered.length,
    canLoadMore,
    empty,
    progressMap,
    retryingId,
    detailId,
    detail,
    detailLoading,
    workflowHints,
    setSort,
    switchFilter,
    loadMore,
    refresh,
    openDetail,
    closeDetail,
    cancel,
    remove,
    retry,
  };
}
