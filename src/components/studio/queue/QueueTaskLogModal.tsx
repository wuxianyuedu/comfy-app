"use client";

/**
 * QueueTaskLogModal —— 队列页「执行日志」弹窗。
 *
 * 从「队列与运行」的任意一行点「日志」打开：按 taskId 直连
 * `/api/tasks/:id/stream`（`useTaskLogStream`），服务端回放全量历史再增量
 * 推送 —— 在跑的实时跟、排队的看着它开跑、已结束的回放完整日志。
 *
 * 与工作流库的 `WorkflowRunLogModal` 同款交互（居中大弹窗 + 级别筛选 +
 * 自动滚动 + 加宽/收窄），时间线主体收在共享的 `logs/TaskLogTimeline`；
 * 差异只在头部：队列行的任务不在 workflow-run-store 登记表里（没有
 * workflowId），运行态取自流内的 progress / 终态帧，而不是那个 store。
 *
 * view 层只渲染（§17）：订阅在 `queue/hooks/use-task-log-stream.ts`，
 * 取消复用画布的 `useCancelTask`，「查看完整输出」复用工作流库的
 * `WorkflowRunRawCliModal`。
 */

import { useState } from "react";
import { FileText, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent } from "~/components/ui/dialog";
import { Hint } from "~/components/ui/hint";
import { StatusBadge } from "~/components/ui/status-badge";
import { modalWidth } from "~/components/ui/dialog-width";
import { useWidePanel, WidePanelToggle } from "~/components/ui/wide-panel";
import {
  TaskLogEmptyHint,
  TaskLogTimeline,
} from "~/components/studio/logs/TaskLogTimeline";
import { WorkflowRunRawCliModal } from "~/components/studio/workflow-library/WorkflowRunRawCliModal";
import { useCancelTask } from "~/components/studio/project-canvas/hooks/use-cancel-task";
import { taskStatusLabel } from "~/lib/task-state";

import { useTaskLogStream } from "./hooks/use-task-log-stream";

/** 打开日志弹窗要的最小任务信息（由 controller 从 `task.list` 行 / 跑动中卡收窄）。 */
export interface QueueTaskLogTarget {
  id: string;
  workflowName: string | null;
  /** 打开那一刻的行状态；排队中开跑 / 终态由流内的 progress / settled 更新。 */
  status: string;
  /** 行上的失败原因（有就随错误卡一起展示）。 */
  error?: string | null;
}

/* 弹窗宽度档与工作流库执行日志同密度（时刻 + 级别 + 正文）；写`w-*` 的理由见
 * `~/components/ui/dialog-width` 的文件头（ISSUE #720）。 */
const LOG_WIDTH = modalWidth("w-5xl");

export function QueueTaskLogModal({
  task,
  onClose,
}: {
  task: QueueTaskLogTarget | null;
  onClose: () => void;
}) {
  const stream = useTaskLogStream(task?.id ?? null);
  /* 「查看完整输出」弹窗：comfy-cli 未经截断的完整原文。 */
  const [rawOpen, setRawOpen] = useState(false);
  /* 加宽档与它的记忆收在`~/components/ui/wide-panel`（规范 16 §16.2.4.18）。 */
  const panel = useWidePanel("queue-task-log", LOG_WIDTH);
  /* 取消复用画布同款 hook（视图零 IO）。 */
  const { cancelling, cancel } = useCancelTask({
    taskId: task?.id ?? null,
    onFailed: () => undefined,
  });

  if (!task) return null;

  /* 徽标状态：流内终态 > 流内进度帧 > 打开那一刻的行状态。排队中的任务开跑、
   * 被取消、跑完，都在弹窗里直接翻面，不用等列表那边的轮询。 */
  const status = stream.settled
    ? stream.settled.ok
      ? "SUCCEEDED"
      : "FAILED"
    : stream.started
      ? "RUNNING"
      : task.status;
  /* 还没落定才谈得上「在跑」：raw-cli 弹窗据此决定要不要保持 1.5s 轮询。 */
  const running =
    !stream.settled && (stream.started || task.status === "RUNNING");
  const failureMessage =
    stream.settled && !stream.settled.ok ? stream.settled.message : null;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label="执行日志"
        data-testid="queue-log-modal"
        showCloseButton={false}
        className="bg-transparent p-0 ring-0"
        popupClassName={panel.widthClass}
      >
        <div
          className={`border-border bg-panel flex h-[85vh] flex-col overflow-hidden rounded-2xl border shadow-2xl shadow-black/12 dark:shadow-black/60 ${panel.widthClass}`}
        >
          {/* Header */}
          <div className="border-border bg-card flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={16} className="text-primary-strong shrink-0" />
              <span className="text-ink truncate text-[15px] font-semibold">
                执行日志
              </span>
              <span
                className="text-ink-muted max-w-[220px] truncate text-[11px]"
                title={task.workflowName ?? undefined}
              >
                {task.workflowName ?? "（未知工作流）"}
              </span>
              <StatusBadge
                status={status}
                label={taskStatusLabel(status)}
                dot={false}
                className="px-1.5 py-px text-[10px]"
              />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!stream.settled && (
                <Hint label="取消当前查看的任务" wrap>
                  <Button
                    variant="danger"
                    onClick={() => void cancel()}
                    disabled={cancelling}
                    data-testid="queue-log-cancel"
                    className="h-auto rounded-md px-2 py-0.5 text-[10.5px]"
                  >
                    {cancelling ? "× 取消中…" : "× 取消"}
                  </Button>
                </Hint>
              )}
              <Hint
                label="查看 comfy-cli 完整输出（未经截断、可格式化 JSON）"
                wrap
              >
                <Button
                  variant="ghost"
                  onClick={() => setRawOpen(true)}
                  data-testid="queue-log-raw"
                  className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md px-2 py-0.5 text-[10.5px]"
                >
                  查看完整输出
                </Button>
              </Hint>
              <WidePanelToggle
                panel={panel}
                className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
              />
              <Hint label="关闭" accessibleName>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  className="text-ink-muted hover:bg-subtle hover:text-ink-strong rounded-md"
                >
                  <X data-icon="inline-start" size={16} />
                </Button>
              </Hint>
            </div>
          </div>

          {/* 时间线主体（级别筛选 + 自动滚动 + 虚拟列表 + 底栏计数）—— 共享组件 */}
          <TaskLogTimeline
            logs={stream.logs}
            rowTestId="queue-log-line"
            listClassName="bg-panel-deep/60"
            topSlot={
              (failureMessage ?? task.error) ? (
                <div className="border-destructive/30 bg-destructive/6 text-destructive mb-2 flex-col gap-1 rounded border p-2 text-[13px]">
                  <div className="break-words whitespace-pre-wrap">
                    {failureMessage ?? task.error}
                  </div>
                </div>
              ) : null
            }
            emptySlot={
              <TaskLogEmptyHint
                message={
                  stream.settled && stream.logs.length === 0
                    ? "这条任务没有留下执行日志"
                    : "等待日志…"
                }
              />
            }
          />
        </div>
      </DialogContent>
      <WorkflowRunRawCliModal
        taskId={task.id}
        running={running}
        open={rawOpen}
        onClose={() => setRawOpen(false)}
      />
    </Dialog>
  );
}
