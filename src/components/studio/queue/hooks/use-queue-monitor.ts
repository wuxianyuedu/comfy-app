"use client";

// ── 队列与运行 · 第②层（查询与动作编排）────────────────────────────────────
//
// 两侧数据必须一起用，这是本 hook 存在的唯一理由：
//   · `/api/comfy/queue`（经 `useComfyQueue`）给「正在跑的那条 + 已运行多久 +
//     当前在哪个节点」，但排队只给**两个计数**，给不出名称与顺序；
//   · `task.list` 给逐条的名称、位次依据与失败原因，却不知道谁正在跑、
//     也不知道它跑了多久（库里只有 `createdAt` / `finishedAt`，没有开始时刻）。
// 于是「还要多久」走前者、「下一条是不是我的」走后者，两件事在这一屏合成。
// 视图层不再出现 fetch / tRPC hook（规范 17 §17.2 红线 S1/S2/S3）。
//
// 轮询成本说明：状态栏那一格已挂着 `useComfyQueue`，本视图再挂一次意味着视图打开
// 期间该端点每 2s 被请求两次。它在服务端是「内存态 + 一次本地 ComfyUI /queue」的
// 聚合，量级很小，故本 PR 不为此重构那个常驻 hook。
// TODO: 两处轮询同一端点属重复消费；建议把 `useComfyQueue` 的观测收成模块级单例
//       （订阅式共享一次轮询），状态栏与本视图都只订阅。它改动常驻组件的数据归属，
//       应单开 PR，别混在功能改动里。

import { useCallback, useMemo, useState } from "react";

import {
  COMFY_QUEUE_POLL_MS,
  useComfyQueue,
} from "~/components/studio/hooks/use-comfy-queue";
import { useCopyResult } from "~/components/ui/use-copy-feedback";
import { useItemAction } from "~/components/ui/use-item-action";
import { runAsyncAction, type ActionReport } from "~/lib/async-action";
import { openTaskFolder } from "~/lib/history-detail-actions";
import { cancelTask } from "~/lib/task-cancel-client";
import { api } from "~/trpc/react";

import { useToast } from "../../ToastProvider";
import type { QueueTaskLogTarget } from "../QueueTaskLogModal";
import {
  bucketQueueRows,
  estimateRemainingMs,
  queuedWithPosition,
  recentWithin,
  remainingText,
  reprintText,
  runningElapsedText,
  type QueueRow,
} from "../queue-monitor-config";

/** 正在跑那条的展示卡（数值都已算成字符串或百分比，视图只渲染）。 */
export interface RunningCardView {
  id: string;
  workflowName: string;
  modelText: string;
  nodeText: string;
  elapsedText: string;
  remainingText: string;
  progressPct: number;
}

export interface QueueMonitorController {
  /** ComfyUI 是否可达。false 时列表照常渲染（数据来自本地库），只多一条
   * 「未连接」横幅说明队列不会开始。 */
  online: boolean;
  /** 正在跑的那条（富卡片：来自 `/api/comfy/queue`）；没有在跑时为 null。 */
  running: RunningCardView | null;
  /** 库里 status=RUNNING 的行。`running` 为 null 而这里非空 = ComfyUI 没连上
   * （富卡片的数据源不可达），离线兜底卡用它渲染。 */
  runningRows: QueueRow[];
  /** 排队项，`position` 从 1 起（1 = 下一个开跑）。 */
  queued: Array<{ row: QueueRow; position: number }>;
  /** 最近结果（已截到窗口上限，新的在前）。 */
  recent: QueueRow[];
  /** 本应用排队 + ComfyUI 自己排队，与状态栏那格同一算法；离线时退回
   * 「库里在跑 + 排队的行数」（`/api/comfy/queue` 读不到，不能报 0）。 */
  waitingCount: number;
  loading: boolean;
  /** 拉取失败的一句话；null 表示查询本身没问题（动作失败走 toast，不落这里）。 */
  loadError: string | null;
  /** 正在查看执行日志的那条；null = 弹窗关着。 */
  logRow: QueueTaskLogTarget | null;
  /** 这一条正在被操作吗（判据在出口里，视图不再自己比 id）。 */
  isBusy: (id: string) => boolean;
  refresh: () => void;
  cancel: (id: string, label: string) => Promise<void>;
  openFolder: (row: QueueRow) => Promise<void>;
  copyForReprint: (row: QueueRow) => Promise<void>;
  openLog: (task: QueueTaskLogTarget) => void;
  closeLog: () => void;
}

/** 队列与运行的全部逻辑。容器与视图只消费这一份 controller。 */
export function useQueueMonitor(): QueueMonitorController {
  const toast = useToast();
  const queue = useComfyQueue();
  const copyText = useCopyResult();
  /* 日志弹窗的目标行：openLog 那一刻的快照（不是从 listQ 派生）——否则每 2s
   * 一次的轮询都会换掉对象身份，弹窗会被误重挂、SSE 反复重订。 */
  const [logRow, setLogRow] = useState<QueueTaskLogTarget | null>(null);

  const listQ = api.task.list.useQuery(
    { take: 200 },
    {
      /* 保持旧数据：轮询回来的瞬间不闪空列表（与历史面板同一口径）。 */
      placeholderData: (prev) => prev,
      /* 与状态栏那一格同一个节奏：两处都在回答「机器现在在干什么」，
       * 快慢不该不一样。 */
      refetchInterval: COMFY_QUEUE_POLL_MS,
    },
  );

  const buckets = useMemo(
    () => bucketQueueRows(listQ.data?.tasks ?? []),
    [listQ.data?.tasks],
  );
  const queued = useMemo(
    () => queuedWithPosition(buckets.queued),
    [buckets.queued],
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
    (kind, detail) =>
      kind === "ok" ? toast.info(detail) : toast.error(detail),
    [toast],
  );

  const running = useMemo<RunningCardView | null>(() => {
    const task = queue.running;
    if (task === null) return null;
    const remainingMs = estimateRemainingMs(
      queue.elapsedMs ?? 0,
      task.progress,
    );
    return {
      id: task.taskId,
      workflowName: task.workflowName ?? "（未知工作流）",
      modelText: task.model ?? "未能从本次工作流里识别",
      nodeText: task.nodeType ?? "尚未回报节点",
      elapsedText: runningElapsedText(queue.elapsedMs),
      remainingText: remainingText(remainingMs),
      progressPct: task.progress,
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
        void listQ.refetch();
      });
    },
    [action, listQ, report],
  );

  const openFolder = useCallback(
    async (row: QueueRow) => {
      await action.run(row.id, async () => {
        const result = await openTaskFolder(row.id);
        await runAsyncAction(async () => result.opened, {
          report,
          failureText:
            result.error ?? "未能打开输出目录，可在任务详情里复制文件路径",
          successText: "已交给系统打开输出目录",
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
        await runAsyncAction(async () => copied, {
          report,
          failureText: "复制失败，请检查是否允许访问剪贴板",
          successText:
            "后端没有重试接口，已复制本次提交内容 —— 回画布改完参数再投一次",
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
    recent: recentWithin(buckets.recent),
    /* 离线时 `/api/comfy/queue` 读不到、两个计数恒为 0，而列表明明排着队 ——
     * 退回「库里在跑 + 排队」的行数，别让「待执行 0」和下面的列表自相矛盾。 */
    waitingCount: queue.online
      ? queue.queued + queue.comfy.pending
      : buckets.running.length + queued.length,
    loading: listQ.isPending,
    loadError: listQ.isError ? "读不到任务记录，后端可能刚重启" : null,
    logRow,
    isBusy: (id: string) => action.isBusy(id),
    refresh: () => void listQ.refetch(),
    cancel,
    openFolder,
    copyForReprint,
    openLog: (task) => setLogRow(task),
    closeLog: () => setLogRow(null),
  };
}
