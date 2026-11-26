"use client";

// ── 队列与运行 · 第②层（查询与动作编排）──
// 两侧数据必须一起用：/api/comfy/queue 给正在跑/已运行多久/当前节点，但排队只有两个计数；
// task.list 给逐条名称、位次依据与失败原因，却不知道谁在跑、跑了多久（库里无开始时刻）。
// 于是「还要多久」走前者、「下一条是不是我的」走后者；视图层不出现 fetch / tRPC（规范 17 §17.2）。
// 轮询成本：状态栏已挂 useComfyQueue，本视图再挂一次即每 2s 两次（服务端量小）；重复消费未修，收口方向是模块级单例订阅（COMFY_QUEUE_POLL_MS 改动会同步影响成本）。

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { COMFY_QUEUE_POLL_MS, useComfyQueue } from "~/components/studio/hooks/use-comfy-queue";
import { useCopyResult } from "~/components/ui/use-copy-feedback";
import { useItemAction } from "~/components/ui/use-item-action";
import { useViewTabActive } from "~/components/ui/view-tab-active";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { revealTaskFolder } from "~/lib/history-detail-actions";
import { formatSampleRateText, formatStepsText } from "~/lib/progress";
import { cancelAllTasks, cancelTask } from "~/lib/task-cancel-client";
import { useTRPC, type RouterOutputs } from "~/trpc/react";

import { useToast } from "../../ToastProvider";
import type { QueueTaskLogTarget } from "../QueueTaskLogModal";
import {
  bucketQueueRows,
  estimateRemainingMs,
  queuedWithPosition,
  queueStats,
  queueStatsFromCounts,
  recentWithin,
  remainingText,
  reprintText,
  runningElapsedText,
  type QueueRow,
  type QueueStats,
} from "../queue-monitor-config";
import { queueTaskParamRows } from "../queue-task-params";

/** 正在跑那条的展示卡（数值都已算成字符串或百分比，视图只渲染）。 */
export type RunningCardView = {
  elapsedText: string;
  id: string;
  modelText: string;
  nodeText: string;
  progressPct: number;
  /** 平均速度（`12.58 it/s`）；步数或耗时拿不到时「—」。 */
  rateText: string;
  remainingText: string;
  /** 采样步数（`553/8196`）；progressNode 没带时「—」。 */
  stepsText: string;
  workflowName: string;
};

export type QueueMonitorController = {
  cancel: (id: string, label: string) => Promise<void>;
  /** 取消全部进行中（否决重复点 / 弹窗 pending）。 */
  cancelAllBusy: boolean;
  /** 「取消全部」确认弹窗是否开着。 */
  cancelAllOpen: boolean;
  /** 关闭「取消全部」确认弹窗。 */
  closeCancelAll: () => void;
  closeLog: () => void;
  /** 确认「取消全部」：关弹窗 → 发请求 → 刷新列表。 */
  confirmCancelAll: () => Promise<void>;
  copyForReprint: (row: QueueRow) => Promise<void>;
  /** 展开那条的详情是否还在拉取。 */
  detailLoading: boolean;
  /** 展开的那条（输入参数表）；null = 全部收起。 */
  expandedId: string | null;
  /** 这一条正在被操作吗（判据在出口里，视图不再自己比 id）。 */
  isBusy: (id: string) => boolean;
  /** 拉取失败的一句话；null 表示查询本身没问题（动作失败走 toast，不落这里）。 */
  loadError: string | null;
  loading: boolean;
  /** 正在查看执行日志的那条；null = 弹窗关着。 */
  logRow: QueueTaskLogTarget | null;
  /** ComfyUI 是否可达。false 时列表照常渲染（数据来自本地库），只多一条
   * 「未连接」横幅说明队列不会开始。 */
  online: boolean;
  openFolder: (row: QueueRow) => Promise<void>;
  openLog: (task: QueueTaskLogTarget) => void;
  /** 展开那条的输入参数行（task.detail → 纯派生）；未展开 / 拉取中为空。 */
  paramRows: Array<ReturnType<typeof queueTaskParamRows>[number]>;
  /** 暂停 / 恢复切换进行中（防连点）。 */
  pauseBusy: boolean;
  /** 生图暂停中（落库的持久状态，应用重启不丢，ISSUE #5055）。 */
  paused: boolean;
  /** 排队项，`position` 从 1 起（1 = 下一个开跑）。 */
  queued: Array<{ position: number; row: QueueRow }>;
  /** 最近结果（已截到窗口上限，新的在前）。 */
  recent: Array<QueueRow>;
  refresh: () => void;
  /** 打开「取消全部」确认弹窗。 */
  requestCancelAll: () => void;
  /** 正在跑的那条（富卡片：来自 `/api/comfy/queue`）；没有在跑时为 null。 */
  running: RunningCardView | null;
  /** 运行中任务的详情（仅在展开运行时那条时取到；统一输入 / 请求读数用它）。 */
  runningDetail: Pick<
    NonNullable<RouterOutputs["task"]["detail"]>,
    "id" | "modelName" | "params" | "prompt" | "status" | "workflowName"
  > | null;
  /** 库里 status=RUNNING 的行。`running` 为 null 而这里非空 = ComfyUI 没连上
   * （富卡片的数据源不可达），离线兜底卡用它渲染。 */
  runningRows: Array<QueueRow>;
  /** 顶部指标带四格（运行中 / 排队中 / 今日完成 / 失败）。 */
  stats: QueueStats;
  /** 点同一行收起、点另一行切换。 */
  toggleExpanded: (id: string) => void;
  /** 点一下：暂停 ↔ 恢复（暂停语义见执行器闸门，ISSUE #5055）。 */
  togglePause: () => void;
  /** 本应用排队 + ComfyUI 自己排队，与状态栏那格同一算法；离线时退回
   * 「库里在跑 + 排队的行数」（`/api/comfy/queue` 读不到，不能报 0）。 */
  waitingCount: number;
};

/** 队列与运行的全部逻辑。容器与视图只消费这一份 controller。 */
export function useQueueMonitor(): QueueMonitorController {
  const trpc = useTRPC();
  const toast = useToast();
  const queue = useComfyQueue();
  const copyText = useCopyResult();
  /* 日志弹窗的目标行：openLog 那一刻的快照（不是从 listQ 派生）——否则每 2s
   * 一次的轮询都会换掉对象身份，弹窗会被误重挂、SSE 反复重订。 */
  const [logRow, setLogRow] = useState<QueueTaskLogTarget | null>(null);
  /* 「取消全部」确认弹窗的开合（ISSUE #5064）：破坏性整表动作先问一句，
   * 与 WorksGallery 的删除项目同一口径（ConfirmDialog）。 */
  const [cancelAllOpen, setCancelAllOpen] = useState(false);
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

  const listQ = useQuery(
    trpc.task.list.queryOptions(
      { take: 200 },
      {
        /* 保持旧数据：轮询回来的瞬间不闪空列表（与历史面板同一口径）。 */
        placeholderData: (prev) => prev,
        /* 与状态栏那一格同一个节奏：两处都在回答「机器现在在干什么」，
         * 快慢不该不一样。 */
        refetchInterval: COMFY_QUEUE_POLL_MS,
        enabled: isTabActive,
      },
    ),
  );

  const buckets = useMemo(() => bucketQueueRows(listQ.data?.tasks ?? []), [listQ.data?.tasks]);
  const queued = useMemo(() => queuedWithPosition(buckets.queued), [buckets.queued]);
  /* 指标带四格：服务端全量计数优先（不受 take=200 截断），首帧缺计数时退回窗口版。
   * 日期跨天时 todayCounts 由服务端按本机零点重算，无需前端记忆。 */
  const stats = useMemo(
    () =>
      queueStatsFromCounts(
        listQ.data?.statusCounts,
        listQ.data?.todayCounts,
        queueStats(buckets, new Date()),
      ),
    [buckets, listQ.data?.statusCounts, listQ.data?.todayCounts],
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
      stepsText: formatStepsText(task.progressValue, task.progressMax) ?? "—",
      rateText: formatSampleRateText(task.progressValue, queue.elapsedMs) ?? "—",
    };
  }, [queue.elapsedMs, queue.running]);

  /* 运行中那条的详情只在展开它时才取（#5075）：与排队行共用同一个 detail 门控，
   * 同一时刻只展开一条，避免多开查询。 */
  const runningId = running?.id ?? buckets.running[0]?.id ?? null;
  const runningDetail =
    expandedId !== null && expandedId === runningId ? (detailQ.data ?? null) : null;

  const cancel = useCallback(
    async (id: string, label: string) => {
      await action.run(id, async () => {
        await runAsyncAction(() => cancelTask(id), {
          report,
          failureText: `取消「${label}」失败，请稍后重试`,
          successText: "已发送取消请求",
        });
        /* 失败也要刷新：用户可能已在别处把它取消了，界面不该继续显示排队中。 */
        void listQ.refetch();
      });
    },
    [action, listQ, report],
  );

  /* 取消全部（ISSUE #5064）：整表动作，用 null 作用域的同一把重入锁（与单条
   * 取消共用 `action`，因此「取消全部」在跑时那批行的「取消这条」也一起禁用）。
   * 服务端逐条走执行层出口、部分失败计数带回，这里如实报数：只说「已取消」
   * 会把没取消掉的几条藏起来（用户还以为队列已经清空了）。 */
  const confirmCancelAll = useCallback(async () => {
    setCancelAllOpen(false);
    await action.run(null, async () => {
      /* 条数只在本次动作的 closure 里存一份：`runAsyncAction` 的统一出口只认
       * 「成功 / 失败」两态，而这次要如实报「取消了几条、几条没取消掉」。 */
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
      void listQ.refetch();
    });
  }, [action, listQ, report]);
  const requestCancelAll = useCallback(() => {
    setCancelAllOpen(true);
  }, []);
  const closeCancelAll = useCallback(() => {
    setCancelAllOpen(false);
  }, []);

  /* 生图暂停（ISSUE #5055）：状态在库里（应用重启不丢），队列页用播放 / 暂停
   * 图标切换。暂停语义在执行器闸门（executor-dispatch）：当前任务照常跑完，
   * 之后不再领取生图任务；恢复后按队列序继续。 */
  const pauseQ = useQuery(
    trpc.generationControl.pauseState.queryOptions(undefined, { enabled: isTabActive }),
  );
  const setPausedM = useMutation(
    trpc.generationControl.setPaused.mutationOptions({
      onSuccess: () => {
        void pauseQ.refetch();
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

  return {
    online: queue.online,
    running,
    runningRows: buckets.running,
    queued,
    stats,
    recent: recentWithin(buckets.recent),
    /* 离线时 `/api/comfy/queue` 读不到、两个计数恒为 0，而列表明明排着队 ——
     * 退回「库里在跑 + 排队」的行数，别让「待执行 0」和下面的列表自相矛盾。 */
    waitingCount: queue.online
      ? queue.queued + queue.comfy.pending
      : buckets.running.length + queued.length,
    loading: listQ.isPending,
    loadError: listQ.isError ? "读不到任务记录，后端可能刚重启" : null,
    logRow,
    expandedId,
    runningDetail,
    toggleExpanded,
    detailLoading: detailQ.isFetching,
    paramRows,
    isBusy: (id: string) => action.isBusy(id),
    refresh: () => {
      void listQ.refetch();
    },
    cancel,
    cancelAllOpen,
    cancelAllBusy: action.isBusy(null),
    confirmCancelAll,
    requestCancelAll,
    closeCancelAll,
    openFolder,
    copyForReprint,
    paused: pauseQ.data?.paused ?? false,
    pauseBusy: setPausedM.isPending,
    togglePause,
    openLog: (task) => {
      setLogRow(task);
    },
    closeLog: () => {
      setLogRow(null);
    },
  };
}
