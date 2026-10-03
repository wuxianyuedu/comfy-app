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
import {
  colorizeLogrusLine,
  hasSgr,
  parseAnsiSegments,
  type AnsiStyleKey,
} from "~/lib/log/log-ansi";

/** 行文本里识别出的词法分片。`style` 为空 = 按级别默认色渲染。 */
export interface RowToken {
  text: string;
  /** 语义样式键（与 ANSI 样式键同一套，视图映射成 className）。 */
  style?: AnsiStyleKey;
}

/** 日志级别的徽标配色（视图与测试共用同一份表）。级别是**状态语义**，
 *  走项目语义 token（§4.11.1 / P71）：info→`--color-info`、warn→
 *  `--color-warning`、error→`--color-destructive`（与 `status-badge` 的
 *  FAILED、`alert` 的 destructive 同源，消除「log 用 rose、全局用
 *  destructive」的 error 色不一致）；debug 是中性档，走 `subtle` 系。
 *  token 内部已含深浅两态，不再写 `dark:`。 */
export const LEVEL_BADGE_STYLES: Record<LogLevel, string> = {
  debug: "border-border-strong bg-subtle text-ink-muted",
  info: "border-info/20 bg-info/15 text-info-strong",
  warn: "border-warning/20 bg-warning/15 text-warning-strong",
  error: "border-destructive/20 bg-destructive/15 text-destructive",
};

/**
 * 级别按钮**选中态**的样式（用户反馈第 1 条：「浅色主题看不到选中的是哪一项」）。
 *
 * 此前选中态只有一个 `bg-subtle`——而浅色主题下 `--color-subtle`（#f7f8fa）与
 * 行头底色 `--color-surface-1`（#f7f8fa）**是同一个值**，于是「选中」在浅色下
 * 完全不可见（深色下分别是 #141419 / #16161c，也只是勉强能看出）。
 *
 * 现在选中态由三层同时表达，任何一层单独失效都还读得出「选中的是它」：
 *   1. **底色** = 主色调淡底（`bg-primary/12`，浅深两态都由 token 推导）；
 *   2. **描边** = `ring-1 ring-primary/45`（底色被主题调近似白时描边仍在）；
 *   3. **字重** = `font-semibold`（由标签文字继承）。
 *
 * 级别色**不参与**选中判定（级别配色表照常挂在按钮上）：它表达的是「这一格
 * 是哪一类」，与「当前看的是哪一类」是两件事。
 */
export const FILTER_SELECTED_STYLES =
  "bg-primary/12 ring-1 ring-primary/45 font-semibold";

/**
 * `ToggleGroupItem` 那一档的选中样式：与上面同一套三层表达（底色 + 描边 + 字重），
 * 唯一差别是底色要加 `!`。
 *
 * 为什么要加：基元 `ui/toggle` 的选中档是 `data-pressed:bg-muted`，属性选择器的
 * 特异性高于裸 utility（`(0,2,0)` vs `(0,1,0)`），不压一层就永远轮到它生效；而
 * `bg-muted` → `--color-subtle` 在浅色主题下与行头底色 `--color-surface-1` 是同一个
 * `#f7f8fa` —— 于是「选中」又变回看不见（ISSUE #609 那条用户反馈的原样）。
 * 描边与字重不参与这场冲突（基元不在 pressed 上设 box-shadow / 字重），照常挂。
 */
export const FILTER_SELECTED_ITEM_STYLES =
  "bg-primary/12! ring-1 ring-primary/45 font-semibold";

/** 日志级别的正文配色（视图与测试共用同一份表）。级别是状态语义，走语义
 *  token（§4.11.1 / P71）：warn→`text-warning-strong`、error→
 *  `text-destructive`（与徽标同源）；info/debug 本就是 ink 系中性档。 */
export const LEVEL_TEXT_STYLES: Record<LogLevel, string> = {
  debug: "text-ink-soft",
  info: "text-ink-field",
  warn: "text-warning-strong",
  error: "text-destructive",
};

export function hasAnsi(text: string): boolean {
  /* 判据走 `~/lib/log/log-ansi` 的 `hasSgr`（规范 16 §16.2.4.58）——
   * 转义符字面量只有那个模块写，这里不再自己持一份正则。 */
  return hasSgr(text);
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

/** 语义样式键 → Tailwind className（Design Token 之外的少量终端色，集中在此）。
 *  下面 `red/green/yellow/blue/magenta/cyan` + 各自 bright 变体的 palette 字面量
 *  代表 **ANSI SGR 终端颜色身份**、不是主题状态色（§3.6.1 文档化例外），没有
 *  对应语义 token，也不应被 token 化——所以整块走 P71 的 allow 标记。 */
// p71-allow:start  ANSI SGR 终端 8 色是 §3.6.1 例外：颜色代表 terminal color identity、不是主题状态色
export const TOKEN_CLASS: Record<AnsiStyleKey, string> = {
  bold: "font-semibold",
  dim: "opacity-60",
  italic: "italic",
  underline: "underline",
  red: "text-red-600 dark:text-red-400",
  green: "text-green-600 dark:text-green-400",
  yellow: "text-amber-600 dark:text-amber-400",
  blue: "text-blue-600 dark:text-blue-400",
  magenta: "text-purple-600 dark:text-purple-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  white: "text-ink-bright",
  gray: "text-ink-muted",
  "red-bright": "text-red-700 font-semibold dark:text-red-300",
  "green-bright": "text-green-700 font-semibold dark:text-green-300",
  "yellow-bright": "text-amber-700 font-semibold dark:text-amber-300",
  "blue-bright": "text-blue-700 dark:text-blue-300",
  "magenta-bright": "text-purple-700 dark:text-purple-300",
  "cyan-bright": "text-cyan-700 font-semibold dark:text-cyan-300",
  "white-bright": "text-ink-bright",
  "red-bg": "bg-red-500/20",
  "green-bg": "bg-green-500/20",
  "yellow-bg": "bg-amber-500/20",
  "blue-bg": "bg-blue-500/20",
  "magenta-bg": "bg-purple-500/20",
  "cyan-bg": "bg-cyan-500/20",
  "white-bg": "bg-subtle",
};
// p71-allow:end

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
