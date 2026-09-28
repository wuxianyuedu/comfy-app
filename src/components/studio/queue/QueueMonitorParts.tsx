"use client";

import type { ReactNode } from "react";
import { Activity, Copy, FileText, FolderOpen, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { displayValue } from "~/lib/display-value";
import { isTerminalTaskStatus, taskStatusLabel } from "~/lib/task-state";
import { timeAgo } from "~/lib/time-format";

import type { QueueRow } from "./queue-monitor-config";

/** 分区标题（h2）。图标是装饰，读屏靠文字本身。 */
export function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-ink-soft mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide"
    >
      <Activity className="size-3.5" aria-hidden />
      {children}
    </h2>
  );
}

/** 一条度量：上标签下数值。数值是「算出来的字符串」，空值不假装是 0。 */
export function Field({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-fainter truncate text-[11px]">{label}</dt>
      <dd className="text-ink-soft min-w-0 truncate tabular-nums">
        {displayValue(children)}
      </dd>
    </div>
  );
}

/**
 * 一行任务。排队行给 `leading`（位次），最近结果行不给（改由状态徽标说话）。
 *
 * 状态一律走 `StatusBadge` 的语义色档，视图里不出现颜色档 —— 换主题才不用改这里
 * （规范 03 §3.6.2）。动作全走 `Button` 基元：`busy` 时禁用，判据在 controller 里，
 * 本行不自己比 id。
 */
export function QueueRowLine({
  row,
  leading,
  busy,
  onCancel,
  onCopy,
  onOpenFolder,
  onOpenLog,
}: {
  row: QueueRow;
  leading?: string;
  busy: boolean;
  onCancel: () => void;
  onCopy: () => void;
  onOpenFolder: () => void;
  onOpenLog: () => void;
}) {
  const terminal = isTerminalTaskStatus(row.status);
  const ago = timeAgo(row.createdAt.getTime());
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-ink-faint w-16 shrink-0 text-xs tabular-nums">
        {leading ?? displayValue(ago, { fallback: "时间未知" })}
      </span>
      <span className="text-ink min-w-0 flex-1 basis-40 truncate text-sm">
        {displayValue(row.workflowName)}
      </span>
      <span className="text-ink-fainter min-w-0 basis-40 truncate text-xs sm:flex-1">
        {displayValue(row.prompt)}
      </span>
      {terminal ? (
        <StatusBadge status={row.status} label={taskStatusLabel(row.status)} />
      ) : null}
      {row.error ? (
        <span className="text-danger-strong min-w-0 basis-full truncate text-xs">
          {row.error}
        </span>
      ) : null}
      <span className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={onOpenLog}
          aria-label="查看这一条的执行日志"
          className="h-auto gap-1"
        >
          <FileText data-icon="inline-start" className="size-3" aria-hidden />
          日志
        </Button>
        {terminal ? (
          <>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={onOpenFolder}
              aria-label="打开这一条的输出目录"
              className="h-auto gap-1"
            >
              <FolderOpen
                data-icon="inline-start"
                className="size-3"
                aria-hidden
              />
              输出目录
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={onCopy}
              aria-label="复制这一条的提交内容，回画布改完再投一次"
              className="h-auto gap-1"
            >
              <Copy data-icon="inline-start" className="size-3" aria-hidden />
              复制去重投
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={onCancel}
            aria-label="取消这一条"
            className="h-auto gap-1"
          >
            <X data-icon="inline-start" className="size-3" aria-hidden />
            {busy ? "处理中" : "取消"}
          </Button>
        )}
      </span>
    </div>
  );
}
