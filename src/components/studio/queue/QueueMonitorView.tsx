"use client";

import { ListChecks, ListOrdered, RefreshCcw, WifiOff } from "lucide-react";

import { AuroraBackground } from "~/components/ui/aurora-background";
import { DocumentFrame } from "~/components/studio/ViewContainer";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { PageHeader } from "~/components/ui/page-header";
import { ProgressBar } from "~/components/ui/progress-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import { displayValue } from "~/lib/display-value";
import { taskStatusLabel } from "~/lib/task-state";

import type { QueueMonitorController } from "./hooks/use-queue-monitor";
import { Field, QueueRowLine, SectionHeading } from "./QueueMonitorParts";
import {
  offlineBannerText,
  offlineEmptyText,
  offlineRunningCardNote,
  runningHintText,
} from "./queue-monitor-config";

/**
 * 队列与运行 · 第③层（纯视图）：只渲染 controller，不发请求、不含业务规则。
 *
 * 三段各答一件事，顺序就是读屏顺序 —— 跑动中（还要多久）→ 排队中（下一条是不是
 * 我的）→ 最近结果（失败的那条到底为什么失败）。
 *
 * 离线不再整页替换成空态：列表数据来自本地库的 `task.list`，离线照样拿得到，
 * 整页消失正是「状态闪一下」观感的放大器。现在离线且有任务时只多一条 warning
 * 横幅（说清「不会开始 + 连上自动接上」），列表照常铺开；离线且一条任务都没有
 * 才退回整页空态。
 */
export function QueueMonitorView({
  c,
  onOpenSettings,
}: {
  c: QueueMonitorController;
  onOpenSettings: () => void;
}) {
  const hasRecent = c.recent.length > 0;
  /* 先收成局部常量：属性上的收窄在事件闭包里会失效，不收就得写
   * `c.running?.id ?? ""` 这种「拿空串假装它存在」的兜底。 */
  const running = c.running;
  /* 离线兜底卡：富卡片的数据源（/api/comfy/queue）读不到、但库里确有 RUNNING 行。 */
  const offlineRunning = running === null ? c.runningRows : [];
  const hasAny =
    running !== null ||
    c.runningRows.length > 0 ||
    c.queued.length > 0 ||
    hasRecent;
  const empty = offlineEmptyText();
  const banner = offlineBannerText();
  const runningHint = runningHintText(c.online, c.waitingCount);
  const offlineNote = offlineRunningCardNote();

  return (
    <DocumentFrame
      width="wide"
      className="px-4 py-6 sm:px-8 sm:py-7"
      backdrop={<AuroraBackground />}
    >
      {/* 屏名由页签给出，页头不再重复一次可见标题（`srTitle` 只留给读屏）——
          此前页签写「队列」、这里的大标题也写「队列」，同一件事占两行而读者
          什么都没多知道（ISSUE #1693，接 ISSUE #1423 没走完的那一半）。
          那句「多久读一次、位次怎么排」不是每次看屏都要读的，收成悬浮说明 ——
          由顶栏标题右侧那颗问号承载（`viewHelp()`），页头里不再放第二颗。 */}
      <PageHeader
        className="mb-6"
        srTitle={pageHeaderTitle("queue")}
        actions={
          <>
            <span className="text-ink-faint text-xs tabular-nums">
              {`待执行 ${String(c.waitingCount)}`}
            </span>
            <Button
              variant="outline"
              size="xs"
              onClick={c.refresh}
              aria-label="立即重新读取队列"
              className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1.5 rounded-lg px-3 py-1.5"
            >
              <RefreshCcw
                data-icon="inline-start"
                className="size-3"
                aria-hidden
              />
              刷新
            </Button>
          </>
        }
      />

      {c.loadError ? (
        <EmptyState
          className="mb-6"
          variant="hint"
          title={c.loadError}
          description="读不到任务记录时不沿用旧数据 —— 把已经结束的条目显示成还在跑，比读到空更坏。"
        />
      ) : null}

      {/* 离线且还有任务：横幅说明「不会开始」，列表照常铺开（数据来自本地库） */}
      {!c.online && hasAny ? (
        <Alert variant="warning" className="mb-6">
          <WifiOff />
          <AlertTitle>{banner.title}</AlertTitle>
          <AlertDescription>{banner.description}</AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="xs"
              onClick={onOpenSettings}
              className="border-warning/40 text-warning-strong hover:bg-warning/10 h-auto gap-1 rounded-lg px-2.5 py-1"
            >
              去设置里启动 ComfyUI
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {/* 离线且一条任务都没有：保留整页空态（有按钮的引导入口） */}
      {!c.online && !hasAny ? (
        <EmptyState
          title={empty.title}
          description={empty.description}
          icon={ListChecks}
          action={
            <Button variant="outline" size="sm" onClick={onOpenSettings}>
              去设置里启动 ComfyUI
            </Button>
          }
        />
      ) : null}

      {c.online || hasAny ? (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="queue-running-heading">
            <SectionHeading id="queue-running-heading">跑动中</SectionHeading>
            {running ? (
              <article className="bg-card border-border rounded-2xl border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-ink-bright min-w-0 flex-1 truncate text-sm font-semibold">
                    {displayValue(running.workflowName, {
                      fallback: "（未知工作流）",
                    })}
                  </h3>
                  <StatusBadge
                    status="RUNNING"
                    label={taskStatusLabel("RUNNING")}
                  />
                </div>
                <ProgressBar
                  className="mt-3"
                  value={running.progressPct}
                  label="采样进度"
                />
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="已跑">{running.elapsedText}</Field>
                  <Field label="预计剩余">{running.remainingText}</Field>
                  <Field label="当前节点">{running.nodeText}</Field>
                  <Field label="主模型">{running.modelText}</Field>
                </dl>
                <div className="mt-3 flex justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      c.openLog({
                        id: running.id,
                        workflowName: running.workflowName,
                        status: "RUNNING",
                      })
                    }
                    aria-label="查看正在跑这条的执行日志"
                    className="h-auto gap-1"
                  >
                    日志
                  </Button>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={c.isBusy(running.id)}
                    onClick={() =>
                      void c.cancel(running.id, running.workflowName)
                    }
                    aria-label="取消正在跑的这条"
                    className="border-border rounded-lg"
                  >
                    {c.isBusy(running.id) ? "处理中" : "取消这条"}
                  </Button>
                </div>
              </article>
            ) : offlineRunning.length > 0 ? (
              <ol className="flex flex-col gap-3">
                {offlineRunning.map((row) => (
                  <li
                    key={row.id}
                    className="bg-card border-border rounded-2xl border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-ink-bright min-w-0 flex-1 truncate text-sm font-semibold">
                        {displayValue(row.workflowName, {
                          fallback: "（未知工作流）",
                        })}
                      </h3>
                      <StatusBadge
                        status="RUNNING"
                        label={taskStatusLabel("RUNNING")}
                      />
                    </div>
                    <ProgressBar
                      className="mt-3"
                      value={row.progress}
                      label="采样进度"
                    />
                    <p className="text-ink-fainter mt-2 text-xs">
                      {offlineNote}
                    </p>
                    <div className="mt-3 flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          c.openLog({
                            id: row.id,
                            workflowName: row.workflowName,
                            status: row.status,
                            error: row.error,
                          })
                        }
                        aria-label="查看正在跑这条的执行日志"
                        className="h-auto gap-1"
                      >
                        日志
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={c.isBusy(row.id)}
                        onClick={() => void c.cancel(row.id, row.workflowName)}
                        aria-label="取消正在跑的这条"
                        className="border-border rounded-lg"
                      >
                        {c.isBusy(row.id) ? "处理中" : "取消这条"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                variant="hint"
                minHeightClass="min-h-30"
                title={runningHint.title}
                description={runningHint.description}
              />
            )}
          </section>

          <section aria-labelledby="queue-waiting-heading">
            <SectionHeading id="queue-waiting-heading">
              {`排队中（${String(c.queued.length)}）`}
            </SectionHeading>
            {c.queued.length > 0 ? (
              <ol className="border-border bg-card overflow-hidden rounded-2xl border">
                {c.queued.map(({ row, position }) => (
                  <li
                    key={row.id}
                    className="border-border border-b px-4 py-3 last:border-b-0"
                  >
                    <QueueRowLine
                      row={row}
                      leading={`第 ${String(position)} 位`}
                      busy={c.isBusy(row.id)}
                      onCancel={() => void c.cancel(row.id, row.workflowName)}
                      onCopy={() => void c.copyForReprint(row)}
                      onOpenFolder={() => void c.openFolder(row)}
                      onOpenLog={() => c.openLog(row)}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-ink-fainter flex items-center gap-1.5 text-xs">
                <ListOrdered className="size-3.5" aria-hidden />
                没有排队中的条目。提交新任务后它会出现在这里，位次按提交先后排。
              </p>
            )}
          </section>

          <section aria-labelledby="queue-recent-heading">
            <SectionHeading id="queue-recent-heading">最近结果</SectionHeading>
            {hasRecent ? (
              <ul className="border-border bg-card overflow-hidden rounded-2xl border">
                {c.recent.map((row) => (
                  <li
                    key={row.id}
                    className="border-border border-b px-4 py-3 last:border-b-0"
                  >
                    <QueueRowLine
                      row={row}
                      busy={c.isBusy(row.id)}
                      onCancel={() => void c.cancel(row.id, row.workflowName)}
                      onCopy={() => void c.copyForReprint(row)}
                      onOpenFolder={() => void c.openFolder(row)}
                      onOpenLog={() => c.openLog(row)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-fainter text-xs">
                还没有跑完过的任务。完整历史在侧栏「历史」里看。
              </p>
            )}
          </section>
        </div>
      ) : null}
    </DocumentFrame>
  );
}
