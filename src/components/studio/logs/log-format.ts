/**
 * log-format — 日志行的时间与文本格式化（**唯一口径**）。
 *
 * 这些函数此前在 store 与视图里各有一份：`formatTime` / `isSameDay` 两边逐行
 * 重合（只差 `alwaysDate` 选项），`formatEntryForClipboard` 又只住在 store。
 * 于是「行首显示的时刻」与「复制出去的时刻」成了两套实现——一处改了另一处不会
 * 跟着改，用户就会遇到「复制的时刻和面板上的对不上」。
 *
 * 本模块只依赖结构类型（不 import `LogEntry`），因此 store 与视图都能安全引用，
 * 不引入循环。
 *
 * @module logs/log-format — 日志行的时间与文本格式化（**唯一口径**）
 */

/** 两个时刻是否同一天（决定行首是否补月-日）。 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 行首时刻文本：`HH:mm:ss.mmm`；不是今天的行补 `MM-DD ` 前缀。
 *
 * `alwaysDate` 用于**离开面板上下文**的文本（复制/导出）：贴进 issue 或发给人看时
 * 没有日期就说不清是哪天的事，所以导出文本一律带全日期。
 */
export function formatTime(
  ts: number,
  opts?: { alwaysDate?: boolean },
): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  if (opts?.alwaysDate || !isSameDay(d, new Date())) {
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${month}-${day} ${time}`;
  }
  return time;
}

/** 一条日志里与格式化相关的字段（结构化类型，避免依赖 store 的 `LogEntry`）。 */
export interface FormattableLog {
  time: number;
  level: string;
  message: string;
}

/** 单条日志 → 可复制的文本（行内复制按钮与导出共用这一条口径）。 */
export function formatEntryForClipboard(entry: FormattableLog): string {
  return `${formatTime(entry.time, { alwaysDate: true })} [${entry.level.toUpperCase()}] ${entry.message}`;
}

/**
 * 多条日志 → 导出文本（一行一条，`\n` 连接）。
 *
 * 「复制当前筛选」与「下载/保存到本地」共用它；行内复制按钮直接用上面那条单行口径。
 */
export function formatForClipboard(entries: FormattableLog[]): string {
  return entries.map(formatEntryForClipboard).join("\n");
}
