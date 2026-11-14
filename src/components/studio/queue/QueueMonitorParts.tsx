"use client";

import type { ReactNode } from "react";
import { Activity, Copy, FileText, FolderOpen, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { TruncatedText } from "~/components/ui/truncated-text";
import { displayValue } from "~/lib/display-value";
import { isTerminalTaskStatus, taskStatusLabel } from "~/lib/task-state";
import { timeAgo } from "~/lib/time-format";

import type { QueueRow } from "./queue-monitor-config";

/** 分区标题（h2）。图标是装饰，读屏靠文字本身。 */
export function SectionHeading({ id, children }: { children: ReactNode; id: string }) {
  return (
    <h2
      className="text-ink-soft mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide"
      id={id}
    >
      <Activity aria-hidden className="size-3.5" />
      {children}
    </h2>
  );
}

/** 一条度量：上标签下数值。数值是「算出来的字符串」，空值不假装是 0。 */
export function Field({ label, children }: { children: string; label: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-fainter text-2xs truncate">{label}</dt>
      <dd className="text-ink-soft min-w-0 truncate tabular-nums">
        {/* 值变了闪一下（`value-tick`，规范 06 §6.7 第 ③ 档）：这一屏每 1s 被
            轮询刷一次，「已跑 12 秒」与「已跑 13 秒」在屏幕上长得一模一样 ——
            不动一下的话，用户分不出「它还在动」与「它卡住了」。
            `key` 换成当前值即触发重挂载：**值没变就不重播**，于是它天然是
            「变化提示」而不是第二条循环动画。 */}
        <span className="value-tick inline-block" key={children}>
          {displayValue(children)}
        </span>
      </dd>
    </div>
  );
}

/**
 * 一行任务。排队行给 `leading`（位次），最近结果行不给（由状态徽标说话）。
 * 状态走 StatusBadge 语义色档、视图不出现颜色档（换主题不用改这里，规范 03 §3.6.2）；
 * 动作走 Button 基元，busy 时禁用（判据在 controller，本行不自己比 id）。
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
  busy: boolean;
  leading?: string;
  onCancel: () => void;
  onCopy: () => void;
  onOpenFolder: () => void;
  onOpenLog: () => void;
  row: QueueRow;
}) {
  const terminal = isTerminalTaskStatus(row.status);
  const ago = timeAgo(row.createdAt.getTime());
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-ink-faint w-16 shrink-0 text-xs tabular-nums">
        {leading ?? displayValue(ago, { fallback: "时间未知" })}
      </span>
      <TruncatedText className="text-ink min-w-0 flex-1 basis-40 truncate text-sm">
        {displayValue(row.workflowName)}
      </TruncatedText>
      <TruncatedText className="text-ink-fainter min-w-0 basis-40 truncate text-xs sm:flex-1">
        {displayValue(row.prompt)}
      </TruncatedText>
      {terminal ? <StatusBadge label={taskStatusLabel(row.status)} status={row.status} /> : null}
      {row.error !== null && row.error !== "" ? (
        <TruncatedText className="text-danger-strong min-w-0 basis-full truncate text-xs">
          {row.error}
        </TruncatedText>
      ) : null}
      <span className="flex shrink-0 items-center gap-1">
        <Button
          aria-label="查看这一条的执行日志"
          className="h-auto gap-1"
          onClick={onOpenLog}
          size="xs"
          variant="ghost"
        >
          <FileText aria-hidden className="size-3" data-icon="inline-start" />
          日志
        </Button>
        {terminal ? (
          <>
            <Button
              aria-label="打开这一条的输出目录"
              className="h-auto gap-1"
              disabled={busy}
              onClick={onOpenFolder}
              size="xs"
              variant="ghost"
            >
              <FolderOpen aria-hidden className="size-3" data-icon="inline-start" />
              输出目录
            </Button>
            <Button
              aria-label="复制这一条的提交内容，回画布改完再投一次"
              className="h-auto gap-1"
              disabled={busy}
              onClick={onCopy}
              size="xs"
              variant="ghost"
            >
              <Copy aria-hidden className="size-3" data-icon="inline-start" />
              复制去重投
            </Button>
          </>
        ) : (
          <Button
            aria-label="取消这一条"
            className="h-auto gap-1"
            disabled={busy}
            onClick={onCancel}
            size="xs"
            variant="ghost"
          >
            <X aria-hidden className="size-3" data-icon="inline-start" />
            {busy ? "处理中" : "取消"}
          </Button>
        )}
      </span>
    </div>
  );
}
