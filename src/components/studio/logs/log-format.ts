/**
 * log-format — 日志行的时间与文本格式化（**唯一口径**）。这些函数必须只有一份：store 与视图各写一份时，
 * 「行首显示的时刻」与「复制出去的时刻」就成了两套实现，一处改了另一处不会跟着改，用户会看到「复制的时刻
 * 和面板上的对不上」。本模块只依赖结构类型（不 import `LogEntry`），因此 store 与视图都能安全引用、不引入循环。
 */

import { formatClock, formatShortDate } from "~/lib/time-format";

/** 两个时刻是否同一天（决定行首是否补月-日）。 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 行首时刻文本：`HH:mm:ss.mmm`；不是今天的行补 `MM-DD ` 前缀。`alwaysDate` 用于**离开面板上下文**的文本
 * （复制/导出）：贴进 issue 或发给人看时没有日期就说不清是哪天的事，所以导出文本一律带全日期。
 */
export function formatTime(ts: number, opts?: { alwaysDate?: boolean }): string {
  const time = formatClock(ts, { millis: true });
  if (opts?.alwaysDate === true || !isSameDay(new Date(ts), new Date())) {
    /* 短日期前缀（`MM-DD`）走 `~/lib/time-format` 的 `formatShortDate`。 */
    return `${formatShortDate(ts)} ${time}`;
  }
  return time;
}

/** 一条日志里与格式化相关的字段（结构化类型，避免依赖 store 的 `LogEntry`）。 */
export type FormattableLog = {
  level: string;
  /** 调用位置（`src/…:123` 或 `pkg → fn`）；无位置的行是 undefined。 */
  location?: string;
  message: string;
  /** 来源（`console` / `app-runtime` / …）；缺省则不写进文本。 */
  origin?: string;
  time: number;
};

/**
 * 单条日志 → 可复制的文本（行内复制按钮与导出共用）。**位置与来源要带上**（ISSUE #1703）：面板上有那一列，
 * 复制 / 导出却丢掉，用户拿日志报障时能定位问题的那一半信息在粘贴时没了。位置写在**正文之前**、同一行内：
 * 多行正文（堆栈、JSON）在前时位置会飘到几十行之后。追加字段用 ` · ` 分隔且只在有值时才出现，无值行与旧文本逐字相同。
 */
export function formatEntryForClipboard(entry: FormattableLog): string {
  const head = `${formatTime(entry.time, { alwaysDate: true })} [${entry.level.toUpperCase()}]`;
  const where = entry.location !== undefined && entry.location !== "" ? ` <${entry.location}>` : "";
  const from = entry.origin !== undefined && entry.origin !== "" ? ` · ${entry.origin}` : "";
  return `${head}${where} ${entry.message}${from}`;
}

/**
 * 多条日志 → 导出文本（一行一条，`\n` 连接）。
 *
 * 「复制当前筛选」与「下载/保存到本地」共用它；行内复制按钮直接用上面那条单行口径。
 */
export function formatForClipboard(entries: Array<FormattableLog>): string {
  return entries.map(formatEntryForClipboard).join("\n");
}
