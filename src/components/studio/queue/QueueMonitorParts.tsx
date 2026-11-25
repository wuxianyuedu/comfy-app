"use client";

import type { ReactNode } from "react";
import { Activity, ChevronDown, Copy, FileText, FolderOpen, X } from "lucide-react";

import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/ui/status-badge";
import { TruncatedText } from "~/components/ui/truncated-text";
import { TimeAgo } from "~/components/ui/time-ago";
import { displayValue } from "~/lib/display-value";
import { isTerminalTaskStatus, taskStatusLabel } from "~/lib/task-state";

import type { QueueTaskParamRow } from "./queue-task-params";
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

/** 一条度量：瓦片里的「上标签下数值」（重设计稿）。数值是「算出来的字符串」，
 * 空值不假装是 0；瓦片底用页面底色档，在白卡上读出一格一格。 */
export function Field({ label, children }: { children: string; label: string }) {
  return (
    <div className="bg-canvas min-w-0 rounded-xl px-3.5 py-3">
      <dt className="text-ink-fainter text-2xs truncate">{label}</dt>
      <dd className="text-ink-strong mt-0.5 min-w-0 tabular-nums">
        {/* 值变了闪一下（`value-tick`，规范 06 §6.7 第 ③ 档）：这一屏每 1s 被
            轮询刷一次，「已跑 12 秒」与「已跑 13 秒」在屏幕上长得一模一样 ——
            不动一下的话，用户分不出「它还在动」与「它卡住了」。
            `key` 换成当前值即触发重挂载：**值没变就不重播**，于是它天然是
            「变化提示」而不是第二条循环动画。 */}
        <TruncatedText
          className="value-tick inline-block min-w-0 truncate text-sm font-semibold"
          key={children}
        >
          {displayValue(children)}
        </TruncatedText>
      </dd>
    </div>
  );
}

/** 展开后的输入参数表（ISSUE #5019）：两列网格，行来自
 * `queue-task-params` 的纯派生（长值已截断）。 */
export function QueueParamTable({
  detailLoading,
  paramRows,
}: {
  detailLoading: boolean;
  paramRows: Array<QueueTaskParamRow>;
}) {
  if (detailLoading) {
    return <p className="text-ink-fainter px-0.5 text-xs">正在读取任务详情…</p>;
  }
  if (paramRows.length === 0) {
    return <p className="text-ink-fainter px-0.5 text-xs">没有读到可展示的输入参数。</p>;
  }
  return (
    <dl className="border-border-subtle bg-canvas-deep grid gap-x-4 gap-y-1 rounded-lg border p-2.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
      {paramRows.map((row) => (
        <div className="contents" key={`${row.label}-${row.value}`}>
          <dt className="text-ink-fainter text-2xs truncate pt-0.5">{row.label}</dt>
          <dd className="text-ink-strong min-w-0 text-xs break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * 一行任务。排队行给 `leading`（位次），最近结果行不给（由状态徽标说话）。
 * 状态走 StatusBadge 语义色档、视图不出现颜色档（换主题不用改这里，规范 03 §3.6.2）；
 * 动作走 Button 基元，busy 时禁用（判据在 controller，本行不自己比 id）。
 * 模型徽标（ISSUE #5019）：`modelName` 来自工作流上挂的模型标签 —— 一眼看出
 * 这条队列任务是哪个模型的。`onToggleParams` 在场时给「参数」展开按钮，
 * 展开后参数表就地铺开（数据 = task.detail 的纯派生）。
 */
export function QueueRowLine({
  row,
  leading,
  busy,
  onCancel,
  onCopy,
  onOpenFolder,
  onOpenLog,
  onToggleParams,
  paramRows = [],
  paramsExpanded = false,
  paramsLoading = false,
}: {
  busy: boolean;
  leading?: string;
  onCancel: () => void;
  onCopy: () => void;
  onOpenFolder: () => void;
  onOpenLog: () => void;
  onToggleParams?: () => void;
  paramRows?: Array<QueueTaskParamRow>;
  paramsExpanded?: boolean;
  paramsLoading?: boolean;
  row: QueueRow;
}) {
  const terminal = isTerminalTaskStatus(row.status);
  return (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-ink-faint w-16 shrink-0 text-xs tabular-nums">
          {/* 水合安全口径（ISSUE #4852）：挂载前渲染稳定占位，挂载后再算相对时间。 */}
          {leading ?? <TimeAgo fallback="时间未知" value={row.createdAt.getTime()} />}
        </span>
        <TruncatedText className="text-ink min-w-0 flex-1 basis-40 truncate text-sm">
          {displayValue(row.workflowName)}
        </TruncatedText>
        {row.modelName !== null && row.modelName !== "" ? (
          <span className="bg-subtle text-ink-muted text-2xs max-w-40 truncate rounded-full px-2 py-0.5">
            {row.modelName}
          </span>
        ) : null}
        <TruncatedText className="text-ink-fainter min-w-0 basis-40 truncate text-xs sm:flex-1">
          {displayValue(row.prompt)}
        </TruncatedText>
        {terminal ? <StatusBadge label={taskStatusLabel(row.status)} status={row.status} /> : null}
        {row.error !== null && row.error !== "" ? (
          <TruncatedText className="text-danger-strong min-w-0 basis-full truncate text-xs">
            {row.error}
          </TruncatedText>
        ) : null}
        {/* 动作组：间距拉开一档 + 悬停时图标随文字转主题色（ISSUE #4630 微交互）；
            lucide 图标走 currentColor，悬停变色只需作用在按钮字色上。 */}
        <span className="flex shrink-0 items-center gap-2">
          {onToggleParams ? (
            <Button
              aria-expanded={paramsExpanded}
              aria-label="查看这一条的输入参数"
              className="text-ink-faint hover:text-primary-strong h-auto gap-1"
              onClick={onToggleParams}
              size="xs"
              variant="ghost"
            >
              <ChevronDown
                aria-hidden
                className={`size-3 transition-transform ${paramsExpanded ? "rotate-180" : ""}`}
                data-icon="inline-start"
              />
              参数
            </Button>
          ) : null}
          <Button
            aria-label="查看这一条的执行日志"
            className="text-ink-faint hover:text-primary-strong h-auto gap-1"
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
                className="text-ink-faint hover:text-primary-strong h-auto gap-1"
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
                className="text-ink-faint hover:text-primary-strong h-auto gap-1"
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
              className="text-ink-faint hover:text-primary-strong h-auto gap-1"
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
      {onToggleParams !== undefined && paramsExpanded ? (
        <div className="pl-[4.5rem]">
          <QueueParamTable detailLoading={paramsLoading} paramRows={paramRows} />
        </div>
      ) : null}
    </div>
  );
}
