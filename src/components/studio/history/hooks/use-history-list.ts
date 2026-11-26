"use client";

// ── 历史记录列表：逻辑层（规范 17 §17.2 第②层）──────────────────────────────
// 承载查询、筛选/排序/分页、详情弹层开关、取消/删除/重试三个动作。
// HistoryList 视图只消费本 hook 返回的 controller，不再自己发请求。

import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { runAsyncAction, type ActionReport } from "~/lib/async-action";
/* 取消走集中出口（`task-cancel-client`）：这里此前自己挂了一份
 * `useMutation(trpc.task.cancel.mutationOptions())`，于是「取消失败怎么提示」在历史面板与画布
 * 面板各说一套（§12.14 端点收口）。取消的服务端语义见 ADR §14 D2。 */
import { cancelTask } from "~/lib/task-cancel-client";
/* 输出目录 / 复制去重投（ISSUE #4619）：与队列页同一份实现 ——
 * 目录走 `revealTaskFolder`（comfyapp:// 深链 + 失败文案单一出处），
 * 复制走 `useCopyResult`；#4769 起复制的载荷是**全量参数 JSON**（详情接口
 * 现取 + 与详情弹窗同一套派生），不再是只有三列的行内文本。 */
import { revealTaskFolder } from "~/lib/history-detail-actions";
import { useCopyResult } from "~/components/ui/use-copy-feedback";
import type { QueueTaskLogTarget } from "~/components/studio/queue/QueueTaskLogModal";
import { useItemAction } from "~/components/ui/use-item-action";
import { useViewTabActive } from "~/components/ui/view-tab-active";

import { useToast } from "../../ToastProvider";
import { parseWorkflowIOMap, type WorkflowIOMap } from "~/lib/workflow/workflow-io-types";
import type { ModeContract } from "~/lib/workshop/model-mode-contract";

import {
  buildModelTestRetryPayload,
  buildReprintPayload,
  taskWorkflowId,
} from "../history-detail-derive";
import type { ModelTestRetryPayload } from "../history-detail-derive";
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
  HISTORY_TASK_STATUSES,
  type FilterKey,
  type SortKey,
  type TaskDetail,
  type TaskItem,
} from "../history-types";
import { PAGE_SIZE, useSimulatedProgress } from "../history-utils";
import { useStableHistoryTasks } from "./use-stable-history-tasks";
import { useTRPC } from "~/trpc/react";

/** 有进行中任务时的轮询节奏（与画布历史面板同一档）：任务完成 / 新任务入队
 *  能自己冒出来，不再依赖手动刷新 —— #4619 的「队列两条、历史一条」正是
 *  页面开着不动导致的陈旧读数。没有进行中任务时不轮询（列表是静历史）。 */
const HISTORY_POLL_MS = 4000;

/** 空 IO 表：引用恒定（未查到工作流时沿用同一个对象，不每次渲染造新的）。 */
const EMPTY_WORKFLOW_IO: WorkflowIOMap = {};

export type HistoryListController = {
  cancel: (id: string) => Promise<void>;
  /** 取消删除（ConfirmDialog 的关闭侧，ISSUE #3771）。 */
  cancelRemove: () => void;
  canLoadMore: boolean;
  closeDetail: () => void;
  /** 关闭执行日志弹窗（ISSUE #4619）。 */
  closeLog: () => void;
  /** 确认删除待删目标（ConfirmDialog 的确认侧，ISSUE #3771）。 */
  confirmRemove: () => Promise<void>;
  /** 「复制去重投」：把本次提交的全部参数折成 JSON 复制到剪贴板（ISSUE #4769，
   *  粘贴侧 = 测试模型的 JSON 输入模式）。 */
  copyForReprint: (task: TaskItem) => Promise<void>;
  /** 各状态计数（服务端 GROUP BY 的**真实总数**，不是已拉取行的计数）；
   *  key 为 FilterKey 或任务 status。 */
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
  /** 这一条的动作（输出目录 / 复制去重投）正在进行吗。 */
  isRowBusy: (id: string) => boolean;
  loading: boolean;
  /** 正在拉取下一页（滚动到底自动加载的请求在飞）。 */
  loadingMore: boolean;
  loadMore: () => void;
  /** 正在查看执行日志的那条（快照）；null = 弹窗关着。 */
  logTarget: QueueTaskLogTarget | null;
  /** 模式契约注册表（只含用户改过的模式）：详情弹窗按它 + 任务模式枚举工坊对外口。
   *  未加载 / 失败时为 null，工坊参数回落内置默认契约。 */
  modeContracts: ReadonlyArray<ModeContract> | null;
  openDetail: (id: string) => void;
  /** 打开这一条的产物目录（comfyapp:// 深链，与队列页同一份实现）。 */
  openFolder: (task: TaskItem) => Promise<void>;
  /** 打开这一条的执行日志弹窗（与队列页同一份组件）。 */
  openLog: (task: TaskItem) => void;
  /** 进行中任务的模拟进度 Map。 */
  progressMap: Record<string, number>;
  refresh: () => void;
  /** 打开删除确认弹窗（非阻塞，ISSUE #3771）。 */
  remove: (id: string) => void;
  /** 待删除的任务 id（ConfirmDialog 的 open 侧，ISSUE #3771）。 */
  removeTarget: string | null;
  /** 「重试」= 带参回到测试模型的统一输入（#4841）：用户确认后点「生成」
   *  才真正重跑，不再直接复投。 */
  retry: (task: TaskItem) => Promise<void>;
  retryingId: string | null;
  setSort: (sort: SortKey) => void;
  sort: SortKey;
  switchFilter: (filter: FilterKey) => void;
  tasks: Array<TaskItem>;
  /** 终态任务总数（服务端随页回带；首页还没拉到时为 null）。
   *  历史页「已加载 X / 总数 Y」的 Y。 */
  total: number | null;
  /** 当前可见的日期分组（已拉取各页的并集；翻页走服务端 skip，#4044）。 */
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
export function useHistoryList(args: {
  /** 「重试」折好载荷后的落点（#4841）：工作区把载荷带到「测试模型」页预填
   *  并切页签。由 HistoryList 的 props 注入（工作区 → 页签栈 → 历史视图）。 */
  onReprintToModelTest: (payload: ModelTestRetryPayload) => void;
}): HistoryListController {
  const { onReprintToModelTest } = args;
  const trpc = useTRPC();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [sort, setSort] = useState<SortKey>("newest");
  const [detailId, setDetailId] = useState<string | null>(null);
  /* 「哪一条在重试」收在 `useItemAction`（规范 16 §16.2.4.40）：
   * 此前是本文件自持的 `useState<string | null>`，与工坊两处（AI 润色）、
   * 工作流库的下载与同步各写一份 —— 而「同一条能不能重复点」四处都没防。 */
  const retryAction = useItemAction();
  /* 真分页（#4044）：无限查询按页拉取（cursor = 服务端的扫描前沿，#4741 起由
   * 响应显式回传、原样透传）；hasMore 由服务端响应给出（media 过滤的截断也
   * 因此对调用方可见）。有进行中任务时按 HISTORY_POLL_MS 轮询（判据读查询
   * 自身已拉到的行）。页签隐藏时不轮询（ISSUE #4598）：disabled 期间函数式
   * refetchInterval 一并停摆。 */
  const isTabActive = useViewTabActive();
  const tasksQ = useInfiniteQuery(
    trpc.task.list.infiniteQueryOptions(
      {
        take: PAGE_SIZE,
        /* 行过滤下推服务端（#5076）：点「失败 / 已取消」只拉该状态的任务，
           cursor 也从该状态的第一条开始 —— 不再只对已拉取的 100 行本地过滤。 */
        status: filter === "ALL" ? HISTORY_TASK_STATUSES : filter,
        /* 角标仍按终态全集计数，与当前筛选解耦。 */
        countStatus: HISTORY_TASK_STATUSES,
      },
      {
        getNextPageParam: (lastPage) => {
          if (!lastPage.hasMore) {
            return undefined;
          }
          /* cursor 是**扫描前沿**（#4741）：media 过滤时「过滤后命中数」与
           * SQL skip 是两回事 —— 按命中数推进会让后续页从已扫过的位置重扫、
           * 重复返回已见行（此前靠 id 去重掩盖，读放大浪费）。服务端显式
           * 回传前沿后两侧语义统一。 */
          return lastPage.nextScanCursor;
        },
        /* 此前用「已拉取行里有没有 QUEUED/RUNNING」判轮询，但历史查询只取终态，
         * 判据恒假 —— 页面永远不会自己冒出新完成的任务（#5076）。改为页签活跃
         * 就按固定节奏重问，仍由 enabled 在隐藏时停摆。 */
        refetchInterval: isTabActive ? HISTORY_POLL_MS : false,
        enabled: isTabActive,
      },
    ),
  );
  const hasMore = tasksQ.data?.pages.at(-1)?.hasMore ?? false;
  /* 终态任务总数（服务端随页回带，各页同值）：历史页「已加载 X / 总数 Y」的 Y。
   * 一页都没拉到（加载中）时为 null。 */
  const total = tasksQ.data?.pages.at(-1)?.total ?? null;

  /* 各页并集（按 id 去重、保持「新到旧」的页序）：渲染期从查询结果派生，
   * 不在 effect 里 setState（规范 8.6 / 2.4）；4s 轮询内容不变时沿用旧引用，
   * 否则 100 张已 memo 的卡片会跟着新数组一起失效。 */
  const tasks = useStableHistoryTasks(tasksQ.data?.pages);
  const loading = tasksQ.isLoading;
  const progressMap = useSimulatedProgress(tasks);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: trpc.task.list.queryKey() });
  }, [queryClient, trpc]);

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
    () => (ioQ.isSuccess ? parseWorkflowIOMap(ioQ.data?.template?.workflowIO) : EMPTY_WORKFLOW_IO),
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
  /* 状态枚上的计数用服务端的 GROUP BY（真实总数，不是「已拉取的行」的计数，
   * ISSUE #5009 反馈：历史有多少就显示多少）；首页未到时退回已拉取行的计数。
   * ALL = 终态任务总数。 */
  const serverStatusCounts = tasksQ.data?.pages.at(-1)?.statusCounts ?? null;
  const counts = useMemo<Record<string, number>>(() => {
    const base = serverStatusCounts ?? countByStatus(tasks);
    return { ALL: total ?? base.ALL ?? 0, ...base };
  }, [serverStatusCounts, tasks, total]);
  /* 已拉取的行全部可见（分页走服务端 cursor，#4044）；「还有没有下一页」由
   * 服务端的 hasMore 回答——media 过滤的 400 行截断也因此对调用方可见。 */
  const { visibleGroups, visibleTotal } = useMemo(
    () => paginateGroups(groupByDate(filtered), tasks.length),
    [filtered, tasks],
  );
  const canLoadMore = hasMore;
  const empty = useMemo(() => {
    const label = FILTERS.find((f) => f.key === filter)?.label ?? "";
    return emptyStateText(filter, label);
  }, [filter]);

  const switchFilter = useCallback((filterKey: FilterKey) => {
    setFilter(filterKey);
  }, []);
  const loadMore = useCallback(() => {
    if (!hasMore) {
      return;
    }
    void tasksQ.fetchNextPage();
  }, [hasMore, tasksQ]);

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

  /* 删除走**非阻塞确认弹窗**（`ConfirmDialog`，ISSUE #3771）：原生 `confirm()`
   * 是同步对话框 —— 在内嵌浏览器（IAB）里弹出后若无人处置，同源渲染进程的
   * 主线程会以 0 CPU 整体卡死（连无应用 JS 的 splash.html 都冻结）。这里只
   * 记下待删目标，由视图挂 ConfirmDialog 承接确认。 */
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const remove = useCallback((id: string) => {
    setRemoveTarget(id);
  }, []);
  const cancelRemove = useCallback(() => {
    setRemoveTarget(null);
  }, []);
  const confirmRemove = useCallback(async () => {
    const id = removeTarget;
    if (!id) {
      return;
    }
    setRemoveTarget(null);
    await runAsyncAction(
      async () => {
        await deleteTask.mutateAsync({ id });
        /* 乐观移除：直接改无限查询缓存里的各页（避免本地镜像 state，#4044） */
        queryClient.setQueryData(
          trpc.task.list.infiniteQueryKey({
            take: PAGE_SIZE,
            status: filter === "ALL" ? HISTORY_TASK_STATUSES : filter,
            countStatus: HISTORY_TASK_STATUSES,
          }),
          /* 键自带 DataTag：`old` 的形状由查询结果推导，不再手写窄类型 */
          (old) => {
            if (!old) {
              return old;
            }
            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                tasks: page.tasks.filter((task) => task.id !== id),
              })),
            };
          },
        );
        if (detailId === id) {
          setDetailId(null);
        }
      },
      { report, failureText: "删除失败", successText: "已删除任务" },
    );
  }, [deleteTask, detailId, filter, removeTarget, report, queryClient, trpc]);

  /* 「重试」= 带参回到输入面（#4841）：取详情 + 模式契约，按「复制去重投」
   * 同一份派生（buildModelTestRetryPayload）折成预填载荷，交给工作区带到
   * 「测试模型」页切模式页签 + 预填统一输入；用户确认后点「生成」才真正
   * 重跑。原先的直复投（task.retry 原样新建 QUEUED 行）已从历史页撤走 ——
   * 误触一次就是一次真实生成（额度 / 本地队列都被占用）；该端点唯一的
   * 消费方就是历史页直调，已随 #4841 一并退役（台账 E3′ 不留无消费方口）。 */
  const retry = useCallback(
    async (task: TaskItem) => {
      await retryAction.run(task.id, async () => {
        await runAsyncAction(
          async () => {
            const detail = await queryClient.fetchQuery(
              trpc.task.detail.queryOptions({ id: task.id }),
            );
            const contracts = await queryClient.fetchQuery(
              trpc.llm.modeContractsGet.queryOptions(undefined),
            );
            onReprintToModelTest(
              buildModelTestRetryPayload({
                detail,
                mode: detail.type,
                contracts: contracts.contracts ?? null,
              }),
            );
            return { ok: true as const };
          },
          {
            report,
            failureText: "重试失败：未能取到该任务的参数",
            successText: "已在「测试模型」预填该任务的参数 —— 确认后点「生成」开始重试",
          },
        );
      });
    },
    [onReprintToModelTest, queryClient, report, retryAction, trpc],
  );

  /* ── 行级动作：输出目录 / 复制去重投 / 执行日志（ISSUE #4619）──────────────
   *  与队列页同一份实现（同一出口、同一文案）：目录走 `revealTaskFolder`、
   *  日志复用队列的弹窗组件。复制的载荷自 #4769 起是全量参数 JSON
   *  （`buildReprintPayload`，与详情弹窗同一套派生）。忙标记收在
   *  `useItemAction`，与重试互不干扰（可以边重试边看日志）。 */
  const rowAction = useItemAction();
  const copyText = useCopyResult();

  const openFolder = useCallback(
    async (task: TaskItem) => {
      await rowAction.run(task.id, async () => {
        /* 成败与文案都由 `revealTaskFolder` 的 `{ ok, detail }` 表达（与队列页
         * 同一口径），这里不重复抄一份成功/失败判断。 */
        const result = await revealTaskFolder(task.id);
        await runAsyncAction(() => Promise.resolve(result), {
          report,
          failureText: "未能打开输出目录，可在任务详情里复制文件路径",
        });
      });
    },
    [report, rowAction],
  );

  const copyForReprint = useCallback(
    async (task: TaskItem) => {
      await rowAction.run(task.id, async () => {
        await runAsyncAction(
          async () => {
            /* 全量参数在详情接口里（task.list 的行只有提示词/工作流/类型三列，
             * ISSUE #4619 时的已知边界）。复制那一刻现取详情 + 模式契约，按详情
             * 弹窗同一套派生（buildReprintPayload）折成 JSON —— 复制走的与用户
             * 在详情里看到的参数表一字不差。 */
            const detail = await queryClient.fetchQuery(
              trpc.task.detail.queryOptions({ id: task.id }),
            );
            const contractsQ = await queryClient.fetchQuery(
              trpc.llm.modeContractsGet.queryOptions(),
            );
            const payload = buildReprintPayload({
              detail,
              mode: detail.type,
              contracts: contractsQ.contracts ?? null,
            });
            const copied = await copyText(JSON.stringify(payload, null, 2));
            if (!copied) {
              throw new Error("copy rejected");
            }
            return { ok: true as const };
          },
          {
            report,
            failureText: "复制失败，请检查是否允许访问剪贴板",
            successText: "已复制全部参数 JSON —— 到「测试模型」切到 JSON 输入粘贴即可重跑",
          },
        );
      });
    },
    [copyText, queryClient, report, rowAction, trpc],
  );

  /* 日志弹窗的目标行：openLog 那一刻的快照（与队列页同一理由——轮询换对象
   * 身份不该重挂弹窗、重订 SSE）。 */
  const [logTarget, setLogTarget] = useState<QueueTaskLogTarget | null>(null);
  const openLog = useCallback((task: TaskItem) => {
    setLogTarget({
      error: task.error ?? null,
      id: task.id,
      status: task.status,
      workflowName: task.workflowName,
    });
  }, []);
  const closeLog = useCallback(() => {
    setLogTarget(null);
  }, []);

  /* 行级判据收成稳定函数（规范 04 §4.8）：此前 return 里现造两个箭头，
   * 每次 controller 重建都换身份，memo 的卡片列表因此陪跑。 */
  const isRetrying = useCallback((id: string) => retryAction.isBusy(id), [retryAction]);
  const isRowBusy = useCallback((id: string) => rowAction.isBusy(id), [rowAction]);

  return {
    tasks,
    loading,
    filter,
    sort,
    counts,
    visibleGroups,
    visibleTotal,
    filteredCount: filtered.length,
    total,
    loadingMore: tasksQ.isFetchingNextPage,
    canLoadMore,
    empty,
    progressMap,
    retryingId: retryAction.busyId,
    isRetrying,
    isRowBusy,
    logTarget,
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
    openLog,
    closeLog,
    openFolder,
    copyForReprint,
    cancel,
    remove,
    removeTarget,
    confirmRemove,
    cancelRemove,
    retry,
  };
}
