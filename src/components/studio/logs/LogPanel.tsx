"use client";

import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  FileText,
  Search,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  useLogPanel,
  type LogEntry,
  type LogLevel,
  type LogFilter,
} from "./LogProvider";

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
    const gray = (i - 232) * 10 + 8;
    return `rgb(${gray},${gray},${gray})`;
  }
  const redIndex = Math.floor((i - 16) / 36);
  const greenIndex = Math.floor(((i - 16) % 36) / 6);
  const blueIndex = (i - 16) % 6;
  const ramp = [0, 95, 135, 175, 215, 255];
  return `rgb(${ramp[redIndex]},${ramp[greenIndex]},${ramp[blueIndex]})`;
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

    const parts = raw.split(";").map((part) => (part === "" ? 0 : Number(part)));
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
        const red = parts[i + 2];
        const green = parts[i + 3];
        const blue = parts[i + 4];
        if (red !== undefined && green !== undefined && blue !== undefined) {
          style.color = `rgb(${red},${green},${blue})`;
        }
        i += 5;
      } else if (code === 48 && parts[i + 1] === 2) {
        const red = parts[i + 2];
        const green = parts[i + 3];
        const blue = parts[i + 4];
        if (red !== undefined && green !== undefined && blue !== undefined) {
          style.backgroundColor = `rgb(${red},${green},${blue})`;
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
  // split 带捕获组时，匹配到的分隔符（时间戳/[OK]/URL 等）会保留在结果里；
  // 空串只出现在文本开头/结尾或相邻 token 之间，丢弃不会丢内容。
  // 每段是否着色由下方逐段匹配 LOG_TOKENS 决定，与这里的过滤无关。
  const parts = text.split(combined).filter(Boolean);
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
 * scroll, new-log arrival) — the single biggest cost in the old panel.
 * Memory is bounded by RENDER_CACHE_MAX (full clear on overflow).  Dev note:
 * Fast Refresh re-executes this module on edit, so rule changes naturally
 * start with a fresh cache — no stale-entry purge needed. */
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
  const date = new Date(ts);
  const time = date.toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  if (!isSameDay(date, new Date())) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
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
    <div className="flex items-start gap-2.5 border-b border-white/3 px-4 py-1 font-mono text-[13px] leading-snug hover:bg-white/2">
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
      {entry.location && (
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(entry.location!).catch(() => undefined)}
          className="max-w-[280px] shrink-0 cursor-pointer truncate text-left text-[11px] text-gray-600 hover:text-gray-400"
          title={`${entry.location}（点击复制）`}
        >
          {entry.location}
        </button>
      )}
      {entry.source !== "console" && (
        <span className="shrink-0 text-[11px] text-gray-600">
          {entry.source}
        </span>
      )}
    </div>
  );
});

export function LogPanel() {
  const { filteredLogs, filter, search, isOpen, counts } = useLogPanel(
    useShallow((state) => ({
      filteredLogs: state.filteredLogs,
      filter: state.filter,
      search: state.search,
      isOpen: state.isOpen,
      counts: state.counts,
    })),
  );
  const setFilter = useLogPanel((state) => state.setFilter);
  const setSearch = useLogPanel((state) => state.setSearch);
  const setIsOpen = useLogPanel((state) => state.setIsOpen);
  const clear = useLogPanel((state) => state.clear);
  const copyAll = useLogPanel((state) => state.copyAll);
  const download = useLogPanel((state) => state.download);

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
    <div className="fixed inset-0 z-99 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#12101c] shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/8 bg-white/2 px-4">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-violet-400" />
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
            {FILTER_LABELS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                  filter === option.value
                    ? "bg-white/10 text-gray-100"
                    : "text-gray-500 hover:bg-white/4 hover:text-gray-300"
                }`}
                title={`${option.label} (${counts[option.value]})`}
              >
                {option.label}
                <span className="ml-1 text-[11px] text-gray-600">
                  {counts[option.value]}
                </span>
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative ml-auto flex w-60 items-center">
            <Search size={14} className="pointer-events-none absolute left-2.5 text-gray-600" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索日志..."
              className="h-8 w-full rounded-lg border border-white/6 bg-[#13131a] pr-7 pl-8 text-[13px] text-gray-200 outline-none placeholder:text-gray-600 focus:border-violet-500/40"
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
              onClick={() => setWrap((prev) => !prev)}
              title={wrap ? "折叠超长行" : "自动换行显示"}
              className={`rounded-md p-2 transition-colors ${
                wrap
                  ? "bg-white/8 text-gray-200"
                  : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
              }`}
            >
              <Type size={16} />
            </button>
            <button
              type="button"
              onClick={copyAll}
              title="复制全部"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              onClick={download}
              title="下载日志"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              onClick={clear}
              title="清空"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              title="关闭 (Ctrl+Shift+L)"
              className="rounded-md p-2 text-gray-500 transition-colors hover:bg-white/5 hover:text-gray-300"
            >
              <X size={16} />
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
              <FileText size={32} strokeWidth={1.5} className="opacity-30" />
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
        <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/8 bg-white/2 px-4 text-[12px] text-gray-500">
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
