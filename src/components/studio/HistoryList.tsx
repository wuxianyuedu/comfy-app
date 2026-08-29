"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useToast } from "@/components/studio/ToastProvider";
import { AuroraBackground } from "@/components/studio/AuroraBackground";
import { api } from "~/trpc/react";

import { HistoryDetailModal } from "./HistoryDetailModal";
import { HistoryTaskCard } from "./HistoryTaskCard";
import type { FilterKey, SortKey, TaskItem } from "./history-types";
import { FILTERS } from "./history-types";
import { dateBucket, useSimulatedProgress, PAGE_SIZE } from "./history-utils";

export function HistoryList({ onOpenTask: _onOpenTask }: { onOpenTask?: (id: string) => void }) {
  /* R-ardot60 (2026-08-15): 拿掉 modal「打开完整详情 ↗」按钮后 onOpenTask 变成无用 prop,
   *  重命名为 _onOpenTask 让 lint 沉默并保留向下兼容（父组件还在传，旧版可以仍然保留这个 prop）。
   *  用户反馈「在这里点开就显示详情，别在其他界面再显示」—— 历史 modal 是「这里」，
   *  「其他界面」是 `/create/${id}` 这条独立路由。 */
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
    [tasksQ.data?.tasks]
  );
  const loading = tasksQ.isLoading;
  const progressMap = useSimulatedProgress(tasks);

  const load = useCallback(() => {
    void tasksQ.refetch();
  }, [tasksQ]);

  const detailQ = api.task.detail.useQuery(
    { id: detailId ?? "" },
    { enabled: !!detailId }
  );
  /* 详情直接派生自查询结果：detailId 切换时 isPending 自动为 true、data 为 null，
     open 清空逻辑不再需要本地镜像 state。 */
  const detail = detailQ.isSuccess ? detailQ.data : null;
  const detailLoading = detailQ.isPending;
  /** R-ardot63 (2026-08-15): 工作流默认值兜底 —— 来自 /api/tasks/[id] 的 workflowHints 子字段。 */
  const workflowHints = detailQ.isSuccess
    ? (detailQ.data as { workflowHints?: unknown } | null | undefined)?.workflowHints ?? null
    : null;

  const openDetail = useCallback((id: string) => {
    setDetailId(id);
  }, []);

  // Allow external components (e.g. VideoQueueModal "详情") to open a task.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) openDetail(id);
    };
    window.addEventListener("open-task", handler);
    return () => window.removeEventListener("open-task", handler);
  }, [openDetail]);

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
      load();
    },
    [cancelTask, load, toast]
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
            old ? { ...old, tasks: old.tasks.filter((task) => task.id !== id) } : old
        );
        if (detailId === id) setDetailId(null);
      } catch {
        toast.error("删除失败");
      }
    },
    [deleteTask, detailId, toast, queryClient]
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
            `prompt: ${task.prompt ?? ""}\nworkflow: ${task.workflowName}\ntype: ${task.type}\nparams: ${params}`
          );
        } catch {
          /* noop */
        }
        toast.info("后端尚未提供重试接口，已复制参数到剪贴板，请到创作台手动重跑");
      } catch {
        toast.error("网络错误，重试请求未发送");
      } finally {
        setRetryingId(null);
        load();
      }
    },
    [load, toast]
  );

  // 筛选 + 排序
  const filtered = useMemo(() => {
    const filteredTasks = filter === "ALL" ? tasks : tasks.filter((task) => task.status === filter);
    return [...filteredTasks].sort((taskA, taskB) => {
      const da = new Date(taskA.createdAt).getTime();
      const db = new Date(taskB.createdAt).getTime();
      return sort === "newest" ? db - da : da - db;
    });
  }, [tasks, filter, sort]);

  // 各状态计数
  const counts = useMemo(() => {
    const countsMap: Record<string, number> = { ALL: tasks.length };
    for (const task of tasks) countsMap[task.status] = (countsMap[task.status] ?? 0) + 1;
    return countsMap;
  }, [tasks]);

  // 按日期分组
  const grouped = useMemo(() => {
    const bucketMap = new Map<string, TaskItem[]>();
    for (const task of filtered) {
      const bucket = dateBucket(task.createdAt);
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, []);
      bucketMap.get(bucket)!.push(task);
    }
    return Array.from(bucketMap.entries()).map(([key, items]) => ({ key, items }));
  }, [filtered]);

  // 分页：先按 status 时间倒序，再按分组裁剪 displayCount
  const visibleGroups = useMemo(() => {
    let remaining = displayCount;
    const out: Array<{ key: string; items: TaskItem[] }> = [];
    for (const group of grouped) {
      if (remaining <= 0) break;
      const sliced = group.items.slice(0, remaining);
      if (sliced.length > 0) out.push({ key: group.key, items: sliced });
      remaining -= group.items.length;
    }
    return out;
  }, [grouped, displayCount]);

  const visibleTotal = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  const canLoadMore = visibleTotal < filtered.length;

  const switchFilter = useCallback((filterKey: FilterKey) => {
    setFilter(filterKey);
    setDisplayCount(PAGE_SIZE);
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 sm:py-10">
        {/* ── Header ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-xl font-bold text-gray-100">历史记录</h1>
            <p className="mt-1 text-sm text-gray-500">
              所有生成任务与执行日志，按时间倒序排列。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="rounded-lg border border-white/10 bg-white/3 px-3 py-1.5 text-xs text-gray-300 outline-none focus:border-violet-500/40"
              aria-label="排序"
            >
              <option value="newest" className="bg-(--color-node)">
                时间倒序
              </option>
              <option value="oldest" className="bg-(--color-node)">
                时间正序
              </option>
            </select>
            <button
              onClick={load}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              ↻ 刷新
            </button>
          </div>
        </div>

        {/* ── 状态筛选 pills ── */}
        <div className="mb-6 flex flex-wrap gap-2">
          {FILTERS.map((filterOption) => {
            const isActive = filter === filterOption.key;
            const count = counts[filterOption.key] ?? 0;
            return (
              <button
                key={filterOption.key}
                onClick={() => switchFilter(filterOption.key)}
                className={
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-all " +
                  (isActive
                    ? "bg-linear-to-r from-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/20"
                    : "border border-white/8 bg-white/2 text-gray-300 hover:bg-white/6")
                }
              >
                {filterOption.dotCls && (
                  <span className={`h-1.5 w-1.5 rounded-full ${filterOption.dotCls}`} />
                )}
                <span>{filterOption.label}</span>
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                    (isActive ? "bg-white/25 text-white" : "bg-white/6 text-gray-400")
                  }
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : filtered.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/8 text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">
                {filter === "ALL" ? "暂无任务记录" : `暂无${FILTERS.find((filterOption) => filterOption.key === filter)?.label ?? ""}任务`}
              </p>
              <p className="mt-1 text-sm">
                {filter === "ALL"
                  ? "在创作台生成内容后，历史记录会显示在这里。"
                  : "切换到「全部」可查看所有任务。"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {visibleGroups.map((group) => (
              <section key={group.key}>
                {/* ── 日期分组标题 ── */}
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-4 w-1 rounded-full bg-linear-to-b from-violet-500 to-fuchsia-500" />
                  <h2 className="text-sm font-semibold text-gray-300">{group.key}</h2>
                  <span className="text-xs text-gray-600">{group.items.length} 个任务</span>
                  <div className="h-px flex-1 bg-white/5" />
                </div>

                {/* ── 任务列表 ── */}
                <div className="space-y-3">
                  {group.items.map((task) => (
                    <HistoryTaskCard
                      key={task.id}
                      task={task}
                      progress={progressMap[task.id] ?? 0}
                      retrying={retryingId === task.id}
                      onOpenDetail={openDetail}
                      onCancel={cancel}
                      onRetry={retry}
                      onRemove={remove}
                    />
                  ))}
                </div>
              </section>
            ))}

            {/* ── 分页 footer ── */}
            <div className="flex items-center justify-center gap-3 border-t border-white/4 pt-6">
              <span className="text-xs text-gray-500">
                已加载 {visibleTotal} / {filtered.length} 个任务
              </span>
              {canLoadMore ? (
                <button
                  onClick={() => setDisplayCount((count) => count + PAGE_SIZE)}
                  className="rounded-lg border border-white/10 bg-white/4 px-4 py-1.5 text-xs text-gray-300 hover:bg-white/8"
                >
                  加载更多
                </button>
              ) : (
                <span className="text-[11px] text-gray-600">已全部加载</span>
              )}
            </div>
          </div>
        )}
      </div>

      <HistoryDetailModal
        detailId={detailId}
        detail={detail}
        detailLoading={detailLoading}
        workflowHints={workflowHints}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
