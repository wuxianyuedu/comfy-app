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
  /** Caller location (file:line) for console logs */
  location?: string;
}

export type LogFilter = LogLevel | "all";

/** 环形缓冲上限：内存中最多保留 2000 条日志（规范 07 §7.5） */
const MAX_LOG_ENTRIES = 2000;

let entryId = 0;
function nextId() {
  entryId = (entryId + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${entryId.toString(36)}`;
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
 * 再跳过 React / Next.js / Tauri 等框架帧，返回第一个业务代码位置。
 */
export function captureLocation(): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;

    const loggerSelfRe = /log-(?:store|provider)\.(tsx|ts|jsx|js)/;
    const frameworkRe =
      /node_modules|react-dom|react\.production|react\.development|next\/(?:dist|server|client)|@tauri-apps|scheduler|webpack[\/](?:runtime|bootstrap)|\[native code\]/i;

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

        if (
          pass === 1 &&
          (path.includes("node_modules") || path.endsWith(".js"))
        ) {
          // 兜底帧来自 node_modules/chunks，只保留文件名
          path = path.replace(/^.*\//, "");
        }

        // 取 /src/ 之后的路径作为最简可读形式
        const srcIdx = path.indexOf("/src/");
        if (srcIdx !== -1) path = path.slice(srcIdx + 1);

        if (path && /^\d+$/.test(lineNo) && !/^\d+$/.test(path)) {
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

export function parseFileLogs(text: string, baseDate?: Date): LogEntry[] {
  const now = Date.now();
  const today = baseDate ?? new Date();
  const entries: LogEntry[] = [];
  for (const rawLine of text.split("\n")) {
    // Strip ANSI SGR (e.g. \x1b[36m) that the launcher now writes into the
    // transcript, so the [HH:mm:ss] [LEVEL] regex still matches cleanly.
    const line = rawLine.replace(/\r$/, "").replace(/\x1b\[[0-9;:]*m/g, "");
    if (!line.trim()) continue;
    const m = LOG_LINE_RE.exec(line);
    if (m) {
      const [, hh, mm, ss, lv, msg] = m;
      const d = new Date(today);
      d.setHours(Number(hh ?? "0"), Number(mm ?? "0"), Number(ss ?? "0"), 0);
      entries.push({
        id: nextId(),
        time: d.getTime(),
        level: parseLogLevel(lv ?? "INFO"),
        message: msg ?? "",
        source: "system",
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
      entries.push({
        id: nextId(),
        time: d.getTime(),
        level: "info",
        message: msg ?? "",
        source: "system",
      });
      continue;
    }
    entries.push({
      id: nextId(),
      time: now,
      level: "info",
      message: line,
      source: "system",
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
  addEntry: (entry: Omit<LogEntry, "id" | "time">) => void;
  appendFileLogs: (entries: LogEntry[]) => void;
  setFilter: (f: LogFilter) => void;
  setSearch: (s: string) => void;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  clear: () => void;
  copyAll: () => Promise<void>;
  download: () => void;
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

  addEntry: (entry) =>
    set((state) => {
      const full: LogEntry = { ...entry, id: nextId(), time: Date.now() };
      return derive([...state.logs, full].slice(-MAX_LOG_ENTRIES), state.filter, state.search);
    }),

  appendFileLogs: (entries) =>
    set((state) => {
      const logs = [...state.logs, ...entries].slice(-MAX_LOG_ENTRIES);
      return derive(logs, state.filter, state.search);
    }),

  setFilter: (f) =>
    set((state) => ({ filter: f, filteredLogs: computeFiltered(state.logs, f, state.search) })),

  setSearch: (s) =>
    set((state) => ({ search: s, filteredLogs: computeFiltered(state.logs, state.filter, s) })),

  setIsOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

  clear: () =>
    set((state) => derive([], state.filter, state.search)),

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
