"use client";

/**
 * TaskLogTimeline —— 任务执行日志的「时间线主体」：级别筛选页签（带计数）+
 * 自动滚动 + 虚拟滚动列表 + 底部计数条。
 *
 * 为什么抽出来：这套主体原先在 `workflow-library/WorkflowRunLogModal` 与
 * `project-canvas/GlobalStepLogPanel` 各有一份逐行雷同的实现（与 GlobalStepLogPanel
 * 的差异只在配色档与行渲染器），队列页要再加第三份 —— 按 §12.12 的修法收成
 * 共享组件让各处只留差异，而不是抄第三遍。
 *
 * 形态约定（消费方各自负责的部分）：
 *   · 头部（标题 / 状态徽标 / 取消 / 查看完整输出 / 加宽 / 关闭）与弹窗外壳
 *     留在各消费方 —— 它们绑的是各自的业务状态；
 *   · 本组件是纯展示（§17 第③层）：filter / autoscroll 是无副作用的视觉偏好，
 *     留在组件内（§17.12.2）；日志数据经 props 传入，不发任何请求。
 *
 * `GlobalStepLogPanel` 暂未迁移：它的筛选栏配色档（`bg-surface-1`）与
 * `data-testid` 命名自成一套，迁移要连带改它的用例，另开一批做。
 */

import { useState, type ReactNode } from "react";
import { FileText } from "lucide-react";

import { Checkbox } from "~/components/ui/checkbox";
import { Button } from "~/components/ui/button";
import { FieldLabel } from "~/components/ui/field";
import { Hint } from "~/components/ui/hint";
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
    case "error":
      return "ERROR";
    case "warn":
      return "WARN";
    case "success":
      return "OK";
    case "progress":
      return "PROG";
    default:
      return "INFO";
  }
}

/* 与应用日志同款，带毫秒。 */
function fmtTime(t: number): string {
  return formatClock(t, { millis: true });
}

const FILTER_LABELS: { label: string; value: Level | "all" }[] = [
  { label: "全部", value: "all" },
  { label: "错误", value: "error" },
  { label: "警告", value: "warn" },
  { label: "完成", value: "success" },
  { label: "进度", value: "progress" },
  { label: "信息", value: "info" },
];

export interface TaskLogTimelineProps {
  /** 全量日志（组件内部按「保留最近 300 条」截尾）。 */
  logs: TaskLogEntry[];
  /** 默认行渲染器的 testid（如 `wflib-modal-log-line`）；自定义 `renderRow` 时忽略。 */
  rowTestId?: string;
  /** 列表顶部插的内容（错误摘要卡等），滚动跟随的判定把它算在内。 */
  topSlot?: ReactNode;
  /** 无日志时的占位（各消费方知道自己该说什么）。 */
  emptySlot?: ReactNode;
  /** 列表底色档：跟随各弹窗的面板色（默认透明）。 */
  listClassName?: string;
  /** 覆盖默认行渲染器（如画布的 StepLogRow）；不传用标准行。 */
  renderRow?: (log: TaskLogEntry) => ReactNode;
}

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
  const visible =
    filter === "all"
      ? visibleAll
      : visibleAll.filter((l) => l.level === filter);

  return (
    <>
      {/* 级别筛选栏 */}
      <div className="border-border bg-card flex shrink-0 items-center justify-between gap-3 border-b px-4 py-1.5">
        <div className="flex items-center gap-1">
          {FILTER_LABELS.map((option) => {
            const count =
              option.value === "all"
                ? visibleAll.length
                : visibleAll.filter((l) => l.level === option.value).length;
            return (
              <Hint label={`${option.label}（${count} 条）`} key={option.value}>
                <Button
                  variant="ghost"
                  onClick={() => setFilter(option.value)}
                  className={`h-auto rounded-md px-2.5 py-1 text-[13px] ${
                    filter === option.value
                      ? "bg-surface-2 text-ink"
                      : "text-ink-muted hover:bg-subtle hover:text-ink-strong"
                  }`}
                >
                  {option.label}
                  <span className="text-ink-fainter ml-1 text-[11px]">
                    {count}
                  </span>
                </Button>
              </Hint>
            );
          })}
        </div>
        <FieldLabel className="text-ink-faint flex cursor-pointer items-center gap-1.5 text-[12px] select-none">
          <Checkbox
            checked={autoscroll}
            onCheckedChange={(checked) => setAutoscroll(checked === true)}
            className="accent-primary size-3.5 cursor-pointer"
          />
          自动滚动
        </FieldLabel>
      </div>

      {/* Log body — 虚拟滚动（复用 VirtualLogList） */}
      <VirtualLogList
        entries={visible}
        getMessage={(log) => log.msg}
        renderRow={
          renderRow ??
          ((log) => <DefaultLogRow log={log} rowTestId={rowTestId} />)
        }
        following={autoscroll}
        onFollowingChange={setAutoscroll}
        watch={`${logs.length}:${filter}`}
        className={listClassName}
        topSlot={topSlot ?? null}
        emptySlot={emptySlot ?? null}
      />

      {/* Footer */}
      <div className="border-border bg-card text-ink-muted flex h-9 shrink-0 items-center justify-between border-t px-4 text-[12px]">
        <span>
          显示 {visible.length} / 总计 {visibleAll.length} 条
        </span>
        <span>保留最近 300 条</span>
      </div>
    </>
  );
}

/** 标准行：时刻 + 级别徽章 + 正文 + 来源。两处弹窗的行形态一致，收在这里。 */
function DefaultLogRow({
  log,
  rowTestId,
}: {
  log: TaskLogEntry;
  rowTestId?: string;
}) {
  return (
    <div
      data-testid={rowTestId}
      data-level={log.level}
      className="border-border-subtle hover:bg-card flex items-start gap-2.5 border-b px-4 py-1 font-mono text-[13px] leading-snug"
    >
      <span className="text-ink-muted shrink-0">{fmtTime(log.t)}</span>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_STYLES[log.level]}`}
      >
        {levelLabel(log.level)}
      </span>
      <span className="text-ink-strong min-w-0 flex-1 break-words whitespace-pre-wrap">
        {log.msg}
      </span>
      {log.src && (
        <span className="text-ink-fainter hover:text-ink-faint max-w-[200px] shrink-0 truncate text-[11px]">
          {log.src}
        </span>
      )}
    </div>
  );
}

/** 无日志时的默认占位（消费方不传 `emptySlot` 时兜底，避免空列表静默）。 */
export function TaskLogEmptyHint({ message }: { message: string }) {
  return (
    <div className="text-ink-fainter flex h-full flex-col items-center justify-center gap-2 text-[13px]">
      <FileText size={32} strokeWidth={1.5} className="opacity-30" />
      {message}
    </div>
  );
}
