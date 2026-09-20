"use client";

// ── 历史记录列表：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载查询、筛选/排序/分页、详情弹层开关、取消/删除/重试三个动作。
// HistoryList 视图只消费本 hook 返回的 controller，不再自己发请求。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";

import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import {
  copyFailureText,
  useCopyResult,
} from "~/components/ui/use-copy-feedback";
import { useItemAction } from "~/components/ui/use-item-action";

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
  /** 「这一条在重试吗」的判据（收在 `useItemAction` 里，视图不再自己比较）。 */
  isRetrying: (id: string) => boolean;
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
  /* 「哪一条在重试」收在 `useItemAction`（规范 16 §16.2.4.40）：
   * 此前是本文件自持的 `useState<string | null>`，与工坊两处（AI 润色）、
   * 工作流库的下载与同步各写一份 —— 而「同一条能不能重复点」四处都没防。 */
  const retryAction = useItemAction();

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

  /* 反馈通道适配：本面板的「成功」走 `info`（一句陈述，不是庆祝），
   * 「失败」走 `error`。收口前「取消失败，请稍后重试」这类**引导性文案**
   * 是写死的，网络层原文（`ECONNREFUSED` / `Failed to fetch`）被整个丢掉 ——
   * 现在统一走 `~/lib/async-action` 的 `errorMessage`。
   *
   * 成功那一侧用 `successText` 给一句陈述句；「取消失败」那条的失败文案
   * 保留可执行动作（「稍后重试」），它是这条账里唯一值得写的引导。 */
  const report: ActionReport = useCallback(
    (kind, detail) =>
      kind === "ok" ? toast.info(detail) : toast.error(detail),
    [toast],
  );

  const cancel = useCallback(
    async (id: string) => {
      await runAsyncAction(() => cancelTask.mutateAsync({ id }), {
        report,
        failureText: "取消失败，请稍后重试",
        successText: "已发送取消请求",
      });
      refresh();
    },
    [cancelTask, refresh, report],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("删除此任务记录？已生成的文件不会从磁盘删除。")) return;
      await runAsyncAction(
        async () => {
          await deleteTask.mutateAsync({ id });
          /* 乐观移除：直接改查询缓存，避免本地镜像 state */
          queryClient.setQueryData(
            getQueryKey(api.task.list),
            (old: { tasks: Array<{ id: string }> } | undefined) =>
              old
                ? { ...old, tasks: old.tasks.filter((task) => task.id !== id) }
                : old,
          );
          if (detailId === id) setDetailId(null);
        },
        { report, failureText: "删除失败", successText: "已删除任务" },
      );
    },
    [deleteTask, detailId, report, queryClient],
  );

  /* 「重试」的实际动作是**复制参数到剪贴板**（后端从来没有重试接口，见下）。
   * 反馈走 `runAsyncAction` 的文案通道，而「复制成不成」是它的**输入** —— 所以
   * 这里用出口把一个 Promise 化的复制结果接出来喂给动作（规范 16 §16.2.4.43）。 */
  /* 只拿成败、不报反馈 —— 反馈由下面的 `runAsyncAction` 统一给。 */
  const copyForRetry = useCopyResult();
  const retry = useCallback(
    async (task: TaskItem) => {
      await retryAction.run(task.id, async () => {
        // 原 REST /api/tasks/[id]/retry 从未实现（历史一直 404）；后端无
        // 重试接口，复制参数到剪贴板，请到创作台手动重跑。
        const params = JSON.stringify(task.params ?? {}, null, 2);
        /* 剪贴板的成败由出口的返回值表达（它不抛）：失败时走
         * `runAsyncAction` 的失败分支，而不是让「复制失败」被 `try` 当成成功。 */
        const copied = await copyForRetry(
          `prompt: ${task.prompt ?? ""}\nworkflow: ${task.workflowName}\ntype: ${task.type}\nparams: ${params}`,
        );
        await runAsyncAction(async () => copied, {
          report,
          failureText: copyFailureText("创作台的参数区"),
          successText:
            "后端尚未提供重试接口，已复制参数到剪贴板，请到创作台手动重跑",
        });
      });
      /* 忙标记由出口的 `finally` 清；这里只负责刷新（失败也要刷新，
       * 用户可能是在别处重跑成功的）。 */
      refresh();
    },
    [refresh, report, retryAction, copyForRetry],
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
    retryingId: retryAction.busyId,
    isRetrying: retryAction.isBusy,
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
