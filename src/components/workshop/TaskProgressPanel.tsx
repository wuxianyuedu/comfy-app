"use client";

// ── 测试模型页「分节点生成进度」可视化区（规范 §17 第③层：纯展示）────────
// 数据来自执行日志里的 `[comfy-cli 原始]` JSON 事件（comfy-cli progress /
// executing / executed / execution_cached），解析收在 lib/workshop/task-log-progress
// （唯一实现）。没有进度形状日志（对话 / API 中继通道）时返回 null，不摆空盒子。
// 时间维度（#4754）：头部显示整轮「已运行」（最早 → 最新事件，日志每帧到达
// 即刷新、完成后定格为总耗时）；每行显示该节点耗时（已完成 = 收尾 − 开始，
// 运行中 = 最新事件 − 开始）。时长文案走 ~/lib/time-format 的 formatDurationMs。
// 缓存跳过的节点也按执行顺序列出、标「缓存跳过」、不画进度条（#4757）。

import { useMemo } from "react";
import { CircleCheck } from "lucide-react";

import { ProgressBar } from "~/components/ui/progress-bar";
import { Spinner } from "~/components/ui/spinner";
import { formatDurationMs } from "~/lib/time-format";
import { cn } from "~/lib/utils";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import {
  parseTaskLogProgress,
  type TaskProgressStage,
  type TaskProgressSnapshot,
} from "~/lib/workshop/task-log-progress";

/** 一行节点进度：状态图标 + 节点名 + 进度条（缓存节点没有进度语义，不画）+ 计数与耗时。 */
function StageRow({
  cached,
  caption,
  done,
  nodeLabel,
  pct,
  subLabel,
}: {
  cached: boolean;
  caption: string;
  done: boolean;
  nodeLabel: string;
  pct: number | null;
  subLabel: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      {done ? (
        <CircleCheck aria-hidden className="text-success size-3.5 shrink-0" />
      ) : (
        <Spinner aria-hidden className="text-primary size-3.5 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-xs font-medium",
              done ? "text-muted-foreground" : "text-primary-strong",
            )}
          >
            {nodeLabel}
            {subLabel !== "" && (
              <span className="text-ink-fainter ml-1.5 font-normal">{subLabel}</span>
            )}
          </span>
          <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">{caption}</span>
        </div>
        {!cached && (
          <ProgressBar
            ariaLabel={`${nodeLabel} 进度`}
            className="mt-1"
            showValue={false}
            trackClassName="h-1.5"
            value={pct}
          />
        )}
      </div>
    </div>
  );
}

/** 一行的右侧文案：计数（completed/total）与耗时并排；运行中无计数时补状态词。 */
function captionFor(stage: TaskProgressStage, snapshot: TaskProgressSnapshot): string {
  if (stage.cached === true && stage.completed === undefined) {
    /* 命中缓存跳过的节点：没有进度语义，标「缓存跳过」。 */
    return "缓存跳过";
  }
  const parts: Array<string> = [];
  if (stage.completed !== undefined && stage.total !== undefined) {
    parts.push(`${String(stage.completed)}/${String(stage.total)}`);
  }
  const durationMs =
    stage.status === "done"
      ? (stage.durationMs ?? null)
      : stage.startedAt !== undefined && snapshot.lastAt !== null
        ? snapshot.lastAt - stage.startedAt
        : null;
  const duration = formatDurationMs(durationMs);
  if (duration !== null) {
    parts.push(duration);
  }
  if (parts.length === 0) {
    return stage.status === "done" ? "已完成" : "进行中";
  }
  if (stage.status === "running" && stage.completed === undefined) {
    /* 只有耗时没有计数的运行中节点：补状态词，避免孤零零一个「0s」。 */
    return `进行中 · ${duration}`;
  }
  return parts.join(" · ");
}

/** 分节点进度区：日志里有进度形状的事件才渲染。 */
export function TaskProgressPanel({ logs }: { logs: ReadonlyArray<TaskLogEntry> }) {
  const snapshot = useMemo(() => parseTaskLogProgress(logs), [logs]);
  /* 全部节点按执行顺序列出（#4757）：缓存跳过的步骤也在内，用户要求「都列出来」，
   * 不再做「有进度数字 / 运行中」的过滤，也不截断。 */
  const { stages: rows } = snapshot;
  if (rows.length === 0) {
    return null;
  }
  const elapsed =
    snapshot.firstAt !== null && snapshot.lastAt !== null
      ? formatDurationMs(snapshot.lastAt - snapshot.firstAt)
      : null;
  return (
    <div
      className="border-border bg-surface-1 rounded-lg border px-4 py-3"
      data-testid="task-progress-panel"
      role="status"
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium">生成进度（分节点）</span>
        <span className="text-muted-foreground text-2xs tabular-nums">
          解析自执行日志{elapsed === null ? "" : ` · 已运行 ${elapsed}`}
        </span>
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map((stage) => (
          <StageRow
            cached={stage.cached === true}
            caption={captionFor(stage, snapshot)}
            done={stage.status === "done"}
            key={stage.nodeId}
            nodeLabel={stage.title ?? stage.nodeId}
            pct={stage.pct}
            subLabel={stage.classType ?? ""}
          />
        ))}
      </div>
    </div>
  );
}
