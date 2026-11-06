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
export const RUNTIME_LOG_SOURCES: ReadonlyArray<RuntimeLogSource> = [
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
const STAMP_RE =
  /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})-(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})$/;

/** 名字形态：`<来源>-<时刻>[-<第几次>].log`。 */
const FILE_RE =
  /^(?<source>[a-z0-9-]+?)-(?<stamp>\d{4}\d{2}\d{2}-\d{2}\d{2}\d{2})(?:-(?<seq>\d+))?\.log$/;

/**
 * 一次启动的文件名：`<source>-<YYYYMMDD-HHmmss>.log`。
 *
 * `ordinal` 给「同一秒内不止一次启动」分叉（`-2` / `-3`）；缺省一次落一个名字，
 * 占用由调用方（`runtime-log-pack.server.ts`）按目录里已有什么决定。
 */
export function runtimeLogFileName(source: RuntimeLogSource, at: Date, ordinal = 1): string {
  const suffix = ordinal > 1 ? `-${ordinal}` : "";
  return `${source}-${stamp(at)}${suffix}.log`;
}

/** 解析结果：这份文件属于哪个来源、哪一刻、以及同秒内的第几份。 */
export type RuntimeLogFileName = {
  /** 同秒内第几份（1 = 第一份）。 */
  ordinal: number;
  /** 由名字反解出的来源（前缀匹配，不按表查——见 {@link parseRuntimeLogFileName}）。 */
  source: string;
  /** 名字里的时刻（毫秒）；形态不符时 null。 */
  startedAt: number | null;
};

/**
 * 解析一份 runtime 日志的文件名；不是这个形态时返回 null。
 *
 * **来源按前缀反解，不拿 `RUNTIME_LOG_SOURCES` 去对**：来源键里带连字符
 * （`drizzle-studio-runtime`），而时刻段是定长的 —— 从右往左切才能既容纳新来源、
 * 又不把 `drizzle-studio-runtime-20261005-093612.log` 误判成别的来源。拿表去
 * 逐一 `startsWith` 也行，但那要求调用方先知道来源；而读目录时恰恰是**不知道**。
 */
export function parseRuntimeLogFileName(name: string): RuntimeLogFileName | null {
  const m = FILE_RE.exec(name);
  if (!m?.groups) {
    return null;
  }
  const { seq: ordinalText, source, stamp: stampText } = m.groups;
  const sm = STAMP_RE.exec(stampText ?? "");
  /* 捕获组要求至少一个字符，source 不会是空串 */
  if (source === undefined || !sm?.groups) {
    return null;
  }
  const { day, hour, minute, month, second, year } = sm.groups;
  const startedAt = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();
  /* 序号捕获组要么缺省要么非空数字串 */
  const ordinal = ordinalText === undefined ? 1 : Number(ordinalText);
  return {
    source,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    ordinal: Number.isFinite(ordinal) && ordinal > 0 ? ordinal : 1,
  };
}

/**
 * 环境变量名：**本次启动**的名字戳（`YYYYMMDD-HHmmss`），由 launcher 产出。
 *
 * 值的形态就是 {@link runtimeLogFileName} 里那一段 —— 两个进程要落在**同一份**
 * 文件上就必须用同一个戳，而这个戳只能由「先存在的那个进程」给出：launcher 先于
 * dev server 存在，它写下的预检提醒（壳过期 / pnpm 不匹配，见规范 07 §7.13）发生
 * 在 dev server 就绪之前，走不了 `POST /api/logs/app-runtime`。通道本身与
 * `COMFYAPP_RUN_ID` 同源（launcher 经 `process.env` 透传给被 spawn 的子进程）。
 */
export const LAUNCH_STAMP_ENV = "COMFYAPP_LAUNCH_STAMP";

/** 名字戳的形态判据（与 {@link runtimeLogFileName} 产出的那一段同形）。 */
const LAUNCH_STAMP_RE =
  /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})-(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})$/;

/**
 * 环境变量里的名字戳 → 可喂给 {@link runtimeLogFileName} 的 `Date`；读不出给 null。
 *
 * **读不出就退回 null、由调用方自己取当前时刻**，而不是硬拼一个名字：拼错的
 * 后果是写进一份「谁都认不出、也不在轮转清单里」的文件（本轮转逻辑不认它，
 * 于是它永远不被清理）—— 静默、且只在磁盘慢慢涨起来时才被发现。
 *
 * 判据刻意**不校验日历合法性**（`20261340-999999` 也能解出 Date）：这个值的
 * 唯一来源是本仓库自己的 launcher，而它由 `runtimeStamp()` 从真 `Date` 派生。
 * 多一道日历校验只会给「未来某天加了另一个写方」埋一个静默的降级分支。
 */
export function parseLaunchStamp(value: string | undefined): Date | null {
  /* 空串同样匹配不上时间戳正则，与 undefined 同归 null 出口 */
  const m = value === undefined ? null : LAUNCH_STAMP_RE.exec(value)?.groups;
  if (!m) {
    return null;
  }
  const { day, hour, minute, month, second, year } = m;
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  return Number.isFinite(at.getTime()) ? at : null;
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
 * 两份「一次启动一份文件」的先后（**旧→新**）。
 *
 * 三级判据，缺一个都会在真实盘上给出错序：
 *
 *   1. **旧固定名（`startedAt === null`）永远排最前** —— 「更早」是对它的定义
 *      （它是迁移前的全部历史，没有时刻）；
 *   2. **时刻升序** —— 正常的先后；
 *   3. **同一秒内按序号升序** —— 这一步是必需的而不是美化：同一秒里的第二份
 *      名字是 `…-093612-2.log`，而 `.` 的码位（46）比 `-`（45）大一位，所以
 *      **按名字比会把它排到 `…-093612.log` 前面** ——「启动 → 秒退 → 再启动」
 *      在这个仓库里很常见，那两份的顺序正好被读反（用户看到的「第一次的失败
 *      现场」实际是第二次的）。
 *
 * 收在这里一处而不是各调用点自己写 `sort`：`current/` 下的份与运行包里的份
 * **必须**同序，两边各写一遍必然漂，而漂开的表现只是「某些项顺序不对」——
 * 不容易被注意到。
 */
export function compareRuntimeLogFiles(
  a: { name: string; startedAt: number | null },
  b: { name: string; startedAt: number | null },
): number {
  if (a.startedAt === null || b.startedAt === null) {
    if (a.startedAt === null && b.startedAt === null) {
      return a.name.localeCompare(b.name);
    }
    return a.startedAt === null ? -1 : 1;
  }
  return (
    a.startedAt - b.startedAt ||
    ordinalOf(a.name) - ordinalOf(b.name) ||
    a.name.localeCompare(b.name)
  );
}

/** 名字里的「同秒第几份」（无后缀 = 1；非本形态回 1）。 */
function ordinalOf(name: string): number {
  return parseRuntimeLogFileName(name)?.ordinal ?? 1;
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
  if (file.startedAt === null) {
    return "更早的日志";
  }
  const d = new Date(file.startedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}
