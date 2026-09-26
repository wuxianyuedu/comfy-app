"use client";

import { ListChecks, ListOrdered, RefreshCcw } from "lucide-react";

import { AuroraBackground } from "~/components/ui/aurora-background";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { ProgressBar } from "~/components/ui/progress-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import { displayValue } from "~/lib/display-value";
import { taskStatusLabel } from "~/lib/task-state";

import type { QueueMonitorController } from "./hooks/use-queue-monitor";
import { Field, QueueRowLine, SectionHeading } from "./QueueMonitorParts";
import { emptyStateText } from "./queue-monitor-config";

/**
 * 队列与运行 · 第③层（纯视图）：只渲染 controller，不发请求、不含业务规则。
 *
 * 三段各答一件事，顺序就是读屏顺序 —— 跑动中（还要多久）→ 排队中（下一条是不是
 * 我的）→ 最近结果（失败的那条到底为什么失败）。
 */
export function QueueMonitorView({
  c,
  onOpenSettings,
}: {
  c: QueueMonitorController;
  onOpenSettings: () => void;
}) {
  const empty = emptyStateText(c.online, c.waitingCount);
  const hasRecent = c.recent.length > 0;
  /* 先收成局部常量：属性上的收窄在事件闭包里会失效，不收就得写
   * `c.running?.id ?? ""` 这种「拿空串假装它存在」的兜底。 */
  const running = c.running;

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-title u-title-page">队列与运行</h1>
            <p className="text-ink-muted mt-1 text-sm">
              每 2 秒读一次本机后端；位次按提交先后排，第 1 位就是下一个开跑的。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          </div>
        </header>

        {c.loadError ? (
          <EmptyState
            className="mb-6"
            variant="hint"
            title={c.loadError}
            description="读不到任务记录时不沿用旧数据 —— 把已经结束的条目显示成还在跑，比读到空更坏。"
          />
        ) : null}

        {!c.online ? (
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
        ) : (
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
                  <div className="mt-3 flex justify-end">
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
              ) : (
                <EmptyState
                  variant="hint"
                  minHeightClass="min-h-[120px]"
                  title={empty.title}
                  description={empty.description}
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
              <SectionHeading id="queue-recent-heading">
                最近结果
              </SectionHeading>
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
        )}
      </div>
    </div>
  );
}
