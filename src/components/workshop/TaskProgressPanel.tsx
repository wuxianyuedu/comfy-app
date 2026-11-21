"use client";

// ── 测试模型页「分节点生成进度」可视化区（规范 §17 第③层：纯展示）────────
// 数据来自执行日志里的 `[comfy-cli 原始]` JSON 事件（comfy-cli progress /
// executing / executed），解析收在 lib/workshop/task-log-progress（唯一实现）。
// 没有进度形状日志（对话 / API 中继通道）时返回 null，不摆空盒子。

import { useMemo } from "react";
import { CircleCheck } from "lucide-react";

import { ProgressBar } from "~/components/ui/progress-bar";
import { Spinner } from "~/components/ui/spinner";
import { tailWindow } from "~/lib/page-window";
import { cn } from "~/lib/utils";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import { parseTaskLogProgress } from "~/lib/workshop/task-log-progress";

/** 最多展开多少个节点行：进度区是辅助信息，长图（十几个节点）全铺会淹没页面。 */
const MAX_ROWS = 6;

/** 一行节点进度：状态图标 + 节点名 + 进度条 + 已完成/总量。 */
function StageRow({
  nodeLabel,
  subLabel,
  pct,
  caption,
  done,
}: {
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
        <ProgressBar
          ariaLabel={`${nodeLabel} 进度`}
          className="mt-1"
          showValue={false}
          trackClassName="h-1.5"
          value={pct}
        />
      </div>
    </div>
  );
}

/** 分节点进度区：日志里有进度形状的事件才渲染。 */
export function TaskProgressPanel({ logs }: { logs: ReadonlyArray<TaskLogEntry> }) {
  const snapshot = useMemo(() => parseTaskLogProgress(logs), [logs]);
  /* 只展示「有进度数字」或「正在跑」的节点：纯加载类节点（加载模型等）完成后
   * 不留行，避免把可视化区变成节点清单。 */
  const rows = snapshot.stages.filter(
    (stage) => stage.status === "running" || stage.completed !== undefined,
  );
  if (rows.length === 0) {
    return null;
  }
  /* 尾窗切片走 ~/lib/page-window 的唯一口径（P63），不手写 slice。 */
  const visible = tailWindow(rows, MAX_ROWS);
  const hiddenCount = rows.length - visible.length;
  return (
    <div
      className="border-border bg-surface-1 rounded-lg border px-4 py-3"
      data-testid="task-progress-panel"
      role="status"
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium">生成进度（分节点）</span>
        <span className="text-muted-foreground text-2xs">解析自执行日志</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {visible.map((stage) => (
          <StageRow
            caption={
              stage.completed !== undefined && stage.total !== undefined
                ? `${String(stage.completed)}/${String(stage.total)}`
                : "进行中"
            }
            done={stage.status === "done"}
            key={stage.nodeId}
            nodeLabel={stage.title ?? stage.nodeId}
            pct={stage.pct}
            subLabel={stage.classType ?? ""}
          />
        ))}
      </div>
      {hiddenCount > 0 && (
        <p className="text-muted-foreground text-2xs mt-2">
          另有 {String(hiddenCount)} 个节点已略去
        </p>
      )}
    </div>
  );
}
