"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  useLogPanel,
  type LogEntry,
  type LogLevel,
  type LogFilter,
} from "./log-provider";

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: "bg-gray-500/15 text-gray-400 border-gray-500/20",
  info: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  error: "bg-rose-500/15 text-rose-400 border-rose-500/20",
};

/* ── ANSI SGR → React spans ──
 * 解析 \x1b[...m 颜色/样式码，把单色 message 渲染成与终端一致的多色文本。
 * 支持 8 色、亮色、256 色、RGB 前景/背景、bold/italic/underline/faint。 */
const ANSI_COLORS: Record<number, string> = {
  0: "#000000",
  1: "#ef4444",
  2: "#22c55e",
  3: "#f59e0b",
  4: "#3b82f6",
  5: "#a855f7",
  6: "#06b6d4",
  7: "#e5e7eb",
};
const ANSI_BRIGHT_COLORS: Record<number, string> = {
  0: "#4b5563",
  1: "#ff6b6b",
  2: "#4ade80",
  3: "#fbbf24",
  4: "#60a5fa",
  5: "#c084fc",
  6: "#22d3ee",
  7: "#f9fafb",
};

function parseAnsi256(i: number): string {
  if (i < 8) return ANSI_COLORS[i]!;
  if (i < 16) return ANSI_BRIGHT_COLORS[i - 8]!;
  if (i >= 232) {
    const v = (i - 232) * 10 + 8;
    return `rgb(${v},${v},${v})`;
  }
  const r = Math.floor((i - 16) / 36);
  const g = Math.floor(((i - 16) % 36) / 6);
  const b = (i - 16) % 6;
  const ramp = [0, 95, 135, 175, 215, 255];
  return `rgb(${ramp[r]},${ramp[g]},${ramp[b]})`;
}

interface AnsiStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: "bold";
  fontStyle?: "italic";
  textDecoration?: string;
  opacity?: number;
}

function ansiToSpans(text: string): React.ReactNode[] {
  const regex = /\x1b\[([0-9;:]*)m/g;
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let style: AnsiStyle = {};
  let key = 0;

  const pushChunk = (chunk: string, s: AnsiStyle) => {
    if (!chunk) return;
    if (Object.keys(s).length === 0) {
      out.push(<span key={key++}>{chunk}</span>);
      return;
    }
    const css: React.CSSProperties = {
      color: s.color,
      backgroundColor: s.backgroundColor,
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      textDecoration: s.textDecoration,
      opacity: s.opacity,
    };
    out.push(
      <span key={key++} style={css}>
        {chunk}
      </span>,
    );
  };

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    pushChunk(text.slice(lastIndex, match.index), style);
    lastIndex = regex.lastIndex;

    const raw = match[1];
    if (!raw || raw === "0" || raw === "00") {
      style = {};
      continue;
    }

    const parts = raw.split(";").map((n) => (n === "" ? 0 : Number(n)));
    let i = 0;
    while (i < parts.length) {
      const code = parts[i]!;
      if (code === 0) {
        style = {};
        i++;
      } else if (code === 1) {
        style.fontWeight = "bold";
        i++;
      } else if (code === 2) {
        style.opacity = 0.65;
        i++;
      } else if (code === 3) {
        style.fontStyle = "italic";
        i++;
      } else if (code === 4) {
        style.textDecoration = "underline";
        i++;
      } else if (code >= 30 && code <= 37) {
        style.color = ANSI_COLORS[code - 30];
        i++;
      } else if (code >= 40 && code <= 47) {
        style.backgroundColor = ANSI_COLORS[code - 40];
        i++;
      } else if (code >= 90 && code <= 97) {
        style.color = ANSI_BRIGHT_COLORS[code - 90];
        i++;
      } else if (code >= 100 && code <= 107) {
        style.backgroundColor = ANSI_BRIGHT_COLORS[code - 100];
        i++;
      } else if (code === 38 && parts[i + 1] === 5) {
        const idx = parts[i + 2];
        if (idx !== undefined) style.color = parseAnsi256(idx);
        i += 3;
      } else if (code === 48 && parts[i + 1] === 5) {
        const idx = parts[i + 2];
        if (idx !== undefined) style.backgroundColor = parseAnsi256(idx);
        i += 3;
      } else if (code === 38 && parts[i + 1] === 2) {
        const r = parts[i + 2];
        const g = parts[i + 3];
        const b = parts[i + 4];
        if (r !== undefined && g !== undefined && b !== undefined) {
          style.color = `rgb(${r},${g},${b})`;
        }
        i += 5;
      } else if (code === 48 && parts[i + 1] === 2) {
        const r = parts[i + 2];
        const g = parts[i + 3];
        const b = parts[i + 4];
        if (r !== undefined && g !== undefined && b !== undefined) {
          style.backgroundColor = `rgb(${r},${g},${b})`;
        }
        i += 5;
      } else {
        i++;
      }
    }
  }
  pushChunk(text.slice(lastIndex), style);
  return out;
}

/* ── Plain-text log token coloring ──
 * PowerShell Write-Host colors are host-rendered and NOT preserved by
 * Start-Transcript as ANSI escape codes.  When a message has no ANSI codes,
 * we colorize common launcher tokens ([OK], [STEP], URLs, etc.) so the
 * in-app panel matches the terminal look.
 */
interface TokenStyle {
  regex: RegExp;
  style: React.CSSProperties;
}
const LOG_TOKENS: TokenStyle[] = [
  { regex: /^\[\d{2}:\d{2}:\d{2}\]/g, style: { color: "#6b7280" } },
  { regex: /\[OK\]/g, style: { color: "#22c55e", fontWeight: "bold" } },
  { regex: /\[STEP\]/g, style: { color: "#06b6d4", fontWeight: "bold" } },
  { regex: /\[WARN\]/g, style: { color: "#f59e0b", fontWeight: "bold" } },
  { regex: /\[ERROR\]/g, style: { color: "#ef4444", fontWeight: "bold" } },
  { regex: /\[INFO\]/g, style: { color: "#9ca3af" } },
  { regex: /PID\s*[:：]\s*\d+/gi, style: { color: "#c084fc" } },
  {
    regex: /https?:\/\/[^\s]+/g,
    style: { color: "#60a5fa", textDecoration: "underline" },
  },
  { regex: /\b(?:[A-Z]:\\|\\)[^\s]*/g, style: { color: "#a78bfa" } },
];

function hasAnsi(text: string): boolean {
  return /\x1b\[[0-9;:]*m/.test(text);
}

function tokenizeLogMessage(text: string): React.ReactNode[] {
  const combined =
    /(\[\d{2}:\d{2}:\d{2}\]|\[OK\]|\[STEP\]|\[WARN\]|\[ERROR\]|\[INFO\]|PID\s*[:：]\s*\d+|https?:\/\/[^\s]+|\b(?:[A-Z]:\\|\\)[^\s]*)/gi;
  const parts = text.split(combined).filter((p) => p !== undefined && p !== "");
  let key = 0;
  return parts.map((part) => {
    for (const token of LOG_TOKENS) {
      token.regex.lastIndex = 0;
      if (token.regex.test(part)) {
        return (
          <span key={key++} style={token.style}>
            {part}
          </span>
        );
      }
    }
    return <span key={key++}>{part}</span>;
  });
}

/* Per-message render cache: a parsed log line is immutable, so we cache the
 * produced React spans by the raw message string.  This avoids re-running the
 * ANSI/token parser for every row on every parent re-render (search, filter,
 * scroll, new-log arrival) — the single biggest cost in the old panel. */
const RENDER_CACHE = new Map<string, React.ReactNode[]>();
const RENDER_CACHE_MAX = 5000;

function renderLogMessage(text: string): React.ReactNode[] {
  const hit = RENDER_CACHE.get(text);
  if (hit) return hit;
  const out = hasAnsi(text) ? ansiToSpans(text) : tokenizeLogMessage(text);
  if (RENDER_CACHE.size >= RENDER_CACHE_MAX) RENDER_CACHE.clear();
  RENDER_CACHE.set(text, out);
  return out;
}

const FILTER_LABELS: { label: string; value: LogFilter }[] = [
  { label: "全部", value: "all" },
  { label: "调试", value: "debug" },
  { label: "信息", value: "info" },
  { label: "警告", value: "warn" },
  { label: "错误", value: "error" },
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  if (!isSameDay(d, new Date())) {
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${month}-${day} ${time}`;
  }
  return time;
}

const LogRow = memo(function LogRow({
  entry,
  wrap,
}: {
  entry: LogEntry;
  wrap: boolean;
}) {
  const levelClass = LEVEL_STYLES[entry.level];
  return (
    <div className="flex items-start gap-2.5 border-b border-white/[0.03] px-4 py-1 font-mono text-[13px] leading-snug hover:bg-white/[0.02]">
      <span className="shrink-0 text-gray-500">{formatTime(entry.time)}</span>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${levelClass}`}
      >
        {entry.level}
      </span>
      <span
        className={`min-w-0 flex-1 ${
          wrap ? "break-words whitespace-pre-wrap" : "truncate"
        } ${
          entry.level === "error"
            ? "text-rose-300"
            : entry.level === "warn"
              ? "text-amber-300"
              : entry.level === "debug"
                ? "text-gray-400"
                : "text-gray-300"
        }`}
        title={!wrap ? entry.message : undefined}
      >
        {renderLogMessage(entry.message)}
      </span>
      {entry.source !== "console" && (
        <span className="shrink-0 text-[11px] text-gray-600">
          {entry.source}
        </span>
      )}
    </div>
  );
});

export function LogPanel() {
  const {
    filteredLogs,
    filter,
    setFilter,
    search,
    setSearch,
    isOpen,
    setIsOpen,
    clear,
    copyAll,
    download,
    counts,
  } = useLogPanel();

  const bodyRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrap, setWrap] = useState(true);
  const prevCountRef = useRef(filteredLogs.length);

  // Auto-scroll to bottom when new logs arrive, unless user scrolled up.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !isOpen) return;
    if (filteredLogs.length > prevCountRef.current && autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
    prevCountRef.current = filteredLogs.length;
  }, [filteredLogs.length, isOpen, autoScroll]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setAutoScroll(nearBottom);
  };

  const errorCount = useMemo(() => counts.error, [counts.error]);

  if (!isOpen) return null;

  const total = filteredLogs.length;

  return (
    <div className="fixed inset-0 z-[99] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#12101c] shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-white/[0.02] px-4">
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-violet-400"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="9" y2="9" />
            </svg>
            <span className="text-[15px] font-semibold text-gray-100">
              应用日志
            </span>
            {errorCount > 0 && (
              <span className="rounded-full bg-rose-500/20 px-1.5 py-0.5 text-[11px] font-medium text-rose-300">
                {errorCount} 错误
              </span>
            )}
          </div>

          {/* Level filters */}
          <div className="ml-4 flex items-center gap-1">
            {FILTER_LABELS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                  filter === f.value
                    ? "bg-white/[0.10] text-gray-100"
                    : "text-gray-500 hover:bg-white/[0.04] hover:text-gray-300"
                }`}
                title={`${f.label} (${counts[f.value]})`}
              >
                {f.label}
                <span className="ml-1 text-[11px] text-gray-600">
                  {counts[f.value]}
                </span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative ml-auto flex w-60 items-center">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="pointer-events-none absolute left-2.5 text-gray-600"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索日志..."
              className="h-8 w-full rounded-lg border border-white/[0.06] bg-[#13131a] pr-7 pl-8 text-[13px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 text-gray-500 hover:text-gray-300"
              >
                ×
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 pl-2">
            <button
              type="button"
              onClick={() => setWrap((w) => !w)}
              title={wrap ? "折叠超长行" : "自动换行显示"}
              className={`rounded-md p-2 transition-colors ${
                wrap
                  ? "bg-white/[0.08] text-gray-200"
                  : "text-gray-500 hover:bg-white/[0.05] hover:text-gray-300"
              }`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="4 7 4 4 20 4 20 7" />
                <line x1="9" y1="20" x2="15" y2="20" />
                <line x1="12" y1="4" x2="12" y2="20" />
              </svg>
            </button>
            <button
              type="button"
              onClick={copyAll}
              title="复制全部"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
            </button>
            <button
              type="button"
              onClick={download}
              title="下载日志"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={clear}
              title="清空"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="关闭 (Ctrl+Shift+L)"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/[0.05] hover:text-gray-300"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          onScroll={onScroll}
          className="custom-scrollbar flex-1 overflow-y-auto bg-[#0d0d14]/60"
        >
          {total === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-[13px] text-gray-600">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="opacity-30"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="9" y2="9" />
              </svg>
              暂无匹配的日志
            </div>
          ) : (
            <div className="flex flex-col">
              {filteredLogs.map((entry) => (
                <LogRow key={entry.id} entry={entry} wrap={wrap} />
              ))}
            </div>
          )}
        </div>

        {/* Footer / count */}
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/[0.08] bg-white/[0.02] px-4 text-[12px] text-gray-500">
          <span>
            显示 {filteredLogs.length} / 总计 {counts.all} 条
          </span>
          <span className="flex items-center gap-3">
            {!autoScroll && (
              <button
                type="button"
                onClick={() => {
                  setAutoScroll(true);
                  const el = bodyRef.current;
                  if (el) el.scrollTop = el.scrollHeight;
                }}
                className="rounded-md bg-violet-500/90 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-violet-500"
              >
                恢复自动滚动
              </button>
            )}
            <span>保留全部日志</span>
          </span>
        </div>
      </div>
    </div>
  );
}
