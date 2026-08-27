"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

interface LogContextValue {
  logs: LogEntry[];
  filteredLogs: LogEntry[];
  filter: LogFilter;
  setFilter: (f: LogFilter) => void;
  search: string;
  setSearch: (s: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleOpen: () => void;
  clear: () => void;
  copyAll: () => Promise<void>;
  download: () => void;
  counts: Record<LogLevel | "all", number>;
}

const LogContext = createContext<LogContextValue | null>(null);

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

function serialize(args: unknown[]): string {
  return args.map(serializeOne).join(" ");
}

/**
 * 从调用栈中定位真正的业务调用方。
 * 拦截 console.* 时，栈顶是 log-provider 自己的包装函数，需要跳过；
 * 再跳过 React / Next.js / Tauri 等框架帧，返回第一个业务代码位置。
 */
function captureLocation(): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;

    const loggerSelfRe = /log-provider\.(tsx|ts|jsx|js)/;
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
 * 过滤 React Query 内部查询日志（如 `%c << query #488 %cworkflowModel.list`）。
 * 这些日志会在 tRPC 组件重渲染时大量产生，淹没业务日志；但它们对业务排错
 * 没有价值，因此直接丢弃。
 */
function isReactQueryLog(args: unknown[]): boolean {
  if (args.length < 2) return false;
  const first = args[0];
  if (typeof first !== "string") return false;
  return /^\s*%c\s*(<<|>>)\s*query\s+#\d+/i.test(first);
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

function parseFileLogs(text: string, baseDate?: Date): LogEntry[] {
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
    } else {
      entries.push({
        id: nextId(),
        time: now,
        level: "info",
        message: line,
        source: "system",
      });
    }
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

export function useLogPanel(): LogContextValue {
  const ctx = useContext(LogContext);
  if (!ctx) throw new Error("useLogPanel must be used inside LogProvider");
  return ctx;
}

export function LogProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>(() =>
    typeof window === "undefined"
      ? []
      : [
          {
            id: nextId(),
            time: Date.now(),
            level: "info",
            message:
              "日志面板已启用。按 Ctrl+Shift+L 或点击状态栏日志按钮打开/关闭。",
            source: "system",
          },
        ],
  );
  const [filter, setFilter] = useState<LogFilter>("all");
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const logsRef = useRef(logs);
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const addEntry = useCallback((entry: Omit<LogEntry, "id" | "time">) => {
    const full: LogEntry = { ...entry, id: nextId(), time: Date.now() };
    setLogs((prev) => [...prev, full].slice(-MAX_LOG_ENTRIES));
  }, []);

  // ── Intercept console.* so logs appear in the panel ──
  useEffect(() => {
    if (typeof window === "undefined") return;

    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    } as const;

    const makeLogger =
      (level: LogLevel) =>
      (...args: unknown[]) => {
        originals[level](...args);
        if (isReactQueryLog(args)) return;
        const location = captureLocation();
        addEntry({
          level,
          message: serialize(args),
          source: "console",
          location,
        });
      };

    console.log = makeLogger("info");
    console.info = makeLogger("info");
    console.warn = makeLogger("warn");
    console.error = makeLogger("error");
    console.debug = makeLogger("debug");

    return () => {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
      console.debug = originals.debug;
    };
  }, [addEntry]);

  // ── Listen to Tauri backend log events (optional; no-op in browser) ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        unlisten = await listen<{ level: string; message: string }>(
          "log:emit",
          (event) => {
            const lv = event.payload?.level ?? "info";
            const message = event.payload?.message ?? "";
            if (!message) return;
            const level: LogLevel =
              lv === "error"
                ? "error"
                : lv === "warn"
                  ? "warn"
                  : lv === "debug"
                    ? "debug"
                    : "info";
            addEntry({ level, message, source: "tauri" });
          },
        );
      } catch {
        // Not running inside Tauri — ignore.
      }
    };

    void setup();
    return () => unlisten?.();
  }, [addEntry]);

  // ── Load launcher log file: startup logs + ongoing dev-server output ──
  const fileOffsetRef = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let mounted = true;
    const POLL_MS = 2000;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/logs/current?offset=${fileOffsetRef.current}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          content: string;
          size: number;
          offset: number;
        };
        if (!mounted || !data.content) return;

        // 文件被重置（新运行）时 offset 会回 0；此时丢弃旧 offset，完整重读
        if (data.offset === 0 && fileOffsetRef.current > 0) {
          fileOffsetRef.current = 0;
        }

        const entries = parseFileLogs(data.content);
        if (entries.length > 0) {
          setLogs((prev) => [...prev, ...entries].slice(-MAX_LOG_ENTRIES));
        }
        fileOffsetRef.current = data.size;
      } catch {
        // 开发服务器尚未就绪或日志文件不存在时静默忽略
      }
    };

    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  // ── Keyboard shortcut: Ctrl+Shift+L ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const clear = useCallback(() => setLogs([]), []);

  const copyAll = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(formatForClipboard(logsRef.current));
    } catch {
      // Fallback
      const text = formatForClipboard(logsRef.current);
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, []);

  const download = useCallback(() => {
    if (typeof document === "undefined") return;
    const blob = new Blob([formatForClipboard(logsRef.current)], {
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
  }, []);

  const toggleOpen = useCallback(() => setIsOpen((p) => !p), []);

  const filteredLogs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return logs.filter((entry) => {
      const levelOk = filter === "all" || entry.level === filter;
      const searchOk =
        !needle ||
        entry.message.toLowerCase().includes(needle) ||
        entry.location?.toLowerCase().includes(needle);
      return levelOk && searchOk;
    });
  }, [logs, filter, search]);

  const counts = useMemo(() => {
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
  }, [logs]);

  const value = useMemo(
    () => ({
      logs,
      filteredLogs,
      filter,
      setFilter,
      search,
      setSearch,
      isOpen,
      setIsOpen,
      toggleOpen,
      clear,
      copyAll,
      download,
      counts,
    }),
    [
      logs,
      filteredLogs,
      filter,
      search,
      isOpen,
      toggleOpen,
      clear,
      copyAll,
      download,
      counts,
    ],
  );

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
}
