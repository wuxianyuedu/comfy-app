"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";

import { HistoryDetailModal } from "./HistoryDetailModal";
import { HistoryTaskCard } from "./HistoryTaskCard";
import { AuroraBackground } from "~/components/ui/aurora-background";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { SelectChip } from "~/components/ui/select-chip";
import { SelectMenu } from "~/components/ui/select-menu";
import { StatusDot } from "~/components/ui/status-dot";
import { pageHeaderTitle } from "../NavItems";
import { ViewActions } from "../ViewActions";
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
  isRetrying,
  onOpenDetail,
  onCancel,
  onRetry,
  onRemove,
}: {
  /** 「这一条在重试吗」的判据由导出它的出口给（规范 16 §16.2.4.40）——
   * 视图不再自己写`retryingId === task.id`。 */
  isRetrying: (id: string) => boolean;
  items: Array<TaskItem>;
  onCancel: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (task: TaskItem) => void;
  progressMap: Record<string, number>;
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
    <div className="flex flex-col gap-3" ref={listRef}>
      {items.map((task) => (
        <HistoryTaskCard
          key={task.id}
          task={task}
          progress={progressMap[task.id] ?? 0}
          retrying={isRetrying(task.id)}
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
export function HistoryList({ onOpenTask: _onOpenTask }: { onOpenTask?: (id: string) => void }) {
  /* 拿掉 modal「打开完整详情 ↗」按钮后 onOpenTask 变成无用 prop,
   * 重命名为 _onOpenTask 让 lint 沉默并保留向下兼容（父组件还在传，旧版可以仍然保留这个 prop）。
   * 用户反馈「在这里点开就显示详情，别在其他界面再显示」—— 历史 modal 是「这里」，
   * 详情只在弹层（HistoryDetailModal，挂在本视图内）里看。曾经的独立详情路由
   * /create/[id] 已退役（#2422），别再把这条路由当在役出口写进注释。 */
  const c = useHistoryList();

  return (
    <DocumentFrame
      width="wide"
      className="px-4 pt-4 pb-6 sm:px-8 sm:pt-5 sm:pb-8"
      backdrop={<AuroraBackground />}
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
          value={c.sort}
          onChange={(value) => c.setSort(/* SAFETY: 类型断言已复核 */ value as SortKey)}
          options={["newest", "oldest"]}
          labels={{ newest: "时间倒序", oldest: "时间正序" }}
          aria-label="排序"
          className="text-xs"
        />
        <Button
          variant="outline"
          size="xs"
          onClick={c.refresh}
          className="border-border text-ink-faint hover:text-ink-bright h-auto rounded-lg px-3 py-1.5"
        >
          ↻ 刷新
        </Button>
      </ViewActions>

      {/* ── 状态筛选（分段 chip）──
          这里此前是手搓的 `<Button variant="ghost">` 一排，选中档给的是
          `bg-primary-solid text-primary-foreground` —— `bg-primary-solid`
          **不是任何一级的 token**（`Button` 的变体叫 `primary-solid`，那是
          `variant` 轴的取值，不是给 className 用的类名），样式表里根本没有
          这条规则。于是选中项**没有底色**，`text-primary-foreground` 的纯白字
          直接压在页面底色上：浅色主题下近乎消失、深色主题下只剩一团白字，
          两套主题都读不出「哪一枚是选中的」（ISSUE #1925，用户截图）。
          计数徽标 `bg-subtle5` 同源 —— 那个类同样不存在。
          现在整排交给 `ui/select-chip`（「一排里选一个」的全库唯一实现，
          规范 16 §16.2.4）：选中态有底色 / 字色 / 描边 / 字重四层，且自带
          与常态同值的 `hover:`，不会被 `Button` 的默认悬停档吃掉。 */}
      <div role="radiogroup" aria-label="按状态筛选任务" className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((filterOption) => {
          const isActive = c.filter === filterOption.key;
          const count = c.counts[filterOption.key] ?? 0;
          return (
            <SelectChip
              key={filterOption.key}
              selected={isActive}
              shape="pill"
              onClick={() => c.switchFilter(filterOption.key)}
              className="gap-2"
            >
              {filterOption.tone && <StatusDot state={filterOption.tone} sizeClass="size-1.5" />}
              <span>{filterOption.label}</span>
              <span
                /* 计数徽标：底色取**当前字色**的淡底（`bg-current/N`），
                   于是选中 / 未选中两态都由同一份语义 token 派生，
                   深浅两套主题各自成立，不必再手写四组类名。
                   α 取 8% 是**量出来的**：徽标底越接近字色、字压在它上面的
                   对比度越低 —— 实测两套主题 × 两态四组读数，
                   0.15 时浅色未选中档掉到 4.33（低于 WCAG AA 的 4.5），
                   0.08 时四组分别是 6.56 / 4.75 / 6.91 / 5.15，全部达标。 */
                className="text-3xs rounded-full bg-current/8 px-1.5 py-0.5 font-bold"
              >
                {count}
              </span>
            </SelectChip>
          );
        })}
      </div>

      {c.loading ? (
        <p className="text-ink-muted text-sm">加载中…</p>
      ) : c.filteredCount === 0 ? (
        <EmptyState title={c.empty.title} description={c.empty.hint} minHeightClass="min-h-75" />
      ) : (
        <div className="flex-col gap-6">
          {c.visibleGroups.map((group) => (
            <section key={group.key}>
              {/* ── 日期分组标题 ── */}
              <div className="mb-3 flex items-center gap-3">
                <div className="u-gradient-brand h-4 w-1 rounded-full" />
                <h2 className="text-ink-strong text-sm font-semibold">{group.key}</h2>
                <span className="text-ink-fainter text-xs">{group.items.length} 个任务</span>
                <div className="bg-subtle h-px flex-1" />
              </div>

              {/* ── 任务列表 ── */}
              <HistoryGroupTaskList
                items={group.items}
                progressMap={c.progressMap}
                isRetrying={c.isRetrying}
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
              <span className="text-ink-fainter text-2xs">已全部加载</span>
            )}
          </div>
        </div>
      )}

      <HistoryDetailModal
        detailId={c.detailId}
        detail={c.detail}
        detailLoading={c.detailLoading}
        workflowIO={c.workflowIO}
        modeContracts={c.modeContracts}
        onClose={c.closeDetail}
      />
    </DocumentFrame>
  );
}
