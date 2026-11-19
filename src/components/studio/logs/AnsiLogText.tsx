"use client";

/**
 * 启动日志正文的 ANSI 着色渲染（落盘的是子进程原始输出，含 SGR 颜色序列）。它是「样式键 → class」
 * 的纯映射；此前嵌在设置页展示原语里，导致跨屏共用的 `RuntimeLogBox` 反向依赖设置页模块。
 * 未映射的样式键回退默认色：新增键不会渲染成透明文本。
 */
import type { AnsiSegment, AnsiStyleKey } from "~/lib/log/log-ansi";

/* 表内 red/green/yellow/blue/magenta/cyan + 各自 bright 变体 + bg 变体的
 * palette 字面量代表 **ANSI SGR 终端颜色身份**（terminal color identity）、
 * 不是主题状态色——与 log-row-style.ts 的 TOKEN_CLASS 同一族。§3.6.1
 * 文档化例外，走 P71 `// p71-allow` 例外块。 */
// p71-allow:start  ANSI SGR 终端 8 色 + bright/bg 变体——§3.6.1 例外：颜色代表 terminal color identity、不是主题状态色
const ANSI_STYLE_CLASS: Record<AnsiStyleKey, string> = {
  bold: "font-bold",
  dim: "opacity-60",
  italic: "italic",
  underline: "underline",
  red: "text-red-600 dark:text-red-400",
  green: "text-green-600 dark:text-green-400",
  yellow: "text-yellow-600 dark:text-yellow-300",
  blue: "text-blue-600 dark:text-blue-400",
  magenta: "text-fuchsia-600 dark:text-fuchsia-400",
  cyan: "text-cyan-700 dark:text-cyan-300",
  white: "text-ink-bright",
  gray: "text-ink-muted",
  "red-bright": "text-red-700 dark:text-red-300",
  "green-bright": "text-green-700 dark:text-green-300",
  "yellow-bright": "text-yellow-700 dark:text-yellow-200",
  "blue-bright": "text-blue-700 dark:text-blue-300",
  "magenta-bright": "text-fuchsia-700 dark:text-fuchsia-300",
  "cyan-bright": "text-cyan-800 dark:text-cyan-200",
  "white-bright": "text-ink-bright",
  "red-bg": "bg-red-500/15 dark:bg-red-900/60",
  "green-bg": "bg-green-500/15 dark:bg-green-900/60",
  "yellow-bg": "bg-yellow-500/15 dark:bg-yellow-800/60",
  "blue-bg": "bg-blue-500/15 dark:bg-blue-900/60",
  "magenta-bg": "bg-fuchsia-500/15 dark:bg-fuchsia-900/60",
  "cyan-bg": "bg-cyan-500/15 dark:bg-cyan-900/60",
  "white-bg": "bg-subtle",
};
// p71-allow:end

export function AnsiLogText({ segments }: { segments: Array<AnsiSegment> }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.styles && seg.styles.length > 0 ? (
          <span
            className={seg.styles
              .map((style) => ANSI_STYLE_CLASS[style])
              .filter(Boolean)
              .join(" ")}
            key={i}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
