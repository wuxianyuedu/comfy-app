"use client";

/**
 * log-store — 日志面板全局状态单例（Zustand）。
 *
 * 规范 07 §7.4：日志状态用 Zustand 管理，不使用 React Context。
 * 多个面板（BrowserStatusBar / LogPanel）直接读取同一 store。
 *
 * ── 时间线契约（面板「按时间顺序 + 有信息量」的地基）──────────────────
 * 时间线是**合并后的单一顺序**，不是「按到达顺序堆叠」：
 *   1. 排序键是 `(time, seq)`——`time` 是每行自带的写入时刻（毫秒），
 *      `seq` 只是同一毫秒内的稳定次键（跨来源去重后按它保持确定性顺序）。
 *      此前按到达顺序堆叠，三路轮询（launcher / dev / app-runtime）并发回来时
 *      旧时刻的行会落在新时刻的行之后，面板看着像「停在原地」（ISSUE #346）。
 *   2. 同一行被多路读到（launcher 转写含 dev 输出、文件被整段重读）时按
 *      `time + level + message` 去重，不重复计入。没有这条，面板的条数与
 *      真实事件数对不上，翻页也会翻出重复内容。
 *   3. 读不到时刻的裸文本行由解析层钳到当时本地时刻，因此**不会**落到历史行
 *      之前（旧的「按解析时刻 + 只追加」写法会把它们排到末尾，破坏时间序）。
 */

import { create } from "zustand";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 面板只渲染最近这么多条日志（规范 07 §7.5 的环形缓冲上限）。 */
export const MAX_LOG_ENTRIES = 2000;

/**
 * 面板每页条数（规范 07 §7.13 的分页契约）：
 * 「显示」页与内存上限各管一段，两者不再耦合。
 */
export const LOG_PAGE_SIZE = 200;

/** 每一页（面板显示窗口）里最多保留的连续重复行数（见 dedupeRepeats）。 */
const REPEAT_FOLD_LIMIT = 5;

export interface LogEntry {
  /** nanoid-style short id */
  id: string;
  /** 日志写入时刻（毫秒）。排序、展示、会话边界判定都用它。 */
  time: number;
  level: LogLevel;
  /** Serialized message */
  message: string;
  /** Where the log came from（console / tauri / system）。 */
  source: "console" | "tauri" | "system";
  /** 文件来源：dev-launcher / launcher / 应用服务输出 / app-runtime 的文件行带此标记。 */
  origin?: "dev" | "launcher" | "app" | "app-runtime";
  /** Caller location (file:line) for console logs */
  location?: string;
  /**
   * 入库顺序：只在同一毫秒内作为稳定排序次键（时间戳相同时保持确定的先后），
   * 以及「去重后是否为新内容」的判据。
   *
   * 它**不参与**跨毫秒排序——时间线按 `time` 升序，这是面板「按时间显示」
   * 的定义本身（ISSUE #262）。
   */
  seq: number;
}

export type LogFilter = LogLevel | "all";

/** 面板可筛选的来源（`all` = 全部）。 */
export type LogOriginFilter = LogEntry["origin"] | "all";

let entryId = 0;
function nextId() {
  entryId = (entryId + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${entryId.toString(36)}`;
}

/**
 * 入库序计数器（进程内单调递增，不随清空 / 过滤重置）。
 * 只作同一毫秒内的排序次键与去重判据；模块级而非 store state，保证
 * `clear()` / 页面重载后仍单调，否则新日志会被当成旧日志排到前面。
 */
let entrySeq = 0;
function nextSeq(): number {
  entrySeq += 1;
  return entrySeq;
}

function serializeOne(a: unknown): string {
  if (typeof a === "string") return a;
  if (typeof a === "number" || typeof a === "boolean") return String(a);
  if (a === undefined) return "undefined";
  if (a === null) return "null";
  if (a instanceof Error) {
    return a.stack
      ? `${a.name}: ${a.message}\n${a.stack}`
      : `${a.name}: ${a.message}`;
  }
  // Preserve stack-like strings that may come from serialized error objects.
  if (
    typeof a === "object" &&
    a !== null &&
    "stack" in a &&
    typeof (a as { stack?: unknown }).stack === "string"
  ) {
    const e = a as { name?: unknown; message?: unknown; stack: string };
    const head = typeof e.message === "string" ? e.message : JSON.stringify(a);
    return `${head}\n${e.stack}`;
  }
  try {
    return JSON.stringify(a, null, 2);
  } catch {
    if (
      typeof a === "string" ||
      typeof a === "number" ||
      typeof a === "boolean" ||
      typeof a === "bigint"
    ) {
      return String(a);
    }
    return "";
  }
}

export function serialize(args: unknown[]): string {
  return args.map(serializeOne).join(" ");
}

/**
 * 从调用栈中定位真正的业务调用方。
 * 拦截 console.* 时，栈顶是 log-store 自己的包装函数，需要跳过；
 * 再跳过 React / Next.js / Tauri 等框架/编译产物帧，返回第一个**能映射回项目源码**
 * 的业务位置（即以 .ts/.tsx 结尾的 source-map 帧）。
 *
 * 只认 source-map 帧的原因：Next/webpack/Turbopack 在 dev 期把用户代码 source-map 到
 * `.tsx/.ts`；而框架自身的 console 输出来自被压缩/哈希的编译 chunk（形如
 * `src/00vplg9./.js:1879`）。这类位置对用户没有可读含义——它们并非业务代码打印的。
 * 与其展示一串看不出由来的哈希 chunk 路径，不如不展示（返回 undefined，行上不出现位置列）。
 */
export function captureLocation(): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;

    const loggerSelfRe = /log-(?:store|provider)\.(tsx|ts|jsx|js)/;
    const frameworkRe =
      /node_modules|react-dom|react\.production|react\.development|next\/(?:dist|server|client)|@tauri-apps|scheduler|webpack[\/](?:runtime|bootstrap)|\[native code\]/i;
    // 项目源码以 TS 编写；dev 期只有映射回 .ts/.tsx 的帧才算"可读业务位置"。
    const sourceRe = /\.(?:tsx?|mts|cts)$/i;

    const lines = stack.split("\n");
    for (let pass = 0; pass < 2; pass++) {
      for (const raw of lines) {
        const line = raw.trim();
        if (!line?.startsWith("at ")) continue;
        if (loggerSelfRe.test(line)) continue;
        if (pass === 0 && frameworkRe.test(line)) continue;

        // 取 frame 中的位置部分：优先用最后一个 (...) 里的内容，否则取整行
        const parenMatch = /\(([^)]+)\)\s*$/.exec(line);
        const loc = parenMatch ? parenMatch[1] : line.replace(/^at\s+/, "");
        if (!loc) continue;

        // 位置段末尾一定是 :line:col，取最后两个冒号分割
        const lastColon = loc.lastIndexOf(":");
        if (lastColon <= 0) continue;
        const secondLastColon = loc.lastIndexOf(":", lastColon - 1);
        const lineNo =
          secondLastColon >= 0
            ? loc.slice(secondLastColon + 1, lastColon)
            : loc.slice(lastColon + 1);
        let path =
          secondLastColon >= 0
            ? loc.slice(0, secondLastColon)
            : loc.slice(0, lastColon);

        // 清理常见前缀 / 协议
        path = path.replace(/^webpack-internal:\/\/\/\.\//, "");
        path = path.replace(/^webpack-internal:\/+/i, "");
        path = path.replace(/^file:\/\/\//, "");
        path = path.replace(/^https?:\/\/[^/]+\/_next\/static\/chunks\//, "");
        path = path.replace(/^https?:\/\/[^/]+\//, "");

        // Turbopack / 某些 webpack source-map 配置会把模块路径里的 "/" 编码为 "_"，
        // 形成 "src_components_studio_15hhqk_logs_log-store.ts" 这种标识符。
        // 在肉眼可读性层面把它还原（heuristic：以 src_ 开头且没有 "/"）。
        if (!path.includes("/") && path.startsWith("src_")) {
          path = path.replace(/_/g, "/");
        }

        // 取 /src/ 之后的路径作为最简可读形式
        const srcIdx = path.indexOf("/src/");
        if (srcIdx !== -1) path = path.slice(srcIdx + 1);

        // 只展示能映射回项目源码（.ts/.tsx 系）的位置；编译 chunk（.js/.mjs）或
        // 框架内部帧看不懂也无需展示——继续向下找真正的业务帧，找不到就返回 undefined。
        if (
          path &&
          sourceRe.test(path) &&
          /^\d+$/.test(lineNo) &&
          !/^\d+$/.test(path)
        ) {
          return `${path}:${lineNo}`;
        }
      }
    }
  } catch {
    // 解析失败不应影响日志记录
  }
  return undefined;
}

/**
 * 过滤 tRPC loggerLink / React Query 内部追踪日志。
 *
 * tRPC 客户端在 dev 模式通过 loggerLink 把每次调用打成 console 日志，形如
 * `%c<< mutation #43 %cworkflow.update` 或 `%c>> query #1 ...`。这些日志随
 * 组件重渲染与保存操作大量产生，会淹没真正的业务日志；但 LoggerLink 对网络排错
 * 本身有价值（保留在 console），只是不写进日志面板。因此这里仅做面板侧丢弃。
 *
 * 同时兜底 tRPC 在 mutation 落库/重排后重新包装的塌缩形态（形如
 * `[[ << mutation #43 ]workflow.update {}`），它会被 React devtools 以
 * "Console Error" 形式从 LogProvider 转发帧抛到面板，同样属于无害框架噪音。
 */
export function isReactQueryLog(args: unknown[]): boolean {
  if (args.length === 0) return false;
  // 标准形态：tRPC loggerLink 的格式串 + 逐帧样式参数，args[0] 即为追踪签名。
  // 真实追踪至少两个参数（格式串 + 样式），单参数的不是追踪，避免误吞业务文案。
  if (args.length >= 2) {
    const first = args[0];
    if (typeof first === "string" && /^\s*%c\s*(?:<<|>>)\s*(?:query|mutation)\s*#\d+/i.test(first)) return true;
  }
  // 塌缩/重包装形态：loggerLink 的 %c 样式与逐帧参数被 React devtools 吞并，
  // 合并成带 "[[" 前缀的单串（形如 `[[ << mutation #43 ]workflow.update {}`），
  // 并经由 LogProvider 转发帧以 "Console Error" 冒到面板。同属无害框架噪音。
  const text = serialize(args);
  return /^[\s\[]*(?:<<|>>)\s*(?:query|mutation)\s*#\d+/i.test(text);
}

/**
 * 过滤已知的、无害的框架/运行时噪音，避免它们淹没业务日志。
 * 典型例子：Tauri v2 在 Windows WebView2 上 IPC custom protocol fetch 失败时
 * 会自动降级到 postMessage，并打印一条 warn。这是正常行为，不影响功能。
 */
export function isNoisyFrameworkLog(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const text = serialize(args);
  return /IPC custom protocol failed|Tauri will now use the postMessage interface/i.test(
    text,
  );
}

/**
 * 过滤 Next.js dev 自身的开发提示，避免它们以"业务 info 日志"身份进面板。
 * 典型例子：热更新完成时 Next dev 在浏览器 console 打印 `[Fast Refresh] done in
 * XXXXms`，它来自框架的 dev chunk（source-map 只到压缩后的哈希模块，形如
 * `src/00vplg9./.js`），并非任何业务代码打印，也没有可读的调用位置。
 * 与其它框架噪音一致：保留在浏览器 console（降为 debug），只不入面板。
 */
export function isNextDevNoise(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const text = serialize(args);
  return /\[Fast\s*Refresh\]\s*(?:done|finished)?.*\d+\s*ms/i.test(text);
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(ts: number, opts?: { alwaysDate?: boolean }): string {
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

const LOG_LINE_RE =
  /^\[(\d{2}):(\d{2}):(\d{2})\]\s*\[(STEP|OK|INFO|WARN|ERROR|DEBUG)\]\s*(.*)$/;
const LAUNCHER_LOG_RE =
  /^\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*(.*)$/;
const APP_RUNTIME_LOG_RE =
  /^\[(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\]\s*\[(INFO|WARN|ERROR|DEBUG)\]\s*(?:\[([^\]]+)\]\s*)?(.*)$/;

/**
 * 过滤常规 tRPC/RPC 调用计时日志（#294）。
 *
 * 形如 `[rpc] setting.dbStudioStatus 155ms {"type":"query"}` / `[trpc] generate.generate
 * 25ms {"type":"query"}` 的行来自 tRPC 中间件的调用计时（历史上每次 query/mutation
 * 都写一条），正常调用每几秒就刷一整屏，把真正的业务/警告日志冲走。
 * 「有问题的调用」（失败 error、超过慢查询阈值的 warn）必须保留——它们的消息
 * 带「失败」字样或级别本身是 warn/error，不会命中这里的"常规 info 计时"判定。
 */
export function isRoutineRpcTimingLog(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const text = serialize(args);
  const body = text
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^(?:[a-z]+\]?|\])\s*/i, "");
  return /^\S+\s+\d+ms(\s*\{.*\})?$/i.test(body);
}

/** 文件转录行（app-runtime / launcher）侧的同规则过滤：返回 true 表示不进面板。 */
export function isRoutineRpcTimingLine(line: string): boolean {
  const m = APP_RUNTIME_LOG_RE.exec(line);
  const text = m ? (m[10] ?? "") : line;
  const level = m ? (m[8] ?? "").toUpperCase() : "";
  // 失败 / 慢查询（error/warn 级别）永远保留
  if (level === "WARN" || level === "ERROR") return false;
  // 行格式两种来源：app-runtime 行的 text 已被 APP_RUNTIME_LOG_RE 拆掉 [ns]
  // 前缀；launcher 转录整行原文可能带 [rpc] / rpc] 前缀。先剥前缀再测正文。
  const body = text
    .trim()
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/^(?:[a-z]+\]?|\])\s*/i, "");
  return /^\S+\s+\d+ms(\s*\{.*\})?$/i.test(body);
}


function parseLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case "error":
      return "error";
    case "warn":
    case "warning":
      return "warn";
    case "debug":
      return "debug";
    default:
      return "info";
  }
}

/**
 * 匹配 Next.js dev 的 `[Fast Refresh] rebuilding` 转录行。
 * 它由框架打进 launcher/dev 转录（无业务含义），但行内常携带上一条编译
 * 错误的级别标记（形如 `[INFO] [Fast Refresh] rebuilding [ERROR] ...`），
 * 按级别正则会整行落成 error——看起来像应用出错，实际只是热更新进行中。
 * 与 isNextDevNoise（浏览器 console 侧过滤）互补：这条处理文件转录侧。
 */
const FAST_REFRESH_REBUILD_RE =
  /\[Fast\s*Refresh\]\s*rebuilding(?:\s*\[(?:ERROR|WARN|DEBUG)\])?/i;

export function parseFileLogs(
  text: string,
  baseDate?: Date,
  origin?: LogEntry["origin"],
): LogEntry[] {
  /*
   * 读不到时刻时的兜底：baseDate 是**这批内容所属的日期**（默认今天），时刻取
   * 解析当时的本地时间。这样裸文本行落在「现在」，不会因为时间戳缺失被排到
   * 时间线开头（用 00:00:00 会），与「时间线按 time 升序」的契约相容。
   */
  const now = Date.now();
  const today = baseDate ?? new Date();
  const entries: LogEntry[] = [];
  let seq = nextSeq();
  const push = (entry: Omit<LogEntry, "seq">) => {
    entries.push({ ...entry, seq: seq++ });
  };
  for (const rawLine of text.split("\n")) {
    // Strip ANSI SGR (e.g. \x1b[36m) that the launcher now writes into the
    // transcript, so the [HH:mm:ss] [LEVEL] regex still matches cleanly.
    const line = rawLine.replace(/\r$/, "").replace(/\x1b\[[0-9;:]*m/g, "");
    if (!line.trim()) continue;
    // 常规 tRPC/RPC 调用计时行（如 `[rpc] xxx 155ms {"type":"query"}`）不进面板：
    // 正常调用高频产生会刷屏（#294）；失败/慢查询（error/warn 级别）仍保留。
    if (isRoutineRpcTimingLine(line)) continue;
    const m = LOG_LINE_RE.exec(line);
    if (m) {
      const [, hh, mm, ss, lv, msg] = m;
      const d = new Date(today);
      d.setHours(Number(hh ?? "0"), Number(mm ?? "0"), Number(ss ?? "0"), 0);
      push({
        id: nextId(),
        time: d.getTime(),
        level: parseLogLevel(lv ?? "INFO"),
        message: msg ?? "",
        source: "system",
        ...(origin ? { origin } : {}),
      });
      continue;
    }
    const am = APP_RUNTIME_LOG_RE.exec(line);
    if (am) {
      const [, year, month, day, hh, mm, ss, ms, lv, ns, msg] = am;
      const d = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hh),
        Number(mm),
        Number(ss),
        Number(ms),
      );
      const nsTag = ns ? `[${ns}] ` : "";
      const msgText = nsTag + (msg ?? "");
      push({
        id: nextId(),
        time: d.getTime(),
        // Fast Refresh 进行中若沾染上一条错误的级别标记，按 info 落板
        level: FAST_REFRESH_REBUILD_RE.test(msgText)
          ? "info"
          : parseLogLevel(lv ?? "INFO"),
        message: msgText,
        source: "system",
        ...(origin ? { origin } : {}),
      });
      continue;
    }
    const lm = LAUNCHER_LOG_RE.exec(line);
    if (lm) {
      const [, year, month, day, hh, mm, ss, ms, msg] = lm;
      const d = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hh),
        Number(mm),
        Number(ss),
        Number(ms),
      );
      push({
        id: nextId(),
        time: d.getTime(),
        level: "info",
        message: msg ?? "",
        source: "system",
        ...(origin ? { origin } : {}),
      });
      continue;
    }
    push({
      id: nextId(),
      time: now,
      level: "info",
      message: line,
      source: "system",
      ...(origin ? { origin } : {}),
    });
  }
  return entries;
}

/** 行身份：同一行被多路读到（launcher 转写含 dev 输出）时据此去重。 */
function entryKey(entry: Pick<LogEntry, "time" | "level" | "message">): string {
  return `${entry.time}\u0000${entry.level}\u0000${entry.message}`;
}

/**
 * 把新条目并进时间线：**按时刻排序 + 跨来源去重**，然后只保留最近 MAX_LOG_ENTRIES 条。
 *
 * - 排序键 `(time, seq)`：`time` 来自行内的写入时刻；`seq` 只在同一毫秒内决定
 *   先后（三路轮询并发到达，同毫秒内按到达顺序保持稳定即可）。
 * - 去重：与已有条目 key 相同的新条目直接丢弃。dev-launcher 转写会包含 dev
 *   输出、文件被整段重读也会重复送来同一批行，没有这一步面板条数与真实事件数
 *   就对不上（翻页还会翻出重复内容）。
 * - 上限只裁**最旧**的条目：内存占用有界，且「显示多少条」由分页决定，
 *   不再等于内存上限（ISSUE #262：面板本该能翻页看更多，却卡在 2000 条）。
 */
export function mergeTimeline(
  current: LogEntry[],
  fresh: LogEntry[],
  max = MAX_LOG_ENTRIES,
): LogEntry[] {
  if (fresh.length === 0) return current;
  const seen = new Set(current.map(entryKey));
  const added: LogEntry[] = [];
  for (const entry of fresh) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(entry);
  }
  if (added.length === 0) return current;
  const merged = current.length === 0 ? added.slice() : [...current, ...added];
  merged.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.seq - b.seq));
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/** 时间线的**真实**末条（最新一条）——「已读水位」「有无新内容」「跳最新」都用它。 */
export function lastSeqOf(logs: LogEntry[]): number {
  return logs[logs.length - 1]?.seq ?? 0;
}

/**
 * 会话起点过滤：丢掉「上一次运行」残留的行。
 *
 * 追加写日志（如 app-runtime）里混着历史运行的内容，行格式只记时刻、不记
 * 是哪一次运行写的；行时刻早于会话起点即判为历史。
 * 读不出时刻的裸文本行（`time` 取解析当时的时刻）天然不会早于起点，保留。
 *
 * @param cutoffMs 会话起点（毫秒）；null/undefined = 不启用该过滤
 */
export function dropStaleEntries(
  entries: LogEntry[],
  cutoffMs: number | null | undefined,
): LogEntry[] {
  if (cutoffMs === null || cutoffMs === undefined) return entries;
  return entries.filter((entry) => entry.time >= cutoffMs);
}

/**
 * 渲染前折叠连续重复行：同一页里连续 N 条内容完全相同的行压缩成一条
 * `…（重复 N 次）`，只保留前 REPEAT_FOLD_LIMIT 条。
 *
 * 为什么必须有这一步：面板里最常见的「没信息量」形态不是长度，而是**重复**——
 * 同一路轮询每轮写一条同样的慢查询 / 重连提示，一屏就被刷满，用户看不到别的
 * （ISSUE #262）。写入侧已经按时间桶聚合了一次（§7.14.1），这里是视图侧的最后
 * 一道保险：只影响显示，不改动时间线本身。
 *
 * 只折叠**连续**重复（按相邻位置），不按键全局分组——跨距离的相同行之间隔着
 * 别的事件，合并它们会把时间线读成「同一个事件发生了 N 次」，那是错的。
 */
export function dedupeRepeats(
  entries: LogEntry[],
  limit = REPEAT_FOLD_LIMIT,
): LogEntry[] {
  /* 折叠键只看「级别 + 内容」，不看时刻：每轮轮询写出来的重复行时刻必然不同，
   * 带上时刻就一条也折叠不了。跨来源去重看时刻（entryKey），这里看语义。 */
  const foldKey = (entry: LogEntry) => `${entry.level}\u0000${entry.message}`;
  const out: LogEntry[] = [];
  let i = 0;
  while (i < entries.length) {
    const first = entries[i]!;
    let run = 1;
    while (i + run < entries.length && foldKey(entries[i + run]!) === foldKey(first)) {
      run += 1;
    }
    if (run <= limit) {
      out.push(first);
      i += 1;
      continue;
    }
    for (let k = 0; k < limit; k += 1) out.push(entries[i + k]!);
    out.push({
      ...first,
      id: `${first.id}-repeat`,
      message: `…（以上内容连续重复 ${run - limit} 次）`,
    });
    i += run;
  }
  return out;
}

function formatForClipboard(entries: LogEntry[]): string {
  return entries
    .map((e) => `${formatTime(e.time, { alwaysDate: true })} [${e.level.toUpperCase()}] ${e.message}`)
    .join("\n");
}

function computeCounts(logs: LogEntry[]): Record<LogLevel | "all", number> {
  const base: Record<LogLevel | "all", number> = {
    all: logs.length,
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  for (const entry of logs) {
    base[entry.level]++;
  }
  return base;
}

function computeFiltered(
  logs: LogEntry[],
  filter: LogFilter,
  search: string,
  origin: LogOriginFilter,
): LogEntry[] {
  const needle = search.trim().toLowerCase();
  return logs.filter((entry) => {
    const levelOk = filter === "all" || entry.level === filter;
    const originOk = origin === "all" || entry.origin === origin;
    const searchOk =
      !needle ||
      entry.message.toLowerCase().includes(needle) ||
      entry.location?.toLowerCase().includes(needle);
    return levelOk && originOk && searchOk;
  });
}

function welcomeEntry(): LogEntry {
  return {
    id: nextId(),
    seq: nextSeq(),
    time: Date.now(),
    level: "info",
    message:
      "日志面板已启用。按 Ctrl+Shift+L 或点击状态栏日志按钮打开/关闭。",
    source: "system",
  };
}

export interface LogStoreState {
  logs: LogEntry[];
  filteredLogs: LogEntry[];
  filter: LogFilter;
  /** 来源筛选（#262：启动日志与应用运行日志混在一屏，需要能分开看）。 */
  origin: LogOriginFilter;
  search: string;
  isOpen: boolean;
  counts: Record<LogLevel | "all", number>;
  /** 翻页：当前页（1 起，倒序查看，1 = 最新一页）与每页条数。 */
  page: number;
  pageSize: number;
  /**
   * 本次运行的开始时间（毫秒）；null = 未知（非 launcher 启动）。
   * 面板只显示本次运行：行时刻早于它即上一次运行的残留（见 dropStaleEntries）。
   */
  sessionStart: number | null;
  /**
   * 当前提供日志的服务端进程标识（bootId）。
   *
   * 它回答的是「这条日志是哪个应用服务进程写的」：进程重启（或另一实例接管
   * 端口）后 bootId 变化，面板据此**清空时间线并重读**，而不是把两个进程的
   * 输出混成一条线。面板页脚展示它，用户报障时能说清自己连的是哪个进程
   * （ISSUE #360：「应用服务为什么没启动」现场没有任何可引用的标识）。
   */
  bootId: string | null;
  /**
   * 生成 `logs` 切片的生成号（每次时间线变化 +1）。
   *
   * 它是「store 有没有新日志」的判据，而不是时间线末条 seq：时间线按时刻排序，
   * 一条**迟到但时刻更早**的行会插进中间、末条不变——只看末条会漏掉这种新增。
   */
  revision: number;
  /**
   * 「已读水位」的长度口径：翻到历史位置那一刻**过滤后**的条数。
   * 页脚「有 N 条新的日志」= 当前 filteredLogs.length − 它（见 selectNewLogCount）。
   */
  viewLength: number;
  /**
   * 「已读水位」：翻到历史页那一刻的 `revision`。
   *
   * 面板据此算出「停在历史页期间又新来了多少条日志」并在页脚提示——历史页的
   * 内容不会因为新日志而改变，没有这条提示，用户看到的就是「计数在涨、面板不
   * 动」（ISSUE #346）。回到第 1 页即视为已读，水位推到当前 revision。
   */
  viewRevision: number;
  addEntry: (entry: Omit<LogEntry, "id" | "time" | "seq">) => void;
  appendFileLogs: (entries: LogEntry[]) => void;
  setSessionStart: (sessionStart: number | null) => void;
  /** 记录当前服务端进程标识；变化时清掉时间线（跨进程的行不可比）。 */
  setBootId: (bootId: string | null) => void;
  setFilter: (f: LogFilter) => void;
  setOrigin: (o: LogOriginFilter) => void;
  setSearch: (s: string) => void;
  setPage: (page: number) => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  clear: () => void;
  copyAll: () => Promise<void>;
  download: () => void;
}

/** 从状态推导派生字段（计数 / 过滤结果），所有写入路径共用。 */
function derive(
  logs: LogEntry[],
  filter: LogFilter,
  search: string,
  origin: LogOriginFilter,
  revision: number,
) {
  return {
    logs,
    counts: computeCounts(logs),
    filteredLogs: computeFiltered(logs, filter, search, origin),
    revision,
  };
}

export const useLogStore = create<LogStoreState>((set, get) => ({
  logs: typeof window === "undefined" ? [] : [welcomeEntry()],
  filteredLogs: [],
  filter: "all",
  origin: "all",
  search: "",
  isOpen: false,
  counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
  page: 1,
  pageSize: LOG_PAGE_SIZE,
  sessionStart: null,
  bootId: null,
  revision: 0,
  viewRevision: 0,
  viewLength: 0,

  addEntry: (entry) =>
    set((state) => {
      const full: LogEntry = {
        ...entry,
        id: nextId(),
        seq: nextSeq(),
        time: Date.now(),
      };
      const logs = mergeTimeline(state.logs, [full]);
      return derive(logs, state.filter, state.search, state.origin, state.revision + 1);
    }),

  appendFileLogs: (entries) =>
    set((state) => {
      const fresh = dropStaleEntries(entries, state.sessionStart);
      /* 空批次直接原样返回：计数/过滤结果不变（setState 浅合并，不覆盖
       * counts），与「追加空数组时状态保持不变」的既有契约一致。 */
      if (fresh.length === 0) return { logs: state.logs };
      const logs = mergeTimeline(state.logs, fresh);
      /* 批次里全是重复行 → 时间线没变，不推进 revision（否则「有 N 条新的日志」
       * 会被重复行刷成假计数）。 */
      if (logs === state.logs) return { logs: state.logs };
      return derive(logs, state.filter, state.search, state.origin, state.revision + 1);
    }),

  /* 会话起点到达得比首次轮询晚时，时间线里可能已经混进了上次运行的行：
   * 一次性收拢到底。应用运行中的 mtime 不会后移，因此这是幂等操作。 */
  setSessionStart: (sessionStart) =>
    set((state) => {
      const logs = dropStaleEntries(state.logs, sessionStart);
      const changed = logs.length !== state.logs.length;
      return {
        sessionStart,
        ...derive(
          logs,
          state.filter,
          state.search,
          state.origin,
          changed ? state.revision + 1 : state.revision,
        ),
      };
    }),

  /* 服务端进程标识变化 = 真的换了进程。旧时间线里的行属于上一个进程，与本次
   * 会话没有可比性（且新进程会从头写自己的日志文件），一次性清干净并重置游标；
   * 页脚随后会显示新的标识。 */
  setBootId: (bootId) =>
    set((state) => {
      if (state.bootId === bootId) return {};
      const changed = state.bootId !== null && state.bootId !== bootId;
      return {
        bootId,
        ...(changed
          ? {
              ...derive([], state.filter, state.search, state.origin, state.revision + 1),
              page: 1,
              viewRevision: state.revision + 1,
              viewLength: 0,
            }
          : {}),
      };
    }),

  setFilter: (f) =>
    set((state) => ({
      filter: f,
      filteredLogs: computeFiltered(state.logs, f, state.search, state.origin),
      /* 过滤条件变了，当前页多半越界：回到最新一页，避免用户停在空白页。 */
      page: 1,
      viewRevision: state.revision,
      viewLength: computeFiltered(state.logs, f, state.search, state.origin).length,
    })),

  setOrigin: (o) =>
    set((state) => ({
      origin: o,
      filteredLogs: computeFiltered(state.logs, state.filter, state.search, o),
      page: 1,
      viewRevision: state.revision,
      viewLength: computeFiltered(state.logs, state.filter, state.search, o).length,
    })),

  setSearch: (s) =>
    set((state) => ({
      search: s,
      filteredLogs: computeFiltered(state.logs, state.filter, s, state.origin),
      page: 1,
      viewRevision: state.revision,
      viewLength: computeFiltered(state.logs, state.filter, s, state.origin).length,
    })),

  /* 翻页时更新「已读水位」：进入历史页 → 记下当前 revision（此后新增的才算
   * 「新来的」）；回到第 1 页 → 推到当前 revision（已读）。 */
  setPage: (page) =>
    set((state) => ({
      page: Math.max(1, page),
      viewRevision: state.revision,
      viewLength: state.filteredLogs.length,
    })),
  setIsOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  clear: () =>
    set((state) => ({
      ...derive([], state.filter, state.search, state.origin, state.revision + 1),
      page: 1,
      /* 清空后「已读水位」推到当前 revision：新日志的 revision 更大，
       * 仍能正确算作新内容。 */
      viewRevision: state.revision + 1,
      viewLength: 0,
    })),

  copyAll: async () => {
    const text = formatForClipboard(get().logs);
    if (typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  },

  download: () => {
    if (typeof document === "undefined") return;
    const blob = new Blob([formatForClipboard(get().logs)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comfy-app-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
}));

/* ── 派生视图：面板怎么切一页 ───────────────────────────────────────── */

/**
 * 按时间倒序分页：第 1 页是最新的一段，往前翻看更早的日志。
 *
 * 分页在**过滤后的时间线**上做（filteredLogs 顺序即时间顺序），因此
 * 「最新一页」总在 page=1，与 `counts.all` 无关。
 */
export function selectPageLogs(
  logs: LogEntry[],
  page: number,
  pageSize: number,
): { entries: LogEntry[]; page: number; totalPages: number } {
  const total = logs.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const end = total - (safePage - 1) * pageSize;
  const start = Math.max(0, end - pageSize);
  return { entries: logs.slice(start, end), page: safePage, totalPages };
}

/**
 * 面板是否「已经不在最新」：不在第 1 页，或用户手动上滚离开了底部。
 * 两者都必须给「回到最新」出口，否则用户会以为日志不再刷新（ISSUE #262）。
 */
export function selectShouldPinToLatest(page: number, autoScroll: boolean): boolean {
  return page !== 1 || !autoScroll;
}

/**
 * 停在历史位置期间新来了多少条日志。
 *
 * 判据是 `revision` 变化（时间线真的变过），而不是「末条变了」：按时刻排序后，
 * 一条**迟到的旧时刻行**会插进中间、末条不动——只看末条会漏掉这类新增。
 *
 * 计数口径是**时间线里比水位新的条数**（`readAt` 是翻页那一刻的时间线长度）。
 * 为什么用长度而不是 seq：`seq` 在测试与多 store 场景下可能被夹具重造，
 * 与真实入库顺序不可比。长度差是「用户接下来会多看到几条」的直接答案，
 * 也是这里唯一需要回答的问题。
 */
export function selectNewLogCount(state: {
  revision: number;
  viewRevision: number;
  filteredLogs: LogEntry[];
  /** 翻页那一刻的 filteredLogs.length（store 的 viewLength）。 */
  viewLength: number;
  page: number;
  autoScroll: boolean;
}): number {
  if (state.revision <= state.viewRevision) return 0;
  if (!selectShouldPinToLatest(state.page, state.autoScroll)) return 0;
  return Math.max(0, state.filteredLogs.length - Math.min(state.viewLength, state.filteredLogs.length));
}
