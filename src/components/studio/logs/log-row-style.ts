/**
 * log-row-style — 日志行的**纯**渲染样式与分片（无 React、可单测）。
 *
 * 规范 17 的四层范式：把「一行日志怎么上色 / 怎么切片」这类可判定逻辑从视图
 * （LogPanel.tsx）里拿出来，视图只做「把分片映射成 className 渲染」。
 *
 * 数据来源两类：
 *   1. 行文本自带 ANSI SGR（子进程原始输出，pip/torch/drizzle-kit 会上色）；
 *   2. 无 ANSI 时的语义上色（启动转录的 `[OK]`/`[STEP]`/URL/路径、logrus 的
 *      `level=` 字段）。
 */

import type { LogLevel } from "./log-store";
import { colorizeLogrusLine, parseAnsiSegments, type AnsiStyleKey } from "@/lib/log-ansi";

/** 行文本里识别出的词法分片。`style` 为空 = 按级别默认色渲染。 */
export interface RowToken {
  text: string;
  /** 语义样式键（与 ANSI 样式键同一套，视图映射成 className）。 */
  style?: AnsiStyleKey;
}

/** 日志级别的徽标配色（视图与测试共用同一份表）。 */
export const LEVEL_BADGE_STYLES: Record<LogLevel, string> = {
  debug: "bg-gray-500/15 text-gray-400 border-gray-500/20",
  info: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  warn: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  error: "bg-rose-500/15 text-rose-400 border-rose-500/20",
};

/** 日志级别的正文配色（视图与测试共用同一份表）。 */
export const LEVEL_TEXT_STYLES: Record<LogLevel, string> = {
  debug: "text-gray-400",
  info: "text-gray-300",
  warn: "text-amber-300",
  error: "text-rose-300",
};

export function hasAnsi(text: string): boolean {
  return /\x1b\[[0-9;:]*m/.test(text);
}

/**
 * 无 ANSI 时的词法上色：启动转录里 `Write-Host` 的颜色不会进文件，
 * 面板按 token 复原终端观感（时间戳调暗、`[OK]` 绿、URL 蓝、路径紫）。
 */
const TOKEN_RE =
  /(\[\d{2}:\d{2}:\d{2}\]|\[OK\]|\[STEP\]|\[WARN\]|\[ERROR\]|\[INFO\]|PID\s*[:：]\s*\d+|https?:\/\/[^\s]+|\b(?:[A-Z]:\\|\\)[^\s]*)/gi;

const TOKEN_STYLES: { pattern: RegExp; style: AnsiStyleKey }[] = [
  { pattern: /^\[\d{2}:\d{2}:\d{2}\]$/, style: "gray" },
  { pattern: /^\[OK\]$/, style: "green-bright" },
  { pattern: /^\[STEP\]$/, style: "cyan-bright" },
  { pattern: /^\[WARN\]$/, style: "yellow-bright" },
  { pattern: /^\[ERROR\]$/, style: "red" },
  { pattern: /^\[INFO\]$/, style: "gray" },
  { pattern: /^PID\s*[:：]/i, style: "magenta" },
  { pattern: /^https?:\/\//i, style: "blue-bright" },
  { pattern: /^(?:[A-Z]:\\|\\)/i, style: "magenta-bright" },
];

/** 按 `TOKEN_RE` 把一行切成若干分片，命中的分片带上语义样式。 */
export function tokenizeRow(text: string): RowToken[] {
  const parts = text.split(TOKEN_RE).filter((part) => part !== "");
  return parts.map((part) => {
    for (const token of TOKEN_STYLES) {
      if (token.pattern.test(part)) return { text: part, style: token.style };
    }
    return { text: part };
  });
}

/**
 * 一行日志 → 渲染分片。选择顺序：
 *   logrus `level=` 行 → 语义上色（ollama 等重定向到文件后没有 ANSI）
 *   → 含 ANSI 的行 → 按 SGR 分片
 *   → 其余 → 词法分片。
 */
export function rowFragments(text: string): RowToken[] {
  const logrus = colorizeLogrusLine(text);
  if (logrus) {
    return logrus.map((seg) => ({
      text: seg.text,
      style: seg.styles?.[0],
    }));
  }
  if (hasAnsi(text)) {
    return parseAnsiSegments(text).map((seg) => ({
      text: seg.text,
      style: seg.styles?.[0],
    }));
  }
  return tokenizeRow(text);
}

/** 语义样式键 → Tailwind className（Design Token 之外的少量终端色，集中在此）。 */
export const TOKEN_CLASS: Record<AnsiStyleKey, string> = {
  bold: "font-semibold",
  dim: "opacity-60",
  italic: "italic",
  underline: "underline",
  red: "text-red-400",
  green: "text-green-400",
  yellow: "text-amber-400",
  blue: "text-blue-400",
  magenta: "text-purple-400",
  cyan: "text-cyan-400",
  white: "text-gray-200",
  gray: "text-gray-500",
  "red-bright": "text-red-300 font-semibold",
  "green-bright": "text-green-300 font-semibold",
  "yellow-bright": "text-amber-300 font-semibold",
  "blue-bright": "text-blue-300",
  "magenta-bright": "text-purple-300",
  "cyan-bright": "text-cyan-300 font-semibold",
  "white-bright": "text-gray-100",
  "red-bg": "bg-red-500/20",
  "green-bg": "bg-green-500/20",
  "yellow-bg": "bg-amber-500/20",
  "blue-bg": "bg-blue-500/20",
  "magenta-bg": "bg-purple-500/20",
  "cyan-bg": "bg-cyan-500/20",
  "white-bg": "bg-white/10",
};

/* ── 行内文本选区判定（「日志一直在动、选不中想复制的行」的另一半）────── */

/** 选区判定需要的最小 DOM 视图（真实 `Selection` / `window` 都满足它）。 */
export interface SelectionLike {
  readonly rangeCount: number;
  readonly anchorNode: Node | null;
  readonly focusNode: Node | null;
  isCollapsed: boolean;
}

/**
 * 日志行的文本容器标记。视图在每个 `LogRow` 的消息元素上打这个属性，
 * 选区判定据此确认「用户框选的是日志内容」而不是页面里别的文本。
 */
export const LOG_ROW_TEXT_ATTRIBUTE = "data-log-text";

/**
 * 选区容器（消息文本）→ 它所属的日志行标记属性。
 *
 * 复制一行时浏览器给出的选区端点常常落在**文本节点**上（而不是元素），
 * 因此这里既认元素本身，也认它的父元素。
 */
export const LOG_ROW_ATTRIBUTE = "data-log-row";

/**
 * 用户当前是否正在日志正文里框选文本。
 *
 * 贴底基线已经让内容不再整体上移，但「用户正在框中途又来了新日志」仍需保护：
 * 拖动过程中浏览器会随滚动改锚点，滚动会打断框选。因此贴底前多问一句
 * 「选区是否落在日志正文里」，是「看不见的选择被刷新弄没」的最后一道保险
 * （ISSUE #262 复审）。
 *
 * 传 null（jsdom / 无选区 API 的环境）时返回 false：判据取不到就说「没有选区」，
 * 与既有行为一致，不会把贴底整体关掉。
 */
export function selectionInsideLogs(selection: SelectionLike | null): boolean {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  try {
    return [selection.anchorNode, selection.focusNode].some(
      (node) => node !== null && nodeIsLogText(node),
    );
  } catch {
    /* 极端情况下（节点已脱离文档）取父节点会抛，按「不在日志里」处理 */
    return false;
  }
}

function nodeIsLogText(node: Node): boolean {
  const element =
    node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null);
  return Boolean(
    element?.closest?.(`[${LOG_ROW_TEXT_ATTRIBUTE}]`) ??
      element?.parentElement?.closest?.(`[${LOG_ROW_TEXT_ATTRIBUTE}]`),
  );
}
