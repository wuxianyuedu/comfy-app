"use client";

import { memo, useState, type ReactNode } from "react";
import { Activity, ArrowUp, ChevronDown, Copy, FileText, FolderOpen, X } from "lucide-react";

import { RequestDetailSection } from "~/components/workshop/ModelTestRequestDetail";
import { TaskLogTimeline } from "~/components/studio/logs/TaskLogTimeline";
import { Button } from "~/components/ui/button";
import { SectionLabel } from "~/components/ui/section-label";
import { KeyValueRows } from "~/components/ui/key-value-rows";
import { ProgressBar } from "~/components/ui/progress-bar";
import { StatusBadge } from "~/components/ui/status-badge";
import { TruncatedText } from "~/components/ui/truncated-text";
import { TimeAgo } from "~/components/ui/time-ago";
import { displayValue } from "~/lib/display-value";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";
import { isTerminalTaskStatus, taskStatusLabel } from "~/lib/task-state";
import type { RouterOutputs } from "~/trpc/react";

import type { QueueRow } from "./queue-monitor-config";
import { runningRequestRow, type QueueTaskParamRow } from "./queue-task-params";

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
  /* 键值行走 `ui/key-value-rows` 基元（P17：视图不自写键值行）。用 `table`
   * 档：键列有语义表头且短标签不换行，值列自然折行不截断（#5074）。 */
  return (
    <KeyValueRows
      className="border-border-subtle bg-canvas-deep"
      items={paramRows.map((row) => ({ id: row.label, key: row.label, value: row.value }))}
      keyWrap
      layout="table"
      mono={false}
    />
  );
}

/** 参数表未展开时的稳定空数组：父级不再为每行现造 `[]`（规范 04 §4.8）。 */
const EMPTY_PARAM_ROWS: Array<QueueTaskParamRow> = [];

/**
 * 一行任务。排队行给 `leading`（位次），最近结果行不给（由状态徽标说话）。
 * 状态走 StatusBadge 语义色档、视图不出现颜色档（换主题不用改这里，规范 03 §3.6.2）；
 * 动作走 Button 基元，busy 时禁用（判据在 controller，本行不自己比 id）。
 * 模型徽标（ISSUE #5019）：`modelName` 来自工作流上挂的模型标签 —— 一眼看出
 * 这条队列任务是哪个模型的。`onToggleParams` 在场时给「参数」展开按钮，
 * 展开后参数表就地铺开（数据 = task.detail 的纯派生）。
 *
 * memo + 稳定回调：父级的轮询每秒都换一批 props 身份，行级闭包若由父级现造，
 * memo 形同虚设。回调统一收成 `(row|id) => void`，
 * 每行的 `onClick` 闭包在本组件自己的 render 里生成。
 */
export const QueueRowLine = memo(function QueueRowLine({
  row,
  leading,
  isBusy,
  onCancel,
  onCopy,
  onMoveUp,
  onOpenFolder,
  onOpenLog,
  onToggleParams,
  paramRows,
  paramsExpanded,
  paramsLoading,
}: {
  isBusy: (id: string) => boolean;
  leading?: string;
  onCancel: (row: QueueRow) => void;
  onCopy: (row: QueueRow) => void;
  onMoveUp: (row: QueueRow) => void;
  onOpenFolder: (row: QueueRow) => void;
  onOpenLog: (row: QueueRow) => void;
  onToggleParams?: (id: string) => void;
  paramRows: Array<QueueTaskParamRow>;
  paramsExpanded: boolean;
  paramsLoading: boolean;
  row: QueueRow;
}) {
  const busy = isBusy(row.id);
  const shownParamRows = paramsExpanded ? paramRows : EMPTY_PARAM_ROWS;
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
        {/* 提示词只在展开的参数表里完整显示一遍（#5074）：行头再摆一份
            截断摘要既重复又看不全。 */}
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
              onClick={() => {
                onToggleParams?.(row.id);
              }}
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
          {/* 排队中还没有开始执行，没有日志可看（#5074）：只在跑动 / 终态给入口。 */}
          {terminal || row.status === "RUNNING" ? (
            <Button
              aria-label="查看这一条的执行日志"
              className="text-ink-faint hover:text-primary-strong h-auto gap-1"
              onClick={() => {
                onOpenLog(row);
              }}
              size="xs"
              variant="ghost"
            >
              <FileText aria-hidden className="size-3" data-icon="inline-start" />
              日志
            </Button>
          ) : null}
          {/* 只有真正排队中的行能调顺序：运行中 / 终态没有这个按钮，服务端也
              只认 QUEUED —— 两侧同判，不会因为竞态把「提前」当成成功。 */}
          {row.status === "QUEUED" ? (
            <Button
              aria-label="把这一条提前到队首"
              className="text-ink-faint hover:text-primary-strong h-auto gap-1"
              disabled={busy}
              onClick={() => {
                onMoveUp(row);
              }}
              size="xs"
              variant="ghost"
            >
              <ArrowUp aria-hidden className="size-3" data-icon="inline-start" />
              {busy ? "处理中" : "提前"}
            </Button>
          ) : null}
          {terminal ? (
            <>
              <Button
                aria-label="打开这一条的输出目录"
                className="text-ink-faint hover:text-primary-strong h-auto gap-1"
                disabled={busy}
                onClick={() => {
                  onOpenFolder(row);
                }}
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
                onClick={() => {
                  onCopy(row);
                }}
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
              onClick={() => {
                onCancel(row);
              }}
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
        /* 展开区铺满整行：此前 pl-[4.5rem] 留出一块空白只为对齐行头，
         * 反而让参数表变窄、标签挤成竖排（#5074）。 */
        <div className="min-w-0">
          <QueueParamTable detailLoading={paramsLoading} paramRows={shownParamRows} />
        </div>
      ) : null}
    </div>
  );
});

/**
 * 运行中任务的四块读数（#5075 / #5093）：统一输入 / 请求信息 / 生成进度 /
 * 执行日志 / 请求返回。与测试模型页同款部件，日志只在展开时由 hook 订阅。
 * 真实的上游请求是实时 dry-run、没有随任务落库，这里如实标注。
 */
export function RunningDetails({
  detail,
  detailLoading,
  logs,
  progressPct,
  settled,
  paramRows,
}: {
  detail: Pick<
    NonNullable<RouterOutputs["task"]["detail"]>,
    "id" | "modelName" | "params" | "prompt" | "status" | "workflowName"
  > | null;
  detailLoading: boolean;
  logs: Array<TaskLogEntry>;
  paramRows: Array<QueueTaskParamRow>;
  progressPct: number;
  settled: { message?: string; ok: boolean } | null;
}) {
  const [excerptPretty, setExcerptPretty] = useState(true);
  return (
    <div className="border-border-subtle bg-canvas-deep mt-2 flex flex-col gap-3 rounded-lg border p-3">
      <div>
        <SectionLabel>统一输入（提交时的参数）</SectionLabel>
        <QueueParamTable detailLoading={detailLoading} paramRows={paramRows} />
      </div>
      <div>
        <SectionLabel>请求信息</SectionLabel>
        {detail === null ? (
          <p className="text-ink-fainter text-xs">
            {detailLoading ? "正在读取任务详情…" : "没有读取到这条任务的请求信息。"}
          </p>
        ) : (
          <RequestDetailSection
            excerptPretty={excerptPretty}
            generating={false}
            generatingSince={null}
            onExcerptPretty={setExcerptPretty}
            rows={[runningRequestRow(detail)]}
            sent
            variant="request"
          />
        )}
        <p className="text-muted-foreground text-2xs mt-2">
          实际请求（模型适配器翻译后发往上游的读数）是实时预览，没有随任务落库；这里显示的是提交时落库的统一输入。
        </p>
      </div>
      <div>
        <SectionLabel>生成进度</SectionLabel>
        <ProgressBar label="采样进度" value={progressPct} />
      </div>
      <div>
        <SectionLabel>执行日志</SectionLabel>
        <div className="custom-scrollbar max-h-64 overflow-y-auto">
          <TaskLogTimeline
            emptySlot={<p className="text-ink-fainter text-xs">等待日志…</p>}
            listClassName="bg-canvas rounded-lg"
            logs={logs}
          />
        </div>
      </div>
      <div>
        <SectionLabel>请求返回</SectionLabel>
        <KeyValueRows
          className="border-border-subtle overflow-hidden rounded-lg border"
          items={[
            {
              id: "status",
              key: "状态",
              raw: settled === null ? "执行中" : settled.ok ? "已完成" : "失败",
            },
            { id: "summary", key: "返回摘要", raw: settled?.message ?? "尚未落定" },
            { id: "logs", key: "日志行数", raw: String(logs.length) },
          ]}
          keyWrap
          layout="table"
          mono={false}
        />
      </div>
    </div>
  );
}
