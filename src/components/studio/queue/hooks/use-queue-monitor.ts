"use client";

// ── 队列与运行 · 第②层（查询与动作编排）──
// 两侧数据必须一起用：/api/comfy/queue 给正在跑/已运行多久/当前节点，但排队只有两个计数；
// task.list 给逐条名称、位次依据与失败原因，却不知道谁在跑、跑了多久（库里无开始时刻）。
// 于是「还要多久」走前者、「下一条是不是我的」走后者；视图层不出现 fetch / tRPC（规范 17 §17.2）。
// 轮询成本：状态栏已挂 useComfyQueue，本视图再挂一次即每 2s 两次（服务端量小）；重复消费未修，收口方向是模块级单例订阅（COMFY_QUEUE_POLL_MS 改动会同步影响成本）。

import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { COMFY_QUEUE_POLL_MS, useComfyQueue } from "~/components/studio/hooks/use-comfy-queue";
import { useCopyResult } from "~/components/ui/use-copy-feedback";
import { useItemAction } from "~/components/ui/use-item-action";
import { useViewTabActive } from "~/components/ui/view-tab-active";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { revealTaskFolder } from "~/lib/history-detail-actions";
import { refreshComfyQueue } from "~/lib/comfy/comfy-queue-store";
import { formatSampleRateText, formatStepsText } from "~/lib/progress";
import { cancelAllTasks, cancelTask } from "~/lib/task-cancel-client";
import { useTRPC, useTRPCClient, type RouterOutputs } from "~/trpc/react";

import { useToast } from "../../ToastProvider";
import type { QueueTaskLogTarget } from "../QueueTaskLogModal";
import { useTaskLogStream } from "./use-task-log-stream";
import {
  bucketQueueRows,
  estimateRemainingMs,
  queuedWithPosition,
  queueStats,
  searchQueueRows,
  remainingText,
  reprintText,
  runningElapsedText,
  type QueueRow,
  type QueueStats,
  type QueueStatusFilter,
} from "../queue-monitor-config";
import { queueTaskParamRows } from "../queue-task-params";

const QUEUE_PAGE_SIZE = 60;
const QUEUE_STATUS_QUERY: Record<QueueStatusFilter, string | undefined> = {
  active: "QUEUED,RUNNING",
  all: undefined,
  terminal: "SUCCEEDED,FAILED,CANCELLED",
};

/** 正在跑那条的展示卡（数值都已算成字符串或百分比，视图只渲染）。 */
export type RunningCardView = {
  elapsedText: string;
  id: string;
  modelText: string;
  nodeText: string;
  progressPct: number;
  progressValue: number | null;
  /** 平均速度（`12.58 it/s`）；步数或耗时拿不到时「—」。 */
  rateText: string;
  remainingText: string;
  startedAt: number;
  /** 采样步数（`553/8196`）；progressNode 没带时「—」。 */
  stepsText: string;
  workflowName: string;
};

export type QueueMonitorController = {
  cancel: (id: string, label: string) => Promise<void>;
  cancelAllBusy: boolean;
  cancelAllOpen: boolean;
  closeCancelAll: () => void;
  closeLog: () => void;
  confirmCancelAll: () => Promise<void>;
  copyForReprint: (row: QueueRow) => Promise<void>;
  detailLoading: boolean;
  expandedId: string | null;
  hasMore: boolean;
  isBusy: (id: string) => boolean;
  lastSyncedAt: number | null;
  loadedCount: number;
  loadError: string | null;
  loading: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  logRow: QueueTaskLogTarget | null;
  matchedCount: number;
  moveUp: (row: QueueRow) => Promise<void>;
  online: boolean;
  openFolder: (row: QueueRow) => Promise<void>;
  openLog: (task: QueueTaskLogTarget) => void;
  paramRows: Array<ReturnType<typeof queueTaskParamRows>[number]>;
  pauseBusy: boolean;
  paused: boolean;
  queued: Array<{ position: number | null; row: QueueRow }>;
  recent: Array<QueueRow>;
  refresh: (showFeedback?: boolean) => void;
  refreshError: string | null;
  refreshing: boolean;
  requestCancelAll: () => void;
  running: RunningCardView | null;
  runningDetail: Pick<
    NonNullable<RouterOutputs["task"]["detail"]>,
    "id" | "modelName" | "params" | "prompt" | "status" | "workflowName"
  > | null;
  runningLogs: ReturnType<typeof useTaskLogStream>["logs"];
  runningRows: Array<QueueRow>;
  runningSettled: ReturnType<typeof useTaskLogStream>["settled"];
  search: string;
  setSearch: (value: string) => void;
  setStatusFilter: (value: QueueStatusFilter) => void;
  stats: QueueStats;
  statusFilter: QueueStatusFilter;
  toggleExpanded: (id: string) => void;
  togglePause: () => void;
  total: number | null;
  waitingCount: number;
};

/** 队列与运行的全部逻辑。容器与视图只消费这一份 controller。 */
export function useQueueMonitor(): QueueMonitorController {
  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const queue = useComfyQueue();
  const copyText = useCopyResult();
  /* 日志弹窗的目标行：openLog 那一刻的快照（不是从 listQ 派生）——否则每 2s
   * 一次的轮询都会换掉对象身份，弹窗会被误重挂、SSE 反复重订。 */
  const [logRow, setLogRow] = useState<QueueTaskLogTarget | null>(null);
  /* 展开看输入参数的那条（ISSUE #5019）：展开才拉 task.detail（enabled 门控），
   * 参数行由纯派生 queueTaskParamRows 算出。 */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detailQ = useQuery(
    trpc.task.detail.queryOptions(
      { id: expandedId ?? "" },
      { enabled: expandedId !== null && expandedId !== "" },
    ),
  );
  const paramRows = useMemo(
    () => (detailQ.data === undefined ? [] : queueTaskParamRows(detailQ.data)),
    [detailQ.data],
  );
  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  /* 页签隐藏时不轮询（ISSUE #4598）：disabled 期间 React Query 不发请求、
   * refetchInterval 停摆；切回当前页且数据过 staleTime 时自动补拉一次。 */
  const isTabActive = useViewTabActive();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>("all");
  const [refreshingComfy, setRefreshingComfy] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const summaryQ = useQuery(
    trpc.task.summary.queryOptions(
      { todayStartedAt: midnight.toISOString() },
      { refetchInterval: COMFY_QUEUE_POLL_MS, enabled: isTabActive },
    ),
  );

  /* offset 分页不能随队列增删反复重取全部页：cursor 会相对新队首漂移，
   * 已加载条目被跳过或重复。任务列表只在翻页与手动整表刷新时取数；
   * 实时运行与全局计数仍分别由 ComfyUI store 和 summary 轮询。 */
  const listInput = useMemo(
    () => ({ take: QUEUE_PAGE_SIZE, status: QUEUE_STATUS_QUERY[statusFilter] }),
    [statusFilter],
  );
  const listQ = useInfiniteQuery(
    trpc.task.list.infiniteQueryOptions(listInput, {
      getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextScanCursor : undefined),
      enabled: isTabActive,
    }),
  );

  const loadedRows = useMemo(() => {
    const byId = new Map<string, QueueRow>();
    for (const page of listQ.data?.pages ?? []) {
      for (const row of page.tasks) {
        byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }, [listQ.data?.pages]);
  const rows = useMemo(() => searchQueueRows(loadedRows, search), [loadedRows, search]);
  const buckets = useMemo(() => bucketQueueRows(rows), [rows]);
  const queued = useMemo(
    () => queuedWithPosition(buckets.queued, Number.MAX_SAFE_INTEGER),
    [buckets.queued],
  );
  const fallbackStats = useMemo(() => queueStats(buckets, new Date()), [buckets]);
  const stats = summaryQ.data ?? fallbackStats;
  const lastPage = listQ.data?.pages.at(-1);
  const hasMore = lastPage?.hasMore ?? false;
  const total = lastPage?.total ?? null;
  const loadedCount = loadedRows.length;
  const matchedCount = rows.length;
  const lastSyncedAt = Math.max(
    queue.syncedAt ?? 0,
    listQ.dataUpdatedAt ?? 0,
    summaryQ.dataUpdatedAt ?? 0,
  );

  /* 「同一条不能重复点」与忙标记的落 / 清走全库唯一出口（规范 16 §16.2.4.40）。
   * 传键集合是为了收敛生命周期：条目从列表里消失后忙标记随之丢掉，否则
   * `anyBusy` 会被一个指向不存在条目的标记永久占住。 */
  const visibleIds = useMemo(
    () => [
      ...buckets.running.map((row) => row.id),
      ...queued.map((entry) => entry.row.id),
      ...buckets.recent.map((row) => row.id),
    ],
    [buckets.running, buckets.recent, queued],
  );
  const action = useItemAction(visibleIds);

  const report = useCallback<ActionReport>(
    (kind, detail) => (kind === "ok" ? toast.info(detail) : toast.error(detail)),
    [toast],
  );

  const refresh = useCallback(
    (showFeedback = false) => {
      setRefreshingComfy(true);
      setRefreshError(null);
      const listKey = trpc.task.list.infiniteQueryKey(listInput);
      const firstPageKey = [...listKey, "manual-refresh"];
      const listRefresh = (async () => {
        try {
          const firstPage = await queryClient.fetchQuery({
            queryFn: ({ signal }) => trpcClient.task.list.query(listInput, { signal }),
            queryKey: firstPageKey,
          });
          queryClient.setQueryData(listKey, { pageParams: [0], pages: [firstPage] });
          return true;
        } catch {
          return false;
        } finally {
          queryClient.removeQueries({ queryKey: firstPageKey });
        }
      })();
      const tasksRefresh = Promise.all([listRefresh, summaryQ.refetch()]);
      const comfyRefresh = refreshComfyQueue().then(
        () => true,
        () => false,
      );
      void (async () => {
        try {
          const [listOk, summaryResult] = await tasksRefresh;
          const comfyOk = await comfyRefresh;
          if (!listOk || summaryResult.isError || !comfyOk) {
            throw new Error("部分真相源未同步");
          }
          if (showFeedback) {
            toast.info("队列已同步");
          }
        } catch {
          if (showFeedback) {
            const message = "刷新失败：任务记录或 ComfyUI 真值未完整同步，请稍后重试";
            setRefreshError(message);
            toast.error(message);
          }
        } finally {
          setRefreshingComfy(false);
        }
      })();
    },
    [listInput, queryClient, summaryQ, toast, trpc, trpcClient],
  );
  const loadMore = useCallback(() => {
    if (hasMore && !listQ.isFetchingNextPage) {
      void listQ.fetchNextPage();
    }
  }, [hasMore, listQ]);

  const running = useMemo<RunningCardView | null>(() => {
    const task = queue.running;
    if (task === null) {
      return null;
    }
    const remainingMs = estimateRemainingMs(queue.elapsedMs ?? 0, task.progress);
    return {
      id: task.taskId,
      workflowName: task.workflowName ?? "（未知工作流）",
      modelText: task.model ?? "未能从本次工作流里识别",
      nodeText: task.nodeType ?? "尚未回报节点",
      elapsedText: runningElapsedText(queue.elapsedMs),
      remainingText: remainingText(remainingMs),
      progressPct: task.progress,
      progressValue: task.progressValue,
      startedAt: task.startedAt,
      stepsText: formatStepsText(task.progressValue, task.progressMax) ?? "—",
      rateText: formatSampleRateText(task.progressValue, queue.elapsedMs) ?? "—",
    };
  }, [queue.elapsedMs, queue.running]);

  const cancel = useCallback(
    async (id: string, label: string) => {
      await action.run(id, async () => {
        await runAsyncAction(() => cancelTask(id), {
          report,
          failureText: `取消「${label}」失败，请稍后重试`,
          successText: "已发送取消请求",
        });
        /* 失败也要刷新：用户可能已在别处把它取消了，界面不该继续显示排队中。 */
        refresh();
      });
    },
    [action, refresh, report],
  );

  const openFolder = useCallback(
    async (row: QueueRow) => {
      await action.run(row.id, async () => {
        /* 成败与文案都由 `revealTaskFolder` 的 `{ ok, detail }` 表达：detail 是
         * 服务端探出来的结论（「已在文件管理器里定位：<路径>」/「该任务尚未生成
         * 文件目录」），调用处不该再抄一遍 —— 此前这里只读 `opened`、把
         * `comfyappUrl` 丢掉，于是报的是一句与事实无关的成功。 */
        const result = await revealTaskFolder(row.id);
        await runAsyncAction(() => Promise.resolve(result), {
          report,
          failureText: "未能打开输出目录，可在任务详情里复制文件路径",
        });
      });
    },
    [action, report],
  );

  const copyForReprint = useCallback(
    async (row: QueueRow) => {
      await action.run(row.id, async () => {
        /* 成败由复制出口的返回值表达（它不抛）：让「复制失败」走失败分支，
         * 而不是被 try 当成成功。 */
        const copied = await copyText(reprintText(row));
        await runAsyncAction(() => Promise.resolve(copied), {
          report,
          failureText: "复制失败，请检查是否允许访问剪贴板",
          successText: "后端没有重试接口，已复制本次提交内容 —— 回画布改完参数再投一次",
        });
      });
    },
    [action, copyText, report],
  );

  /* ===== 以下为并行开发线合入的整表动作 / 就地详情（master 侧能力）===== */

  /* 运行中那条的详情与就地日志：只在展开运行时那条时才取 / 订阅。 */
  const runningId = running?.id ?? buckets.running[0]?.id ?? null;
  const runningDetail =
    expandedId !== null && expandedId === runningId ? (detailQ.data ?? null) : null;
  const runningLogStream = useTaskLogStream(
    expandedId !== null && expandedId === runningId ? runningId : null,
  );

  /* 取消全部：整表动作，用 null 作用域的同一把重入锁；部分失败如实报数。 */
  const [cancelAllOpen, setCancelAllOpen] = useState(false);
  const confirmCancelAll = useCallback(async () => {
    setCancelAllOpen(false);
    await action.run(null, async () => {
      let outcome: Awaited<ReturnType<typeof cancelAllTasks>> | null = null;
      await runAsyncAction(
        async () => {
          outcome = await cancelAllTasks();
          return outcome;
        },
        {
          report,
          failureText: "取消全部失败，请稍后重试",
          successText: () => {
            if (outcome === null) {
              return "已发送取消全部请求";
            }
            const { cancelled, failed } = outcome;
            return failed === 0
              ? `已取消 ${String(cancelled)} 条任务`
              : `已取消 ${String(cancelled)} 条，${String(failed)} 条未能取消（详见执行日志）`;
          },
        },
      );
      refresh();
    });
  }, [action, refresh, report]);
  const requestCancelAll = useCallback(() => setCancelAllOpen(true), []);
  const closeCancelAll = useCallback(() => setCancelAllOpen(false), []);

  /* 排队任务提前执行：服务端只发一条条件 UPDATE，已开跑如实回报。 */
  const reorderM = useMutation(trpc.task.reorder.mutationOptions());
  const moveUp = useCallback(
    async (row: QueueRow) => {
      await action.run(row.id, async () => {
        await runAsyncAction(() => reorderM.mutateAsync({ id: row.id }), {
          report,
          failureText: `提前「${row.workflowName}」失败，请稍后重试`,
        });
        refresh();
      });
    },
    [action, refresh, report, reorderM],
  );

  /* 生图暂停 / 恢复（状态落库，重启不丢）。 */
  const pauseQ = useQuery(
    trpc.generationControl.pauseState.queryOptions(undefined, { enabled: isTabActive }),
  );
  const setPausedM = useMutation(
    trpc.generationControl.setPaused.mutationOptions({
      onSuccess: () => {
        pauseQ.refetch();
      },
    }),
  );
  const togglePause = useCallback(() => {
    const next = !(pauseQ.data?.paused ?? false);
    void runAsyncAction(() => setPausedM.mutateAsync({ paused: next }), {
      report,
      successText: next ? "已暂停：当前任务跑完后不再领取新的生图任务" : "已恢复：按队列序继续生成",
      failureText: next ? "暂停失败，请稍后重试" : "恢复失败，请稍后重试",
    });
  }, [pauseQ.data, setPausedM, report]);

  const isBusy = useCallback((id: string) => action.isBusy(id), [action]);
  const openLog = useCallback((task: QueueTaskLogTarget) => setLogRow(task), []);
  const closeLog = useCallback(() => setLogRow(null), []);

  return {
    online: queue.online,
    running,
    runningRows: buckets.running,
    runningDetail,
    runningLogs: runningLogStream.logs,
    runningSettled: runningLogStream.settled,
    queued,
    stats,
    recent: buckets.recent,
    /* 离线时 `/api/comfy/queue` 读不到、两个计数恒为 0，而列表明明排着队 ——
     * 退回「库里在跑 + 排队」的行数。 */
    waitingCount: queue.online
      ? queue.queued + queue.comfy.pending
      : buckets.running.length + queued.length,
    loading: listQ.isPending,
    loadingMore: listQ.isFetchingNextPage,
    loadMore,
    hasMore,
    loadedCount,
    matchedCount,
    total,
    lastSyncedAt: lastSyncedAt > 0 ? lastSyncedAt : null,
    refreshError,
    loadError: listQ.isError ? "读不到任务记录，后端可能刚重启" : null,
    logRow,
    expandedId,
    toggleExpanded,
    detailLoading: detailQ.isFetching,
    paramRows,
    isBusy,
    refresh,
    refreshing: refreshingComfy || listQ.isFetching || summaryQ.isFetching,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    cancel,
    openFolder,
    copyForReprint,
    moveUp,
    paused: pauseQ.data?.paused ?? false,
    pauseBusy: setPausedM.isPending,
    togglePause,
    cancelAllOpen,
    cancelAllBusy: action.isBusy(null),
    confirmCancelAll,
    requestCancelAll,
    closeCancelAll,
    openLog,
    closeLog,
  };
}
