"use client";

/**
 * log-store — 日志面板全局状态单例（Zustand）。
 *
 * 规范 07 §7.4：日志状态用 Zustand 管理，不使用 React Context。
 * 多个面板（BrowserStatusBar / LogPanel）直接读取同一 store。
 */

import { create } from "zustand";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** nanoid-style short id */
  id: string;
  /** Unix timestamp (ms) */
  time: number;
  level: LogLevel;
  /** Serialized message */
  message: string;
  /** Where the log came from */
  source: "console" | "tauri" | "system";
  /** 文件来源：dev-launcher / app-runtime 的文件行带此标记（仅面板内显示，不参与过滤） */
  origin?: "dev" | "launcher" | "app-runtime";
  /** Caller location (file:line) for console logs */
  location?: string;
  /**
   * 入库顺序（严格递增）。面板按它排序、并据它判断「有没有比当前页更新的日志」。
   *
   * 为什么不按 `time` 排：文件转录行带的是**文件写入时刻**，而它在轮询响应里
   * 是分批到达的——三路轮询（launcher / dev / app-runtime）并发，`app-runtime`
   * 那一路要等两个 IO 响应，于是它的旧时刻行会晚于 dev 的新时刻行入库。面板
   * 此前直接 `[...state.logs, ...fresh]` 按到达顺序堆叠，时间线排序只能靠
   * DOM 里恰好有序，一旦乱序，用户看到的就是「新增日志不见了」（其实被插在
   * 中间，视线之外）——ISSUE #346。
   *
   * `time` 仍是**展示**时刻（行内时间戳），`seq` 只服务排序与「有无新内容」判定。
   */
  seq: number;
}

export type LogFilter = LogLevel | "all";

/** 环形缓冲上限：内存中最多保留 2000 条日志（规范 07 §7.5） */
const MAX_LOG_ENTRIES = 2000;

let entryId = 0;
function nextId() {
  entryId = (entryId + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${entryId.toString(36)}`;
}

/**
 * 入库顺序计数器（进程内单调递增，不随清空 / 过滤重置）。
 *
 * 它只回答「谁先进的面板」——排序与「有没有比当前页更新的日志」都靠它，
 * 不依赖各来源自带的时间戳（三路轮询并发到达，时间戳顺序与到达顺序无关）。
 * 放在模块级而非 store state 里：`clear()` / 重载后仍要保持单调，否则清空
 * 后新日志的 seq 会退回旧值，被当成「历史行」排到前面。
 */
let entrySeq = 0;
function nextSeq() {
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
  const now = Date.now();
  const today = baseDate ?? new Date();
  const entries: LogEntry[] = [];
  /* 解析顺序即入库顺序：seq 在解析期分配，批次之间自然衔接（appendFileLogs
   * 还会再归一化一次，见那里的说明）。 */
  let seq = nextSeq();
  const push = (
    entry: Omit<LogEntry, "seq">,
  ) => {
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

function formatForClipboard(entries: LogEntry[]): string {
  return entries
    .map(
      (e) =>
        `[${formatTime(e.time, { alwaysDate: true })}] [${e.level.toUpperCase()}]${e.location ? ` [${e.location}]` : ""} ${e.message}`,
    )
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
): LogEntry[] {
  const needle = search.trim().toLowerCase();
  return logs.filter((entry) => {
    const levelOk = filter === "all" || entry.level === filter;
    const searchOk =
      !needle ||
      entry.message.toLowerCase().includes(needle) ||
      entry.location?.toLowerCase().includes(needle);
    return levelOk && searchOk;
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
  search: string;
  isOpen: boolean;
  counts: Record<LogLevel | "all", number>;
  /** 翻页：当前页（1 起，倒序查看，1 = 最新一页）与每页条数（#294）。 */
  page: number;
  pageSize: number;
  /**
   * 本次运行的开始时间（毫秒）；null = 未知（非 launcher 启动）。
   * 面板只显示本次运行：行时刻早于它即上一次运行的残留（见 dropStaleEntries）。
   */
  sessionStart: number | null;
  /**
   * 「已读水位」：翻到历史页那一刻的末条 `seq`。
   *
   * 面板据此算出「停在历史页期间又新来了多少条日志」并在页脚提示——历史页的
   * 内容不会因为新日志而改变，没有这条提示，用户看到的就是「计数在涨、面板不
   * 动」（ISSUE #346）。回到第 1 页即视为已读，水位推到当前末条。
   */
  viewSeq: number;
  addEntry: (entry: Omit<LogEntry, "id" | "time" | "seq">) => void;
  appendFileLogs: (entries: LogEntry[]) => void;
  setSessionStart: (sessionStart: number | null) => void;
  setFilter: (f: LogFilter) => void;
  setSearch: (s: string) => void;
  setPage: (page: number) => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  clear: () => void;
  copyAll: () => Promise<void>;
  download: () => void;
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
export function dropStaleEntries(entries: LogEntry[], cutoffMs: number | null | undefined): LogEntry[] {
  if (cutoffMs === null || cutoffMs === undefined) return entries;
  return entries.filter((entry) => entry.time >= cutoffMs);
}

/**
 * 把一批新条目并进面板时间线，按 **入库顺序（seq）** 排列。
 *
 * 三路轮询（launcher / dev / app-runtime）并发到达，而转录行带的是**文件写入
 * 时刻**——后到的批次里可能有更早时刻的行（app-runtime 那一路要多等两个 IO
 * 响应）。此前直接 `[...logs, ...fresh]` 按到达顺序追加，时间戳顺序与数组顺序
 * 就可能不一致：面板看起来「停在原地」，新增的行其实被插进了中间（滚动位置
 * 之外），用户读到的是「新增日志怎么不见了」（ISSUE #346）。
 *
 * 快路径：绝大多数批次本来就是单调的（`fresh` 的 seq 全都大于现有末条），
 * 直接 push 免掉排序；只有真正乱序时才按 seq 稳定排序。
 */
/** 时间线末条的入库顺序（空面板为 0）——「已读水位」与「有无新内容」都用它。 */
export function lastSeqOf(logs: LogEntry[]): number {
  return logs[logs.length - 1]?.seq ?? 0;
}

export function appendSorted(current: LogEntry[], fresh: LogEntry[]): LogEntry[] {
  if (fresh.length === 0) return current;
  if (current.length === 0) return fresh;
  const last = current[current.length - 1]!;
  if (fresh[0]!.seq > last.seq) return [...current, ...fresh];
  return [...current, ...fresh].sort((a, b) => a.seq - b.seq);
}

function derive(logs: LogEntry[], filter: LogFilter, search: string) {
  return {
    logs,
    counts: computeCounts(logs),
    filteredLogs: computeFiltered(logs, filter, search),
  };
}

export const useLogStore = create<LogStoreState>((set, get) => ({
  logs: typeof window === "undefined" ? [] : [welcomeEntry()],
  filteredLogs: [],
  filter: "all",
  search: "",
  isOpen: false,
  counts: { all: 0, debug: 0, info: 0, warn: 0, error: 0 },
  page: 1,
  pageSize: 2000,
  sessionStart: null,
  viewSeq: 0,

  addEntry: (entry) =>
    set((state) => {
      const full: LogEntry = {
        ...entry,
        id: nextId(),
        seq: nextSeq(),
        time: Date.now(),
      };
      return derive(
        appendSorted(state.logs, [full]).slice(-MAX_LOG_ENTRIES),
        state.filter,
        state.search,
      );
    }),

  appendFileLogs: (entries) =>
    set((state) => {
      const fresh = dropStaleEntries(entries, state.sessionStart);
      /* 空批次直接原样返回：计数/过滤结果不变（setState 浅合并，不覆盖
       * counts），与「追加空数组时状态保持不变」的既有契约一致。 */
      if (fresh.length === 0) return { logs: state.logs };
      const logs = appendSorted(state.logs, fresh).slice(-MAX_LOG_ENTRIES);
      return derive(logs, state.filter, state.search);
    }),

  /* 会话起点到达得比首次轮询晚时，时间线里可能已经混进了上次运行的行：
   * 一次性收拢到底。应用运行中的 mtime 不会后移，因此这是幂等操作。 */
  setSessionStart: (sessionStart) =>
    set((state) => {
      const logs = dropStaleEntries(state.logs, sessionStart);
      return { sessionStart, ...derive(logs, state.filter, state.search) };
    }),

  setFilter: (f) =>
    set((state) => ({ filter: f, filteredLogs: computeFiltered(state.logs, f, state.search) })),

  setSearch: (s) =>
    set((state) => ({ search: s, filteredLogs: computeFiltered(state.logs, state.filter, s) })),

  /* 翻页时更新「已读水位」：进入历史页 → 记下当前末条 seq（此后新增的才算
   * 「新来的」）；回到第 1 页 → 推到末条（已读）。 */
  setPage: (page) =>
    set((state) => ({
      page: Math.max(1, page),
      viewSeq: lastSeqOf(state.logs),
    })),
  setIsOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  clear: () =>
    set((state) => ({
      ...derive([], state.filter, state.search),
      /* 清空后「已读水位」归零：新日志的 seq 仍大于它，能正确算作新内容。 */
      viewSeq: 0,
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
