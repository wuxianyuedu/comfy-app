/* ── 常驻服务 runtime 日志的「一次启动一份文件」（纯判据，不含 IO）──────────
 *
 * 四份 runtime 日志（`comfyui-runtime` / `drizzle-studio-runtime` /
 * `ollama-runtime` / `app-runtime`）过去都是**固定名、追加不轮转**：一个进程
 * 往同一个文件里追加，多次启动的行混在一条时间线上，只能靠 `▶` 横幅认边界，
 * 而横幅本身也要靠人去数。用户让它们改成「每个文件只存储单次运行的历史，单次
 * 里如果执行多次也存放多个文件」。
 *
 * ## 文件名形态
 *
 * `<source>-<YYYYMMDD>-<HHmmss>.log`，如
 * `comfyui-runtime-20261005-093612.log`。
 *
 *   - **日期 + 时分秒**：人翻目录时一眼看出先后；字典序 = 时间序，排序即
 *     时间线（与 `runs/` 的目录名同一条理由）。
 *   - **无冒号**：Windows 下 `:` 是非法文件名字符 —— 按时间戳原样写会让
 *     `log()` 在 Windows 上静默失败（用户只看到文件一直没出现）。这条与
 *     `runs/<日期>_<时分秒>-<runId>` 是同一条判据，不是惯例。
 *   - **同一秒内多次启动**（启动 → 秒退 → 再启动，实测完全可能）由
 *     {@link runtimeLogFileName} 的 `-2` / `-3` 后缀分叉，不覆盖前一份。
 *
 * ## 为什么「会话起点」从这一层开始算
 *
 * 命名定案之后，一个文件只属于**一个进程的一次启动**，于是「本次运行从哪一行
 * 开始」不再需要时间戳裁剪、也不需要横幅：它就是这个文件的第一行。四份日志
 * 的读侧因此统一退化成「读整个文件」—— `/api/logs/current` 不再下发
 * `sessionStart`，`dropStaleEntries` 那条时间线裁剪对本族消失。
 *
 * ## 分层（规范 18 §18.4）
 *
 * 纯函数：只拼名字、解析名字、判归属，不碰磁盘。读目录 / 列文件归
 * `runtime-log-pack.server.ts`。理由与 `log-path-tokens.ts` 同源 —— 判据要能
 * 脱离文件系统单测，而「哪一份属于哪次启动」只与名字有关。
 */

/** 四份 runtime 日志的来源键（= 接口上的 `source` 查询值）。 */
export type RuntimeLogSource =
  | "comfyui-runtime"
  | "drizzle-studio-runtime"
  | "ollama-runtime"
  | "app-runtime";

/** 来源键的全集（判据与门禁用它做穷举，不在别处再列一遍）。 */
export const RUNTIME_LOG_SOURCES: readonly RuntimeLogSource[] = [
  "comfyui-runtime",
  "drizzle-studio-runtime",
  "ollama-runtime",
  "app-runtime",
];

/** 一次启动的落盘时刻标识（`YYYYMMDD-HHmmss`，无冒号，可直接进文件名）。 */
function stamp(at: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`
  );
}

/** 名字里的时刻段（紧凑日期 + 时分秒）。 */
const STAMP_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/** 名字形态：`<来源>-<时刻>[-<第几次>].log`。 */
const FILE_RE =
  /^([a-z0-9-]+?)-(\d{4}\d{2}\d{2}-\d{2}\d{2}\d{2})(?:-(\d+))?\.log$/;

/**
 * 一次启动的文件名：`<source>-<YYYYMMDD-HHmmss>.log`。
 *
 * `ordinal` 给「同一秒内不止一次启动」分叉（`-2` / `-3`）；缺省一次落一个名字，
 * 占用由调用方（`runtime-log-pack.server.ts`）按目录里已有什么决定。
 */
export function runtimeLogFileName(
  source: RuntimeLogSource,
  at: Date,
  ordinal = 1,
): string {
  const suffix = ordinal > 1 ? `-${ordinal}` : "";
  return `${source}-${stamp(at)}${suffix}.log`;
}

/** 解析结果：这份文件属于哪个来源、哪一刻、以及同秒内的第几份。 */
export interface RuntimeLogFileName {
  /** 由名字反解出的来源（前缀匹配，不按表查——见 {@link parseRuntimeLogFileName}）。 */
  source: string;
  /** 名字里的时刻（毫秒）；形态不符时 null。 */
  startedAt: number | null;
  /** 同秒内第几份（1 = 第一份）。 */
  ordinal: number;
}

/**
 * 解析一份 runtime 日志的文件名；不是这个形态时返回 null。
 *
 * **来源按前缀反解，不拿 `RUNTIME_LOG_SOURCES` 去对**：来源键里带连字符
 * （`drizzle-studio-runtime`），而时刻段是定长的 —— 从右往左切才能既容纳新来源、
 * 又不把 `drizzle-studio-runtime-20261005-093612.log` 误判成别的来源。拿表去
 * 逐一 `startsWith` 也行，但那要求调用方先知道来源；而读目录时恰恰是**不知道**。
 */
export function parseRuntimeLogFileName(
  name: string,
): RuntimeLogFileName | null {
  const m = FILE_RE.exec(name);
  if (!m) return null;
  const [, source, stampText, ordinalText] = m;
  const sm = STAMP_RE.exec(stampText ?? "");
  if (!source || !sm) return null;
  const [, y, mo, d, h, mi, s] = sm;
  const startedAt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  const ordinal = ordinalText ? Number(ordinalText) : 1;
  return {
    source,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    ordinal: Number.isFinite(ordinal) && ordinal > 0 ? ordinal : 1,
  };
}

/**
 * 旧固定名（`<source>.log`）—— 迁移期要认，以免把用户盘上已有的历史当垃圾。
 *
 * 它为**读取**而存在：面板要能把迁移前留下的那一份也列出来（它只是没有时刻，
 * 排在最旧）。写入侧一律走 {@link runtimeLogFileName}，不会再产出它。
 */
export function legacyRuntimeLogFileName(source: RuntimeLogSource): string {
  return `${source}.log`;
}

/**
 * 文件名 → 面板下拉文案：`09-30 19:36:12`（缺时刻的旧固定名给「更早的日志」）。
 *
 * 与日志面板的时刻口径同源：日期与时刻都要 —— 只有
 * `HH:mm:ss` 时「昨天那次」与「今天那次」看起来一样。不再带「正常 / 异常退出」：
 * 这四份日志的**进程生命周期与应用的运行包不是一回事**（应用还开着、ComfyUI
 * 被重启了三次），把运行包的「退出形态」借过来会给出错误暗示。
 */
export function runtimeLogFileLabel(file: RuntimeLogFileName): string {
  if (file.startedAt === null) return "更早的日志";
  const d = new Date(file.startedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}
