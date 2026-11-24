"use client";

// ── 测试模型页 · 「生成队列」总览卡（第③层：只渲染 + 上抛）─────────────
// 回答两个问题：① 这个界面能总览生成的全局状况 —— 数据与「队列」页同一份
// controller（task.list 逐条 + /api/comfy/queue 富读数），工坊 / 画布 /
// 工作流库 / 本页发起的任务都在里面；② 排队中 / 任意一条的输入参数可就地
// 展开（task.detail → queue-task-params 纯派生）。日志复用页面已有的
// QueueTaskLogModal（经 onOpenLog 上抛），取消走同一份 controller。

import type { ReactNode } from "react";
import { Activity, AlertCircle, ChevronDown, ListOrdered, RefreshCcw, WifiOff } from "lucide-react";

import type { QueueTaskLogTarget } from "~/components/studio/queue/QueueTaskLogModal";
import type { QueueRow } from "~/components/studio/queue/queue-monitor-config";
import { Button } from "~/components/ui/button";
import { ProgressBar } from "~/components/ui/progress-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import { TimeAgo } from "~/components/ui/time-ago";
import { TruncatedText } from "~/components/ui/truncated-text";
import { displayValue } from "~/lib/display-value";
import { isTerminalTaskStatus, taskStatusLabel } from "~/lib/task-state";

import { SectionCard } from "./ModelTestSectionCard";
import type { ModelTestQueueController } from "./hooks/use-model-test-queue";

/** 一屏最多铺几条排队 / 最近结果：总览卡是「看全局」的，长尾去「队列」页。 */
const QUEUED_PREVIEW = 5;
const RECENT_PREVIEW = 4;

/** 紧凑指标条（队列页是大瓦片，这里四个小芯片就够——总览卡要给输入区让密度）。 */
function StatChips({ c }: { c: ModelTestQueueController }) {
  const chips = [
    { label: "运行中", value: c.stats.running, className: "bg-info/10 text-info-strong" },
    { label: "排队中", value: c.stats.queued, className: "bg-warning/10 text-warning-strong" },
    {
      label: "今日完成",
      value: c.stats.succeededToday,
      className: "bg-success/10 text-success-strong",
    },
    {
      label: "失败",
      value: c.stats.failedToday,
      className: "bg-destructive/10 text-danger-strong",
    },
  ];
  return (
    <div aria-label="队列概览" className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tabular-nums ${chip.className}`}
          key={chip.label}
        >
          {chip.label}
          <span className="text-sm font-bold">{String(chip.value)}</span>
        </span>
      ))}
    </div>
  );
}

/** 展开后的输入参数表：两列网格，长值截断（判据在纯派生层）。 */
function ParamTable({
  detailLoading,
  paramRows,
}: {
  detailLoading: boolean;
  paramRows: ModelTestQueueController["paramRows"];
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

/** 一条任务的行：身份（位次 / 时间 + 工作流名 + 模型名）+ 提示词副行 +
 *  动作（参数 / 日志 / 取消），展开后参数表就地铺开。排队与最近结果共用，
 *  差异只在 leading 与状态徽标（终态才亮徽标，位次 / 时间自己说话）。 */
function QueueOverviewRow({
  busy,
  detailLoading,
  expanded,
  leading,
  onCancel,
  onOpenLog,
  onToggle,
  paramRows,
  row,
}: {
  busy: boolean;
  detailLoading: boolean;
  expanded: boolean;
  /** 位次（排队行）或 undefined（最近结果行走 TimeAgo）。 */
  leading?: string;
  onCancel: () => void;
  onOpenLog: () => void;
  onToggle: () => void;
  paramRows: ModelTestQueueController["paramRows"];
  row: QueueRow;
}) {
  const terminal = isTerminalTaskStatus(row.status);
  return (
    <li className="border-border-subtle border-b px-3 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-ink-faint w-16 shrink-0 text-xs tabular-nums">
          {/* 水合安全口径（ISSUE #4852）：挂载前渲染稳定占位。 */}
          {leading ?? <TimeAgo fallback="时间未知" value={row.createdAt.getTime()} />}
        </span>
        <TruncatedText className="text-ink min-w-0 flex-1 basis-40 truncate text-sm">
          {displayValue(row.workflowName)}
        </TruncatedText>
        {row.modelName !== null && row.modelName !== "" && (
          <span className="bg-subtle text-ink-muted text-2xs max-w-40 truncate rounded-full px-2 py-0.5">
            {row.modelName}
          </span>
        )}
        {terminal ? <StatusBadge label={taskStatusLabel(row.status)} status={row.status} /> : null}
        <span className="flex shrink-0 items-center gap-2">
          <Button
            aria-expanded={expanded}
            aria-label="查看这条的输入参数"
            className="text-ink-faint hover:text-primary-strong h-auto gap-1"
            onClick={onToggle}
            size="xs"
            variant="ghost"
          >
            <ChevronDown
              aria-hidden
              className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              data-icon="inline-start"
            />
            参数
          </Button>
          <Button
            aria-label="查看这一条的执行日志"
            className="text-ink-faint hover:text-primary-strong h-auto gap-1"
            onClick={onOpenLog}
            size="xs"
            variant="ghost"
          >
            日志
          </Button>
          <Button
            aria-label="取消这一条"
            className="text-ink-faint hover:text-primary-strong h-auto gap-1"
            disabled={busy || terminal}
            onClick={onCancel}
            size="xs"
            variant="ghost"
          >
            {busy ? "处理中" : "取消"}
          </Button>
        </span>
      </div>
      <TruncatedText className="text-ink-fainter mt-0.5 min-w-0 truncate text-xs">
        {displayValue(row.prompt)}
      </TruncatedText>
      {row.error !== null && row.error !== "" && (
        <TruncatedText className="text-danger-strong mt-0.5 min-w-0 truncate text-xs">
          {row.error}
        </TruncatedText>
      )}
      {expanded && (
        <div className="mt-2">
          <ParamTable detailLoading={detailLoading} paramRows={paramRows} />
        </div>
      )}
    </li>
  );
}

/** 「生成队列」总览卡。挂在中栏底部、随页签活跃轮询（门控在 hook 里）。 */
export function ModelTestQueuePanel({
  c,
  onOpenLog,
}: {
  c: ModelTestQueueController;
  /** 打开执行日志大屏（与测试格 / 队列页同一份弹窗）。 */
  onOpenLog: (task: QueueTaskLogTarget) => void;
}) {
  const queuedPreview = c.queued.slice(0, QUEUED_PREVIEW);
  const recentPreview = c.recent.slice(0, RECENT_PREVIEW);
  const hiddenQueued = c.queued.length - queuedPreview.length;
  const hiddenRecent = c.recent.length - recentPreview.length;
  const running = c.running;
  const offlineRunning = running === null ? c.runningRows : [];

  const sectionTitle = (text: string, extra?: ReactNode) => (
    <p className="text-ink-soft flex items-center gap-1.5 text-xs font-semibold">
      {text}
      {extra}
    </p>
  );

  return (
    <SectionCard
      actions={
        <>
          <span className="text-ink-faint text-xs tabular-nums">{`待执行 ${String(c.waitingCount)}`}</span>
          <Button
            aria-label="立即重新读取队列"
            className="border-border text-ink-faint hover:text-ink-bright h-auto gap-1 rounded-lg px-2.5 py-1"
            onClick={c.refresh}
            size="xs"
            variant="outline"
          >
            <RefreshCcw aria-hidden className="size-3" data-icon="inline-start" />
            刷新
          </Button>
        </>
      }
      hint="全局：工坊 / 画布 / 工作流库 / 本页同源"
      icon={<Activity />}
      title="生成队列"
    >
      <StatChips c={c} />

      {c.loadError !== null && c.loadError !== "" && (
        <p className="text-destructive text-xs">{c.loadError}</p>
      )}
      {!c.online && (
        <p className="bg-warning/10 text-warning-strong flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs">
          <WifiOff aria-hidden className="size-3.5" />
          ComfyUI 未连接 —— 队列里的任务暂不会开始；连接恢复后自动接上。
        </p>
      )}

      {/* ── 跑动中：富卡片来自 /api/comfy/queue；离线退回库里的 RUNNING 行 ── */}
      {sectionTitle("跑动中")}
      {running === null ? (
        <>
          {offlineRunning.map((row) => (
            <div className="border-border bg-canvas-deep rounded-xl border p-3" key={row.id}>
              <div className="flex flex-wrap items-center gap-2">
                <TruncatedText className="text-ink-bright min-w-0 flex-1 truncate text-sm font-semibold">
                  {displayValue(row.workflowName, { fallback: "（未知工作流）" })}
                </TruncatedText>
                <StatusBadge label={taskStatusLabel("RUNNING")} status="RUNNING" />
              </div>
              <ProgressBar className="mt-2" label="采样进度" value={row.progress} />
              <p className="text-ink-fainter mt-1.5 text-xs">
                ComfyUI 未连接，连接后显示耗时与节点明细。
              </p>
            </div>
          ))}
          {offlineRunning.length === 0 && (
            <p className="text-ink-fainter flex items-center gap-1.5 text-xs">
              <Activity aria-hidden className="size-3.5" />
              没有在跑的任务。
            </p>
          )}
        </>
      ) : (
        <article className="border-border bg-canvas-deep rounded-xl border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <TruncatedText className="text-ink-bright min-w-0 flex-1 truncate text-sm font-semibold">
              {displayValue(running.workflowName, { fallback: "（未知工作流）" })}
            </TruncatedText>
            <StatusBadge label={taskStatusLabel("RUNNING")} status="RUNNING" />
          </div>
          <ProgressBar className="mt-2" label="采样进度" value={running.progressPct} />
          <div className="text-ink-muted mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <span>已跑 {running.elapsedText}</span>
            <span>预计剩余 {running.remainingText}</span>
            <span className="min-w-0 truncate">当前节点 {running.nodeText}</span>
            <span className="min-w-0 truncate">主模型 {running.modelText}</span>
          </div>
          <div className="mt-2 flex justify-end gap-1">
            <Button
              aria-label="查看正在跑这条的执行日志"
              className="h-auto gap-1"
              onClick={() => {
                onOpenLog({
                  id: running.id,
                  status: "RUNNING",
                  workflowName: running.workflowName,
                });
              }}
              size="xs"
              variant="ghost"
            >
              日志
            </Button>
            <Button
              aria-label="取消正在跑的这条"
              className="border-border rounded-lg"
              disabled={c.isBusy(running.id)}
              onClick={() => {
                void c.cancel(running.id, running.workflowName);
              }}
              size="xs"
              variant="outline"
            >
              {c.isBusy(running.id) ? "处理中" : "取消这条"}
            </Button>
          </div>
        </article>
      )}

      {/* ── 排队中：位次 = 下一个开跑的顺序；展开看输入参数 ── */}
      {sectionTitle(
        "排队中",
        <span className="text-ink-faint font-normal">（{String(c.queued.length)}）</span>,
      )}
      {queuedPreview.length > 0 ? (
        <ol className="border-border bg-canvas-deep overflow-hidden rounded-xl border">
          {queuedPreview.map(({ position, row }) => (
            <QueueOverviewRow
              busy={c.isBusy(row.id)}
              detailLoading={c.expandedId === row.id && c.detailLoading}
              expanded={c.expandedId === row.id}
              key={row.id}
              leading={`第 ${String(position)} 位`}
              onCancel={() => {
                void c.cancel(row.id, row.workflowName);
              }}
              onOpenLog={() => {
                onOpenLog({ id: row.id, status: row.status, workflowName: row.workflowName });
              }}
              onToggle={() => {
                c.toggleExpanded(row.id);
              }}
              paramRows={c.expandedId === row.id ? c.paramRows : []}
              row={row}
            />
          ))}
        </ol>
      ) : (
        <p className="text-ink-fainter flex items-center gap-1.5 text-xs">
          <ListOrdered aria-hidden className="size-3.5" />
          没有排队中的条目。提交新任务后它会出现在这里，位次按提交先后排。
        </p>
      )}
      {hiddenQueued > 0 && (
        <p className="text-ink-fainter text-2xs">
          还有 {String(hiddenQueued)} 条排队中 —— 完整列表在侧栏「队列」页。
        </p>
      )}

      {/* ── 最近结果：刚跑完的（含失败原因），同样可展开参数 ── */}
      {sectionTitle("最近结果")}
      {recentPreview.length > 0 ? (
        <ul className="border-border bg-canvas-deep overflow-hidden rounded-xl border">
          {recentPreview.map((row) => (
            <QueueOverviewRow
              busy={c.isBusy(row.id)}
              detailLoading={c.expandedId === row.id && c.detailLoading}
              expanded={c.expandedId === row.id}
              key={row.id}
              onCancel={() => {
                void c.cancel(row.id, row.workflowName);
              }}
              onOpenLog={() => {
                onOpenLog({
                  error: row.error,
                  id: row.id,
                  status: row.status,
                  workflowName: row.workflowName,
                });
              }}
              onToggle={() => {
                c.toggleExpanded(row.id);
              }}
              paramRows={c.expandedId === row.id ? c.paramRows : []}
              row={row}
            />
          ))}
        </ul>
      ) : (
        <p className="text-ink-fainter text-xs">还没有跑完的任务 —— 完整历史在侧栏「历史」里。</p>
      )}
      {hiddenRecent > 0 && (
        <p className="text-ink-fainter text-2xs">
          还有 {String(hiddenRecent)} 条最近结果 —— 完整列表在侧栏「队列」页。
        </p>
      )}
      <p className="text-ink-fainter text-2xs">
        <AlertCircle aria-hidden className="mr-1 inline size-3" />
        指标与列表跟「队列」页同源（task.list + ComfyUI 队列对账），此处只读；操作（取消 /
        日志）直接生效。
      </p>
    </SectionCard>
  );
}
