// ── 展示用时间格式化的唯一出口 ─────────────────────────────────────────────
// 按**形态**扫描撞出来的重复（ISSUE #672「谁在实现同一件事」）：
//   · 「刚刚 / N 分钟前 / N 小时前 / N 天前」——5 份实现，阈值与文案还各自漂移
//     （`history-utils` 封顶天数、`project-canvas` 30 天后转日期、
//     `workspace` / `WorksGallery` 每档都带「修改」后缀、`ProjectOutputs` 都没有）；
//   · `HH:mm:ss` 时刻——6 份实现（带毫秒的两处**逐字相同**、`workshop` 那几处
//     裸调 `toLocaleTimeString()` 连区域设置都没固定）。
//
// 收口方式与 §16.2.4.9 的滚动条同款：**只搬定义、不动取值** ——
// 每个函数保留调用处原有的档位与文案形态，差异用显式参数表达，不做「统一成
// 一种」。差异本身是业务选择（「刚刚修改」与「刚刚」在不同界面语义不同），
// 判据是**同一件事的定义只有一处**。
//
// 纯函数、与 React / Node 无关，因此是 `src/lib/` 的顶层单例
// （同 `format-bytes.ts` / `error-message.ts`，规范 12 §12.5.3）。

const MINUTE = 60_000;

/** 相对时间档位的调用处差异。 */
export interface RelativeTimeOptions {
  /** 超过该天数返回 `null`，由调用方退化成绝对日期（此前只有一处这么做）。 */
  maxDays?: number;
  /** 每档文案后缀，如 `"修改"`（`"3 分钟前"` → `"3 分钟前修改"`）。 */
  suffix?: string;
}

/**
 * ISO 时间串 / 毫秒数 → 「刚刚 / N 分钟前 / N 小时前 / N 天前」。
 *
 * 未来时间（时钟漂移、服务端时间超前）归到「刚刚」—— 不出现「-3 分钟前」。
 * 时间串无法解析时返回 `null`（调用方决定显示什么）。
 */
export function timeAgo(
  value: string | number,
  opts: RelativeTimeOptions = {},
): string | null {
  const ts = typeof value === "number" ? value : new Date(value).getTime();
  if (!Number.isFinite(ts)) return null;
  const suffix = opts.suffix ?? "";
  const min = Math.floor((Date.now() - ts) / MINUTE);
  if (min < 1) return `刚刚${suffix}`;
  if (min < 60) return `${min} 分钟前${suffix}`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前${suffix}`;
  const day = Math.floor(hour / 24);
  if (opts.maxDays !== undefined && day > opts.maxDays) return null;
  return `${day} 天前${suffix}`;
}

const CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

/**
 * 时刻 → `HH:mm:ss`（`millis` 时带 `.SSS`）。入参与 {@link timeAgo} 同口径：
 * 毫秒数或 ISO 串，调用处不必自己 `new Date(...)`。
 *
 * 固定 `zh-CN` + `hour12: false`：此前 `workshop` 那几处裸调
 * `toLocaleTimeString()`，输出随宿主区域设置变化（本机 12 小时制时会多出
 * AM/PM 把紧凑的日志行撑开）。
 *
 * 「跨天时补 `MM-DD ` 前缀」是**另一件事**，留在 `logs/log-format.ts` 的
 * `formatTime`（它带同天判定）。本函数只负责时刻本身。
 */
export function formatClock(
  value: string | number,
  opts: { millis?: boolean } = {},
): string {
  return new Date(value).toLocaleTimeString("zh-CN", {
    ...CLOCK_FORMAT,
    ...(opts.millis ? { fractionalSecondDigits: 3 } : {}),
  });
}
