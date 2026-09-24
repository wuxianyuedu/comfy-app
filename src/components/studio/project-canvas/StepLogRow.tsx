"use client";

/**
 * StepLogRow —— 步骤日志弹窗里的一行日志。
 *
 * 抽成组件并被 `memo` 包住，是为了切断「面板重渲染 → 整屏行重建」这条链：弹窗最
 * 多同时挂 300 行（LOG_MODAL_MAX_ROWS），行若是写在面板里的内联 JSX，面板每重渲染
 * 一次就要重建约 1500 个 DOM 节点 —— 而面板重渲染的触发源有两个（画布每帧、
 * SSE 每来一条日志）。级别配色与时刻格式化只服务于行本身，一并收在这里。
 */

import { memo } from "react";
import { formatClock } from "~/lib/time-format";
import type { StepLogEntry } from "./stepLogCache";

type Level = StepLogEntry["level"];

/* 与应用日志 (LogPanel) 同款 level badge 配色，走语义 token（§4.11.1 / P71）：
 * error→destructive、warn→warning、success→success、progress→primary、
 * info→info。token 内部含深浅两态，不再写 dark:。 */
const LEVEL_STYLES: Record<Level, string> = {
  error: "border-destructive/20 bg-destructive/15 text-destructive",
  warn: "border-warning/20 bg-warning/15 text-warning-strong",
  success: "border-success/20 bg-success/15 text-success-strong",
  progress: "border-primary/20 bg-primary/15 text-primary-strong",
  info: "border-info/20 bg-info/15 text-info-strong",
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

/** 单条日志行。`memo` 生效的前提是 `log` 引用稳定 —— 追加日志时缓存做的是
 *  `[...prev.logs, entry]`，已有条目的引用不变，因此只有新行会真正渲染。 */
export const StepLogRow = memo(function StepLogRow({
  log,
}: {
  log: StepLogEntry;
}) {
  const isClient = log.client === true;
  return (
    <div
      data-testid="log-line"
      data-level={log.level}
      className="border-border-subtle hover:bg-subtle/60 flex items-start gap-2.5 border-b px-4 py-1 font-mono text-[13px] leading-snug"
    >
      <span className="text-ink-muted shrink-0">{fmtTime(log.t)}</span>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${LEVEL_STYLES[log.level]}`}
      >
        {levelLabel(log.level)}
      </span>
      <span
        className={`min-w-0 flex-1 break-words whitespace-pre-wrap ${
          isClient ? "text-ink-soft italic" : "text-ink-soft"
        }`}
      >
        {log.msg}
      </span>
      {log.src && (
        <span className="text-ink-fainter hover:text-ink-soft max-w-[200px] shrink-0 truncate text-[11px]">
          {log.src}
        </span>
      )}
    </div>
  );
});
