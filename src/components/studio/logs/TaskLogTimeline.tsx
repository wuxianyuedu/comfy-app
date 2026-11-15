"use client";

/**
 * TaskLogTimeline —— 任务执行日志的「时间线主体」：级别筛选页签（带计数）+ 自动滚动 +
 * 虚拟滚动列表 + 底部计数条。纯展示（§17 第③层）：filter / autoscroll 是视觉偏好留组件内，
 * 数据经 props 传入、不发请求；`GlobalStepLogPanel` 暂未迁移（配色与 `data-testid` 自成一套）。
 */

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";

import { Checkbox } from "~/components/ui/checkbox";
import { EmptyState } from "~/components/ui/empty-state";
import { SelectChip } from "~/components/ui/select-chip";
import { TruncatedText } from "~/components/ui/truncated-text";
import { FieldLabel } from "~/components/ui/field";
import { VirtualLogList } from "~/components/studio/logs/VirtualLogList";
import { formatClock } from "~/lib/time-format";
import { LOG_MODAL_MAX_ROWS, tailWindow } from "~/lib/page-window";
import type { TaskLogEntry } from "~/lib/workshop/generation-client";

/* 与项目画布 GlobalStepLogPanel 同款 level badge 配色，走语义 token
 * （§4.11.1 / P71）：error→destructive、warn→warning、success→success、
 * progress→primary、info→info。token 内部含深浅两态，不再写 dark:。 */
type Level = TaskLogEntry["level"];
const LEVEL_STYLES: Record<Level, string> = {
  error: "bg-destructive/15 text-destructive border-destructive/20",
  warn: "bg-warning/15 text-warning-strong border-warning/20",
  success: "bg-success/15 text-success-strong border-success/20",
  progress: "bg-primary/15 text-primary-strong border-primary/20",
  info: "bg-info/15 text-info-strong border-info/20",
};
function levelLabel(level: Level): string {
  switch (level) {
    case "error": {
      return "ERROR";
    }
    case "warn": {
      return "WARN";
    }
    case "success": {
      return "OK";
    }
    case "progress": {
      return "PROG";
    }
    default: {
      return "INFO";
    }
  }
}

/* 与应用日志同款，带毫秒。 */
function fmtTime(t: number): string {
  return formatClock(t, { millis: true });
}

const FILTER_LABELS: Array<{ label: string; value: Level | "all" }> = [
  { label: "全部", value: "all" },
  { label: "错误", value: "error" },
  { label: "警告", value: "warn" },
  { label: "完成", value: "success" },
  { label: "进度", value: "progress" },
  { label: "信息", value: "info" },
];

export type TaskLogTimelineProps = {
  /** 无日志时的占位（各消费方知道自己该说什么）。 */
  emptySlot?: ReactNode;
  /** 列表底色档：跟随各弹窗的面板色（默认透明）。 */
  listClassName?: string;
  /** 全量日志（组件内部按「保留最近 300 条」截尾）。 */
  logs: Array<TaskLogEntry>;
  /** 覆盖默认行渲染器（如画布的 StepLogRow）；不传用标准行。 */
  renderRow?: (log: TaskLogEntry) => ReactNode;
  /** 默认行渲染器的 testid（如 `wflib-modal-log-line`）；自定义 `renderRow` 时忽略。 */
  rowTestId?: string;
  /** 列表顶部插的内容（错误摘要卡等），滚动跟随的判定把它算在内。 */
  topSlot?: ReactNode;
};

/** 弹窗里的行数是一处界面预算，不是「倒数 300 条」这段算式各写一遍 ——
 * 尾部窗口收在`~/lib/page-window`（规范 16 §16.2.4.67）。 */
export function TaskLogTimeline({
  logs,
  rowTestId,
  topSlot,
  emptySlot,
  listClassName,
  renderRow,
}: TaskLogTimelineProps) {
  const [filter, setFilter] = useState<Level | "all">("all");
  /* 贴底与「用户有没有接管滚动」的判据收在`ui/use-scroll-follow`
   *（规范 16 §16.2.4.24）。收口前这里是手写的`scrollTop = scrollHeight`
   * —— 用户上滚读历史会被按回底部，且没有跟随态可显示。 */
  const [autoscroll, setAutoscroll] = useState(true);

  const visibleAll = tailWindow(logs, LOG_MODAL_MAX_ROWS);
  const visible = filter === "all" ? visibleAll : visibleAll.filter((l) => l.level === filter);

  return (
    <>
      {/* 级别筛选栏 —— 一排选一个，走 `ui/select-chip`（规范 16 §16.2.4.75）。
          此前手搓 `ghost` + 选中三元：选中档没钉悬停值，ghost 的 hover 会改写已选中项；
          且 `bg-surface-2` 在浅色主题下与行头底色同值（`log-row-style` 记过），选中本就弱。
          交给基元后选中态四层俱在、悬停值钉回常态。 */}
      <div className="border-border bg-card flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1.5">
        <div aria-label="日志级别筛选" className="flex items-center gap-1" role="radiogroup">
          {FILTER_LABELS.map((option) => {
            const count =
              option.value === "all"
                ? visibleAll.length
                : visibleAll.filter((l) => l.level === option.value).length;
            return (
              <SelectChip
                className="px-2.5 py-1 text-sm"
                key={option.value}
                onClick={() => {
                  setFilter(option.value);
                }}
                selected={filter === option.value}
                shape="compact"
              >
                {option.label}
                <span className="text-ink-fainter text-2xs ml-1">{count}</span>
              </SelectChip>
            );
          })}
        </div>
        <FieldLabel className="text-ink-faint flex cursor-pointer items-center gap-1.5 text-xs select-none">
          <Checkbox
            checked={autoscroll}
            className="accent-primary size-3.5 cursor-pointer"
            onCheckedChange={(checked) => {
              setAutoscroll(checked === true);
            }}
          />
          自动滚动
        </FieldLabel>
      </div>

      {/* Log body — 虚拟滚动（复用 VirtualLogList） */}
      <VirtualLogList
        className={listClassName}
        emptySlot={emptySlot ?? null}
        entries={visible}
        following={autoscroll}
        getMessage={(log) => log.msg}
        onFollowingChange={setAutoscroll}
        renderRow={renderRow ?? ((log) => <DefaultLogRow log={log} rowTestId={rowTestId} />)}
        topSlot={topSlot ?? null}
        watch={`${logs.length}:${filter}`}
      />

      {/* Footer */}
      <div className="border-border bg-card text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-xs">
        <span>
          显示 {visible.length} / 总计 {visibleAll.length} 条
        </span>
        <span>保留最近 300 条</span>
      </div>
    </>
  );
}

/** 标准行：时刻 + 级别徽章 + 正文 + 来源。两处弹窗的行形态一致，收在这里。 */
function DefaultLogRow({ log, rowTestId }: { log: TaskLogEntry; rowTestId?: string }) {
  return (
    <div
      className="border-border-subtle hover:bg-card flex items-start gap-2.5 border-b px-4 py-1 font-mono text-sm leading-snug"
      data-level={log.level}
      data-testid={rowTestId}
    >
      <span className="text-ink-muted shrink-0">{fmtTime(log.t)}</span>
      <span
        className={`text-2xs shrink-0 rounded border px-1.5 py-0.5 font-medium uppercase ${LEVEL_STYLES[log.level]}`}
      >
        {levelLabel(log.level)}
      </span>
      <span className="text-ink-strong min-w-0 flex-1 wrap-break-word whitespace-pre-wrap">
        {log.msg}
      </span>
      {log.src !== undefined && log.src !== "" && (
        <TruncatedText className="text-ink-fainter hover:text-ink-faint text-2xs max-w-50 shrink-0 truncate">
          {log.src}
        </TruncatedText>
      )}
    </div>
  );
}

/** 无日志时的默认占位（消费方不传 `emptySlot` 时兜底，避免空列表静默）。 */
export function TaskLogEmptyHint({ message }: { message: string }) {
  return <EmptyState icon={FileText} title={message} variant="panel" />;
}
