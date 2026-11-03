"use client";

// ── 历史记录列表：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载查询、筛选/排序/分页、详情弹层开关、取消/删除/重试三个动作。
// HistoryList 视图只消费本 hook 返回的 controller，不再自己发请求。

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAsyncAction, type ActionReport } from "~/lib/async-action";
/* 取消走集中出口（`task-cancel-client`）：这里此前自己挂了一份
 * `useMutation(trpc.task.cancel.mutationOptions())`，于是「取消失败怎么提示」在历史面板与画布
 * 面板各说一套（§12.14 端点收口）。取消的服务端语义见 ADR §14 D2。 */
import { cancelTask } from "~/lib/task-cancel-client";
import { useItemAction } from "~/components/ui/use-item-action";

import { useToast } from "../../ToastProvider";
import { parseWorkflowIOMap, type WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import type { ModeContract } from "~/lib/workshop/model-mode-contract";

import { taskWorkflowId } from "../history-detail-derive";
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
import { useTRPC } from "~/trpc/react";

/** 空 IO 表：引用恒定（未查到工作流时沿用同一个对象，不每次渲染造新的）。 */
const EMPTY_WORKFLOW_IO: WorkflowIOMap = {};

export type HistoryListController = {
  cancel: (id: string) => Promise<void>;
  canLoadMore: boolean;
  closeDetail: () => void;
  /** 各状态计数，key 为 FilterKey 或任务 status。 */
  counts: Record<string, number>;
  detail: TaskDetail | null;
  detailId: string | null;
  detailLoading: boolean;
  /** 空态文案（区分「一条都没有」与「当前筛选下没有」）。 */
  empty: { hint: string; title: string };
  filter: FilterKey;
  filteredCount: number;
  /** 「这一条在重试吗」的判据（收在 `useItemAction` 里，视图不再自己比较）。 */
  isRetrying: (id: string) => boolean;
  loading: boolean;
  loadMore: () => void;
  /** 模式契约注册表（只含用户改过的模式）：详情弹窗按它 + 任务模式枚举工坊对外口。
   *  未加载 / 失败时为 null，工坊参数回落内置默认契约。 */
  modeContracts: ReadonlyArray<ModeContract> | null;
  openDetail: (id: string) => void;
  /** 进行中任务的模拟进度 Map。 */
  progressMap: Record<string, number>;
  refresh: () => void;
  remove: (id: string) => Promise<void>;
  retry: (task: TaskItem) => Promise<void>;
  retryingId: string | null;
  setSort: (sort: SortKey) => void;
  sort: SortKey;
  switchFilter: (filter: FilterKey) => void;
  tasks: Array<TaskItem>;
  /** 当前可见的日期分组（已按 displayCount 裁剪）。 */
  visibleGroups: Array<{ items: Array<TaskItem>; key: string }>;
  visibleTotal: number;
  /** 本任务所用工作流的 IO 定义（参数可读名从它的 `label` 查）。
   *  工作流已被删除 / 查询未回来时是空表，参数名如实回落 pin 名。 */
  workflowIO: WorkflowIOMap;
};

/**
 * 历史记录列表的全部逻辑。「打开详情」只有列表行一个入口（HistoryList 每行挂 openDetail）。
 * 此前还订阅过一个 open-task 事件、注释称 VideoQueueModal 会派发，而派发方早已搬走 ——
 * 无触发源的监听器不报错，只误导后来者以为别处能打开详情；tests/app-event-pairing.test.ts 现在拦得住只剩一端的通道。
 */
export function useHistoryList(): HistoryListController {
  const trpc = useTRPC();
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

  const tasksQ = useQuery(
    trpc.task.list.queryOptions(undefined, {
      /* 保持旧数据：refetch / 删除后回源不闪空列表 */
      placeholderData: (prev) => prev,
    }),
  );
  const tasks = useMemo<Array<TaskItem>>(
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

  const openDetail = useCallback((id: string) => {
    setDetailId(id);
  }, []);
  const closeDetail = useCallback(() => {
    setDetailId(null);
  }, []);

  const detailQ = useQuery(
    trpc.task.detail.queryOptions(
      { id: detailId ?? "" },
      { enabled: detailId !== null && detailId !== "" },
    ),
  );
  /* 详情直接派生自查询结果：detailId 切换时 isPending 自动为 true、data 为 null，
     open 清空逻辑不再需要本地镜像 state。 */
  const detail = detailQ.isSuccess ? detailQ.data : null;
  const detailLoading = detailQ.isPending;
  /* 参数可读名要按工作流 IO 的作者标签查 —— 任务行里只存了 pin 名
   *（`text` / `aspect_ratio` / `megapixels`），那是 ComfyUI 的程序名。
   * 用轻量的 `workflow.detail`（一次 DB 读，不做派生）拿 `workflowIO` 列；
   * 工作流已被删除时查询失败，这里保持空表，参数名如实显示 pin 名 —— 不编。 */
  const detailWorkflowId = detail ? taskWorkflowId(detail) : null;
  const ioQ = useQuery(
    trpc.workflow.detail.queryOptions(
      { id: detailWorkflowId ?? "" },
      { enabled: detailWorkflowId !== null && detailWorkflowId !== "" },
    ),
  );
  const workflowIO = useMemo<WorkflowIOMap>(
    () =>
      // oxlint-disable-next-line no-unnecessary-condition -- ioQ.data 来自 tRPC workflow.detail（外部数据），旧服务端可能缺 template/workflowIO，? 是运行时守卫
      ioQ.isSuccess ? parseWorkflowIOMap(ioQ.data?.template?.workflowIO) : EMPTY_WORKFLOW_IO,
    [ioQ.isSuccess, ioQ.data],
  );
  /* 模式契约注册表：详情弹窗按「任务模式 + 生效契约」枚举工坊对外口（与工坊
   * 封装页、工作流库画布卡片同一份口径）。只在打开详情时拉，列表态不空跑。 */
  const contractsQ = useQuery(
    trpc.llm.modeContractsGet.queryOptions(undefined, {
      enabled: detailId !== null && detailId !== "",
    }),
  );
  /* SAFETY: 类型断言已复核 */
  const modeContracts = (contractsQ.data?.contracts ?? null) as ReadonlyArray<ModeContract> | null;

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
  const loadMore = useCallback(() => {
    setDisplayCount((count) => count + PAGE_SIZE);
  }, []);

  const deleteTask = useMutation(trpc.task.delete.mutationOptions());

  /* 反馈通道：成功走 info（一句陈述，不是庆祝）、失败走 error。收口前「取消失败，请稍后重试」
   * 等引导文案写死、网络层原文（ECONNREFUSED / Failed to fetch）被丢弃；现统一走 ~/lib/async-action 的 errorMessage。
   * 成功侧用 successText 陈述句；「取消失败」保留可执行动作（稍后重试）。 */
  const report: ActionReport = useCallback(
    (kind, detail) => (kind === "ok" ? toast.info(detail) : toast.error(detail)),
    [toast],
  );

  const cancel = useCallback(
    async (id: string) => {
      await runAsyncAction(() => cancelTask(id), {
        report,
        failureText: "取消失败，请稍后重试",
        successText: "已发送取消请求",
      });
      refresh();
    },
    [refresh, report],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("删除此任务记录？已生成的文件不会从磁盘删除。")) {
        return;
      }
      await runAsyncAction(
        async () => {
          await deleteTask.mutateAsync({ id });
          /* 乐观移除：直接改查询缓存，避免本地镜像 state */
          queryClient.setQueryData(
            trpc.task.list.queryKey(undefined),
            /* 键自带 DataTag：`old` 的形状由查询结果推导，不再手写窄类型 */
            (old) => (old ? { ...old, tasks: old.tasks.filter((task) => task.id !== id) } : old),
          );
          if (detailId === id) {
            setDetailId(null);
          }
        },
        { report, failureText: "删除失败", successText: "已删除任务" },
      );
    },
    [deleteTask, detailId, report, queryClient, trpc],
  );

  /* 「重试」= `task.retry` 的**原样重跑**（#2481）：后端按原任务的 execPayload +
   * 参数 / 参考图重建一个 QUEUED 任务，返回新 taskId。成功文案带上新任务号
   * （经信封 `detail` 传给 runAsyncAction 的 successText），失败走同一通道。 */
  const retryTask = useMutation(trpc.task.retry.mutationOptions());
  const retry = useCallback(
    async (task: TaskItem) => {
      await retryAction.run(task.id, async () => {
        await runAsyncAction(
          async () => {
            const { taskId } = await retryTask.mutateAsync({ id: task.id });
            return { ok: true, detail: taskId };
          },
          {
            report,
            failureText: "重试失败",
            successText: (r) => `已原样重新入队：新任务 ${r.detail}，可在队列或历史观察进度`,
          },
        );
      });
      /* 忙标记由出口的 `finally` 清；这里只负责刷新（失败也要刷新，
       * 用户可能是在别处重跑成功的）。 */
      refresh();
    },
    [refresh, report, retryAction, retryTask],
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
    workflowIO,
    modeContracts,
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
