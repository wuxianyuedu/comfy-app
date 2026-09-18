"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";

import { HistoryDetailModal } from "./HistoryDetailModal";
import { HistoryTaskCard } from "./HistoryTaskCard";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { useHistoryList } from "./hooks/use-history-list";
import { FILTERS, type SortKey, type TaskItem } from "./history-types";

/**
 * 单个日期分组下的任务卡片列表。
 * 独立成组件以便用 useAutoAnimate 给「增 / 删 / 排序换位」的条目级重排做平滑过渡，
 * 同时不把 hook 放进 map 循环（hooks 规则）。纯展示，无业务规则（规范 17 §17.2 第③层）。
 */
function HistoryGroupTaskList({
  items,
  progressMap,
  retryingId,
  onOpenDetail,
  onCancel,
  onRetry,
  onRemove,
}: {
  items: TaskItem[];
  progressMap: Record<string, number>;
  retryingId: string | null;
  onOpenDetail: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (task: TaskItem) => void;
  onRemove: (id: string) => void;
}) {
  // 仅用 transform/opacity 的 FLIP 位移与淡入淡出（规范 §2.7），不动画
  // width/height/left/top/margin 等触发整树 layout 重排的属性。
  // 尊重系统减弱动画的限制已去掉：开启 disrespectUserMotionPreference，
  // 让列表条目级增删/排序在系统开启「减弱动态效果」时也保留适量过渡动画。
  const [listRef] = useAutoAnimate<HTMLDivElement>({
    duration: 250,
    easing: "ease-out",
    disrespectUserMotionPreference: true,
  });

  return (
    <div className="space-y-3" ref={listRef}>
      {items.map((task) => (
        <HistoryTaskCard
          key={task.id}
          task={task}
          progress={progressMap[task.id] ?? 0}
          retrying={retryingId === task.id}
          onOpenDetail={onOpenDetail}
          onCancel={onCancel}
          onRetry={onRetry}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

/**
 * 历史记录面板 —— 容器（规范 17 §17.2 第④层）。
 * 只做：取 controller → 传给视图 → 挂详情弹层；不含任何业务规则。
 */
export function HistoryList({
  onOpenTask: _onOpenTask,
}: {
  onOpenTask?: (id: string) => void;
}) {
  /* 拿掉 modal「打开完整详情 ↗」按钮后 onOpenTask 变成无用 prop,
   *  重命名为 _onOpenTask 让 lint 沉默并保留向下兼容（父组件还在传，旧版可以仍然保留这个 prop）。
   *  用户反馈「在这里点开就显示详情，别在其他界面再显示」—— 历史 modal 是「这里」，
   *  「其他界面」是 `/create/${id}` 这条独立路由。 */
  const c = useHistoryList();

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        {/* ── Header ── */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-title text-ink text-xl font-bold">历史记录</h1>
            <p className="text-ink-muted mt-1 text-sm">
              所有生成任务与执行日志，按时间倒序排列。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={c.sort}
              onChange={(event) => c.setSort(event.target.value as SortKey)}
              className="border-border bg-subtle text-ink-strong rounded-lg border px-3 py-1.5 text-xs outline-none focus:border-violet-500/40"
              aria-label="排序"
            >
              <option value="newest" className="bg-node">
                时间倒序
              </option>
              <option value="oldest" className="bg-node">
                时间正序
              </option>
            </select>
            <Button
              variant="outline"
              size="xs"
              onClick={c.refresh}
              className="border-border text-ink-faint hover:text-ink-bright h-auto rounded-lg px-3 py-1.5"
            >
              ↻ 刷新
            </Button>
          </div>
        </div>

        {/* ── 状态筛选 pills ── */}
        <div className="mb-6 flex flex-wrap gap-2">
          {FILTERS.map((filterOption) => {
            const isActive = c.filter === filterOption.key;
            const count = c.counts[filterOption.key] ?? 0;
            return (
              <Button
                key={filterOption.key}
                variant="ghost"
                size="xs"
                onClick={() => c.switchFilter(filterOption.key)}
                className={
                  "h-auto gap-2 rounded-full px-3 py-1.5 " +
                  (isActive
                    ? "bg-primary-solid text-primary-foreground hover:bg-primary-600 shadow-primary-500/20 shadow-md"
                    : "border-border bg-card text-ink-strong hover:bg-surface-2 border")
                }
              >
                {filterOption.dotCls && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${filterOption.dotCls}`}
                  />
                )}
                <span>{filterOption.label}</span>
                <span
                  className={
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                    (isActive
                      ? "bg-subtle5 text-white"
                      : "bg-surface-2 text-ink-faint")
                  }
                >
                  {count}
                </span>
              </Button>
            );
          })}
        </div>

        {c.loading ? (
          <p className="text-ink-muted text-sm">加载中…</p>
        ) : c.filteredCount === 0 ? (
          <div className="border-border text-ink-muted grid min-h-[300px] place-items-center rounded-2xl border border-dashed">
            <div className="text-center">
              <p className="text-ink-strong text-lg font-medium">
                {c.empty.title}
              </p>
              <p className="mt-1 text-sm">{c.empty.hint}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {c.visibleGroups.map((group) => (
              <section key={group.key}>
                {/* ── 日期分组标题 ── */}
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-4 w-1 rounded-full bg-linear-to-b from-violet-500 to-fuchsia-500" />
                  <h2 className="text-ink-strong text-sm font-semibold">
                    {group.key}
                  </h2>
                  <span className="text-ink-fainter text-xs">
                    {group.items.length} 个任务
                  </span>
                  <div className="bg-subtle h-px flex-1" />
                </div>

                {/* ── 任务列表 ── */}
                <HistoryGroupTaskList
                  items={group.items}
                  progressMap={c.progressMap}
                  retryingId={c.retryingId}
                  onOpenDetail={c.openDetail}
                  onCancel={c.cancel}
                  onRetry={c.retry}
                  onRemove={c.remove}
                />
              </section>
            ))}

            {/* ── 分页 footer ── */}
            <div className="border-border-subtle flex items-center justify-center gap-3 border-t pt-6">
              <span className="text-ink-muted text-xs">
                已加载 {c.visibleTotal} / {c.filteredCount} 个任务
              </span>
              {c.canLoadMore ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={c.loadMore}
                  className="border-border bg-subtle text-ink-strong hover:bg-surface-2 h-auto rounded-lg px-4 py-1.5"
                >
                  加载更多
                </Button>
              ) : (
                <span className="text-ink-fainter text-[11px]">已全部加载</span>
              )}
            </div>
          </div>
        )}
      </div>

      <HistoryDetailModal
        detailId={c.detailId}
        detail={c.detail}
        detailLoading={c.detailLoading}
        workflowHints={c.workflowHints}
        onClose={c.closeDetail}
      />
    </div>
  );
}
