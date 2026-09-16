"use client";

/* 工作流库的**执行日志入口按钮**（两个页签共用同一扇门）。
 *
 * 「画布节点」与「工坊封装」页签都在跑同一条封装口径的工作流，日志本该只有
 * 一处入口、一份运行登记表。此前两个页签各写各的运行态与日志：一处在跑，
 * 另一处看着像「执行不了」，且用户要在两个地方找日志（ISSUE #611）。
 *
 * 本组件只做「有没有可看的运行 → 显示入口与状态摘要」这一件事，点击上抛打开
 * 全屏日志弹窗（`WorkflowRunLogModal`）。运行数据来自共享的
 * `workflow-run-store`，不碰网络（规范 §17.2 第③层）。 */

import { useMemo, useSyncExternalStore } from "react";

import {
  getWorkflowRunStoreSnapshot,
  subscribeWorkflowRunStore,
  type WorkflowRunSource,
} from "~/lib/workflow-run-store";

export interface WorkflowRunLogButtonProps {
  /** 只看当前工作流的运行记录。 */
  workflowId: string;
  /** 当前页签自己的 taskId（有则优先展示它的状态摘要）。 */
  taskId?: string | null;
  /** 本页签自己的运行是否在跑（带呼吸点）。 */
  running?: boolean;
  /** 可选：只看某个来源的运行（缺省不限）。 */
  source?: WorkflowRunSource;
  onOpen: () => void;
}

export function WorkflowRunLogButton({
  workflowId,
  taskId,
  running = false,
  source,
  onOpen,
}: WorkflowRunLogButtonProps) {
  const snapshot = useSyncExternalStore(
    subscribeWorkflowRunStore,
    getWorkflowRunStoreSnapshot,
    getWorkflowRunStoreSnapshot,
  );
  const runs = useMemo(
    () =>
      snapshot.runs.filter(
        (run) =>
          run.workflowId === workflowId && (!source || run.source === source),
      ),
    [snapshot.runs, workflowId, source],
  );
  if (runs.length === 0) return null;
  const active = taskId ? runs.find((run) => run.taskId === taskId) : runs[0];
  const statusText = !active
    ? `${runs.length} 次运行`
    : active.status === "done"
      ? "上次已完成"
      : active.status === "failed"
        ? "上次已失败"
        : "生成中…";

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="wflib-log-open"
      title="打开执行日志"
      className="border-border bg-panel-deep hover:border-border-strong inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors"
    >
      <span className="text-ink-strong flex items-center gap-1.5 font-medium">
        执行日志
        {running && (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" />
        )}
      </span>
      <span className="text-ink-fainter text-[10.5px]">{statusText}</span>
    </button>
  );
}
