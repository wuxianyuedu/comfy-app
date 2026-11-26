"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { HistoryDetailModal } from "./HistoryDetailModal";
import { HistoryVirtualCardGrid } from "./HistoryVirtualCardGrid";
/* 加入资产库弹窗（ISSUE #4868）：行上「加入资产库」打开；归属 / 分类选择 +
   入库 mutation 都在弹窗自己的逻辑里，列表只负责开与关。 */
import { AddToAssetLibraryDialog } from "~/components/studio/assets/AddToAssetLibraryDialog";
/* 执行日志弹窗与队列页同一份（ISSUE #4619）：同一条任务的「日志」在两个
 * 入口长得一样、同一份 SSE 流。它经 WorkflowRunRawCliModal 静态拖着
 * react18-json-view（重依赖，§12.19），这里**动态**加载把这条静态边断掉
 * ——工作区入口的静态可达图里不再出现 json-viewer。 */
const QueueTaskLogModal = dynamic(() =>
  import("~/components/studio/queue/QueueTaskLogModal").then((m) => m.QueueTaskLogModal),
);
import { AuroraBackground } from "~/components/ui/aurora-background";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import { StatusDot } from "~/components/ui/status-dot";
import { pageHeaderTitle } from "../NavItems";
import { ViewActions } from "../ViewActions";
import { useHistoryList } from "./hooks/use-history-list";
import type { ModelTestRetryPayload } from "./history-detail-derive";
import { FILTERS, type SortKey, type TaskItem } from "./history-types";

/** 排序键的运行时判据：`SelectMenu` 只给字符串，合法档位就这两枚。 */
function isSortKey(value: string): value is SortKey {
  return value === "newest" || value === "oldest";
}

/**
 * 历史记录面板 —— 容器（规范 17 §17.2 第④层）。
 * 只做：取 controller → 传给视图 → 挂详情弹层；不含任何业务规则。
 */
export function HistoryList({
  onOpenTask: _onOpenTask,
  onReprintToModelTest,
}: {
  onOpenTask?: (id: string) => void;
  /** 「重试」折好载荷后的落点（#4841）：工作区带到「测试模型」页预填。 */
  onReprintToModelTest: (payload: ModelTestRetryPayload) => void;
}) {
  /* 拿掉 modal「打开完整详情 ↗」按钮后 onOpenTask 变成无用 prop,
   * 重命名为 _onOpenTask 让 lint 沉默并保留向下兼容（父组件还在传，旧版可以仍然保留这个 prop）。
   * 用户反馈「在这里点开就显示详情，别在其他界面再显示」—— 历史 modal 是「这里」，
   * 详情只在弹层（HistoryDetailModal，挂在本视图内）里看。曾经的独立详情路由
   * /create/[id] 已退役（#2422），别再把这条路由当在役出口写进注释。 */
  const c = useHistoryList({ onReprintToModelTest });

  /* 滚动到底自动加载下一页（ISSUE #5009 反馈：别再一页页手点「加载更多」）。
   * 列表尾部的哨兵元素进视口（预留 120px）且有下一页时自动触发；正在拉取
   * 时不重复触发。jsdom / 老环境没有 IntersectionObserver 时退回手点按钮。 */
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const { canLoadMore, loadingMore, loadMore } = c;
  useEffect(() => {
    const el = sentinelRef.current;
    if (el === null || !canLoadMore || loadingMore || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [canLoadMore, loadingMore, loadMore]);

  /* 「加入资产库」弹窗的目标行（ISSUE #4868）：open 那一刻的快照。 */
  const [libraryTask, setLibraryTask] = useState<TaskItem | null>(null);

  return (
    <DocumentFrame
      backdrop={<AuroraBackground />}
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      width="wide"
    >
      {/* ── Header：标题与侧栏 / 页签同一个出处（`pageHeaderTitle`）。
             这一屏**没有** `viewLabel`：此前页头写「历史记录」，与侧栏 / 页签的
             「历史」各占一处 —— 今天多出来的「记录」两个字没多给任何信息，却让
             同一件事在一屏里有了两个名字（`tests/page-name-single-source.test.ts`
             的 `viewLabel` 判据就是这么把它抓出来的）。── */}
      <PageHeader srTitle={pageHeaderTitle("history")} />

      {/* 排序 / 刷新挂到顶栏（`ViewActions`）—— 屏名由页签给出之后，留在屏内的
          那一行只剩右对齐的两颗按钮、左边一整行空气（ISSUE #1871）。 */}
      <ViewActions>
        <SelectMenu
          aria-label="排序"
          className="text-xs"
          labels={{ newest: "时间倒序", oldest: "时间正序" }}
          onChange={(value) => {
            if (isSortKey(value)) {
              c.setSort(value);
            }
          }}
          options={["newest", "oldest"]}
          value={c.sort}
        />
        <Button
          className="border-border text-ink-faint hover:text-ink-bright h-auto rounded-lg px-3 py-1.5"
          onClick={c.refresh}
          size="xs"
          variant="outline"
        >
          ↻ 刷新
        </Button>
      </ViewActions>

      {/* ── 状态筛选（分段 chip）──
          此前手搓 `<Button variant="ghost">`，选中档用 `bg-primary-solid text-primary-foreground` ——
          前者是 variant 轴取值、不是 className 类，样式表无此规则，选中项无底色、白字压页面底（ISSUE #1925）；
          计数徽标 `bg-subtle5` 同为不存在的类。
          现交给 ui/select-chip（全库唯一「一排选一个」实现）：aria-checked 驱动四层选中态，且自带同值 hover。 */}
      <div aria-label="按状态筛选任务" className="mb-6 flex flex-wrap gap-2" role="radiogroup">
        {FILTERS.map((filterOption) => {
          const isActive = c.filter === filterOption.key;
          const count = c.counts[filterOption.key] ?? 0;
          return (
            <SelectChip
              className="gap-2"
              key={filterOption.key}
              onClick={() => {
                c.switchFilter(filterOption.key);
              }}
              selected={isActive}
              shape="pill"
            >
              {filterOption.tone && <StatusDot sizeClass="size-1.5" state={filterOption.tone} />}
              <span>{filterOption.label}</span>
              <span
                /* 计数徽标：底色取当前字色淡底（bg-current/N），随语义 token 两态/两主题各自成立。
                   α = 8% 是量出来的：0.15 时浅色未选中档对比度掉到 4.33（低于 WCAG AA 4.5）；
                   0.08 时四组读数 6.56 / 4.75 / 6.91 / 5.15 全部达标。 */
                className="text-3xs rounded-full bg-current/8 px-1.5 py-0.5 font-bold"
              >
                {count}
              </span>
            </SelectChip>
          );
        })}
      </div>

      {c.loading ? (
        /* 骨架屏（ISSUE #4749）：与任务卡同形的占位条。 */
        <div aria-label="加载中" className="flex flex-col gap-3" role="status">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton className="h-24 rounded-xl" key={i} />
          ))}
        </div>
      ) : c.filteredCount === 0 ? (
        <EmptyState
          action={
            /* 角标说有、当前页却没有时（#5076）：给一个显式加载入口，别把
             * 唯一能推进 cursor 的按钮随空态一起卸载，用户卡在「暂无失败任务」。 */
            c.canLoadMore && (c.counts[c.filter] ?? 0) > 0 ? (
              <Button disabled={c.loadingMore} onClick={c.loadMore} size="sm" type="button">
                {c.loadingMore ? "加载中…" : "继续加载"}
              </Button>
            ) : undefined
          }
          description={c.empty.hint}
          minHeightClass="min-h-75"
          title={c.empty.title}
        />
      ) : (
        <div className="flex-col gap-6">
          {c.visibleGroups.map((group) => (
            <section key={group.key}>
              {/* ── 日期分组标题 ── 居中时间轴样式（ISSUE #4630）：
                  文字居中、两侧细线，读起来是「列表的分节」而不是「又一行业务信息」。 */}
              <div className="mb-3 flex items-center gap-3">
                <div className="bg-subtle h-px flex-1" />
                <h2 className="text-ink-soft text-xs font-medium">{group.key}</h2>
                <span className="text-ink-fainter text-xs">{group.items.length} 个任务</span>
                <div className="bg-subtle h-px flex-1" />
              </div>

              {/* ── 任务列表 ── */}
              <HistoryVirtualCardGrid
                isRetrying={c.isRetrying}
                isRowBusy={c.isRowBusy}
                items={group.items}
                onAddToLibrary={setLibraryTask}
                onCancel={c.cancel}
                onCopyForReprint={c.copyForReprint}
                onOpenDetail={c.openDetail}
                onOpenFolder={c.openFolder}
                onOpenLog={c.openLog}
                onRemove={c.remove}
                onRetry={c.retry}
                progressMap={c.progressMap}
              />
            </section>
          ))}

          {/* ── 分页 footer（滚动到底自动加载；按钮留给显式补拉） ── */}
          <div className="border-border-subtle flex items-center justify-center gap-3 border-t pt-6">
            <span className="text-ink-muted text-xs">
              已加载 {c.visibleTotal} / {c.total ?? c.filteredCount} 个任务
            </span>
            {c.canLoadMore ? (
              <Button
                className="border-border bg-subtle text-ink-strong hover:bg-surface-2 h-auto rounded-lg px-4 py-1.5"
                disabled={c.loadingMore}
                onClick={c.loadMore}
                size="xs"
                variant="outline"
              >
                {c.loadingMore ? "加载中…" : "加载更多"}
              </Button>
            ) : (
              <span className="text-ink-fainter text-2xs">已全部加载</span>
            )}
          </div>
          {/* 哨兵：滚到它附近就自动加载下一页。 */}
          <div aria-hidden className="h-px w-full" ref={sentinelRef} />
        </div>
      )}

      <HistoryDetailModal
        detail={c.detail}
        detailId={c.detailId}
        detailLoading={c.detailLoading}
        modeContracts={c.modeContracts}
        onClose={c.closeDetail}
        workflowIO={c.workflowIO}
      />
      {/* 加入资产库弹窗（ISSUE #4868）：按行上的「加入资产库」打开。 */}
      <AddToAssetLibraryDialog
        onClose={() => {
          setLibraryTask(null);
        }}
        task={libraryTask}
      />
      {/* 执行日志弹窗（ISSUE #4619）：与队列页同款，按行上的「日志」打开。 */}
      <QueueTaskLogModal onClose={c.closeLog} task={c.logTarget} />
      {/* 删除确认走非阻塞弹窗（ISSUE #3771）：原生 confirm() 在内嵌浏览器里
          未被处置会以 0 CPU 卡死同源渲染进程（连 splash.html 都冻结）。 */}
      <ConfirmDialog
        confirmLabel="删除"
        danger
        description="已生成的文件不会从磁盘删除。"
        onClose={c.cancelRemove}
        onConfirm={c.confirmRemove}
        open={c.removeTarget !== null}
        title="删除任务记录"
      />
    </DocumentFrame>
  );
}
