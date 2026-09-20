// ── 展示用时间格式化的唯一出口 ─────────────────────────────────────────────
// 按**形态**扫描撞出来的重复（ISSUE #672「谁在实现同一件事」）：
//   · 「刚刚 / N 分钟前 / N 小时前 / N 天前」——5 份实现，阈值与文案还各自漂移
//     （`history-utils` 封顶天数、`project-canvas` 30 天后转日期、
//     `workspace` / `WorksGallery` 每档都带「修改」后缀、`ProjectOutputs` 都没有）；
//   · `HH:mm:ss` 时刻——6 份实现（带毫秒的两处**逐字相同**、`workshop` 那几处
//     裸调 `toLocaleTimeString()` 连区域设置都没固定）；
//   · **「只写日期」那一档**（ISSUE #672 本轮补）——`YYYY-MM-DD` 在
//     `history-utils`（日期桶）/ `MessageCenterPanel`（消息时刻）/ `generation-log`
//     （按天文件名）三处各拼一遍；`MM-DD` 行首前缀在 `logs/log-format` 又一份；
//     **本地时间戳**（`YYYY-MM-DD HH:mm:ss`）在 6 处 runtime/日志模块**逐字相同**
//     （`app-runtime-log` / `trace` 各多一个 `.mmm`，`export` 那份是紧凑 `YYYYMMDD`）。
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
  value: TimeInput,
  opts: { millis?: boolean } = {},
): string {
  return toDate(value).toLocaleTimeString("zh-CN", {
    ...CLOCK_FORMAT,
    ...(opts.millis ? { fractionalSecondDigits: 3 } : {}),
  });
}

/* ── 「只写日期」那一档 ────────────────────────────────────────────────────
 *
 * 上面收的是「相对时间」与「时刻」；本轮补上**只写日期**与**本地时间戳**。
 * 与时刻那半同款：格式化口径只有一处，差异用显式选项表达。
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 入参：毫秒数 / ISO 串 / `Date`（比 {@link timeAgo} 宽一档，`Date` 直接用）。 */
type TimeInput = string | number | Date;

/** 统一的入参归一 —— 调用处不必自己 `new Date(...)`。 */
const toDate = (value: TimeInput): Date =>
  value instanceof Date ? value : new Date(value);

/**
 * 日期 → `YYYY-MM-DD`（**只写日期**那一档）。
 *
 * 三处同形（`history-utils` 的日期桶 / `MessageCenterPanel` 的消息时刻 /
 * `generation-log` 的按天文件名）此前各拼一遍 —— 而它们的分隔符**恰好都是
 * 半角连字符**，说明这三个落点本来就该是同一件事（不是「碰巧一样」）。
 *
 * 用**本地时间**：这些落点全是给本机用户看的（日期桶要与用户所在时区的
 * 「今天」对齐、按天文件名要与用户当天看到的一致）。`toISOString()` 是 UTC，
 * 在 +8 时区会把凌晨归到前一天。
 */
export function formatDate(value: TimeInput): string {
  const d = toDate(value);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 日期 → `MM-DD`（日志行首的短日期前缀）。
 *
 * 与 {@link formatDate} 是**两档**：日志行首只补月-日（年份在同一份日志里
 * 从来不重要，写全会把紧凑的行首撑开），而日期桶要写全。
 */
export function formatShortDate(value: TimeInput): string {
  const d = toDate(value);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 本地时间戳 → `YYYY-MM-DD HH:mm:ss`（`millis` 时带 `.mmm`）。
 *
 * runtime / 诊断日志的行首格式。此前 **6 处逐字相同**（`comfyui/lifecycle`、
 * `drizzle-studio/lifecycle`、`ollama-start`、`ollama-stop`、`log/app-runtime-log`、
 * `comfyui/trace`），每处的 `const p = (n) => String(n).padStart(2, "0")` 也
 * 各写一遍。用**本地时间**而非 UTC：日志是给本机用户对照时钟看的，
 * `toISOString()` 在 +8 时区会凭空差出 8 小时（这正是这些模块当年各自写
 * 一份 `localTimestamp` 的由来）。
 */
export function formatLocalStamp(
  value: TimeInput,
  opts: { millis?: boolean } = {},
): string {
  const d = toDate(value);
  const base = `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return opts.millis
    ? `${base}.${String(d.getMilliseconds()).padStart(3, "0")}`
    : base;
}

/**
 * 日期 → `YYYYMMDD-HHmmss`（**文件名**那一档：无分隔符，可直接进文件名）。
 *
 * 与 {@link formatLocalStamp} 的差别是「能不能进文件名」—— 冒号在 Windows
 * 路径里非法，因此导出文件名那一处有自己的形态。收在这里是为了让「导出
 * 文件名长什么样」也只有一处可查。
 */
export function formatCompactStamp(value: TimeInput): string {
  const d = toDate(value);
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}
