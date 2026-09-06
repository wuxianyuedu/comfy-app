/* ── 启动日志 ANSI 颜色解析（纯工具层，无 React）────────────────
 * comfyui-runtime.log / drizzle-studio-runtime.log 里落的是子进程的
 * 原始输出，带 ANSI 转义序列（pip / torch / drizzle-kit 会给错误与
 * 高亮行上色）。此前日志面板统一把序列剥掉，颜色信息全丢。
 *
 * 这里把 SGR（\x1b[…m）序列解析成带样式片段，视图层直接映射成
 * className 渲染；非 SGR 的光标/清屏等控制序列仍然剥除（渲染无意义）。
 *
 * 安全性：片段内容原样返回、由 React 文本节点渲染，天然无注入面。
 */

/** 一段带样式的日志文本。text 为原文（不含转义序列）。 */
export interface AnsiSegment {
  text: string;
  /** 活动样式（前景/背景/字重等可同时生效）；空 = 默认样式 */
  styles?: AnsiStyleKey[];
}

export type AnsiStyleKey =
  | "bold"
  | "dim"
  | "italic"
  | "underline"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "red-bright"
  | "green-bright"
  | "yellow-bright"
  | "blue-bright"
  | "magenta-bright"
  | "cyan-bright"
  | "white-bright"
  | "red-bg"
  | "green-bg"
  | "yellow-bg"
  | "blue-bg"
  | "magenta-bg"
  | "cyan-bg"
  | "white-bg";

const FG: Record<number, AnsiStyleKey> = {
  30: "gray",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "white",
  90: "gray",
  91: "red-bright",
  92: "green-bright",
  93: "yellow-bright",
  94: "blue-bright",
  95: "magenta-bright",
  96: "cyan-bright",
  97: "white-bright",
};

const BG: Record<number, AnsiStyleKey> = {
  41: "red-bg",
  42: "green-bg",
  43: "yellow-bg",
  44: "blue-bg",
  45: "magenta-bg",
  46: "cyan-bg",
  47: "white-bg",
};

/** 非 SGR 的转义序列：光标移动、清屏、窗口标题等，渲染无意义直接丢弃。 */
const NON_SGR_RE =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[?[0-9;]*[A-HJKSTfhlmsu]/g;
const SGR_RE = /\x1b\[([0-9;:]*)m/g;

/** 剥掉全部 ANSI 转义序列（保留纯文本）。 */
export function stripAnsi(text: string): string {
  return text
    .replace(NON_SGR_RE, "")
    .replace(/\x1b\[[0-9;:]*m/g, "")
    .replace(/\r/g, "");
}

/**
 * 把含 ANSI SGR 序列的日志文本切成带样式片段。
 * 当前活动样式跨片段延续（与终端语义一致），\x1b[0m 复位。
 */
export function parseAnsiSegments(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let bold = false;
  let dim = false;
  let italic = false;
  let underline = false;
  let fg: AnsiStyleKey | undefined;
  let bg: AnsiStyleKey | undefined;
  let plain = "";

  const flush = () => {
    if (plain) {
      const styles = composeStyles({ bold, dim, italic, underline, fg, bg });
      segments.push(
        styles.length > 0 ? { text: plain, styles } : { text: plain },
      );
      plain = "";
    }
  };

  const re = new RegExp(SGR_RE.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    plain += text.slice(last, match.index);
    last = match.index + match[0].length;
    /* 先结算上一段（携带的是旧样式），再应用本次序列 */
    flush();
    applySgr(
      match[1] ?? "",
      (s) => {
        bold = s.bold;
        dim = s.dim;
        italic = s.italic;
        underline = s.underline;
        fg = s.fg;
        bg = s.bg;
      },
      () => ({ bold, dim, italic, underline, fg, bg }),
    );
  }
  plain += text.slice(last);

  flush();
  return segments.length > 0 ? segments : text ? [{ text }] : [];
}

/** 汇总当前活动样式：前景/背景/字重可叠加，由视图层逐个映射成 class。 */
function composeStyles(state: {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg?: AnsiStyleKey;
  bg?: AnsiStyleKey;
}): AnsiStyleKey[] {
  const styles: AnsiStyleKey[] = [];
  if (state.fg) styles.push(state.fg);
  if (state.bg) styles.push(state.bg);
  if (state.bold) styles.push("bold");
  if (state.dim) styles.push("dim");
  if (state.italic) styles.push("italic");
  if (state.underline) styles.push("underline");
  return styles;
}

interface SgrState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg?: AnsiStyleKey;
  bg?: AnsiStyleKey;
}

function applySgr(
  codes: string,
  set: (state: SgrState) => void,
  get: () => SgrState,
): void {
  const parts = codes
    .split(/[;:]/)
    .map((p) => (p === "" ? 0 : Number.parseInt(p, 10)))
    .filter((n) => Number.isFinite(n));

  /* 空参数 \x1b[m 等价 \x1b[0m */
  if (parts.length === 0 || parts.every((n) => n === 0)) {
    set({ bold: false, dim: false, italic: false, underline: false });
    return;
  }

  const next = { ...get() };
  for (const code of parts) {
    if (code === 0) {
      next.bold = false;
      next.dim = false;
      next.italic = false;
      next.underline = false;
      next.fg = undefined;
      next.bg = undefined;
    } else if (code === 1) {
      next.bold = true;
    } else if (code === 2) {
      next.dim = true;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) {
      next.italic = false;
    } else if (code === 24) {
      next.underline = false;
    } else if (code === 39) {
      next.fg = undefined;
    } else if (code === 49) {
      next.bg = undefined;
    } else if (FG[code]) {
      next.fg = FG[code];
    } else if (BG[code]) {
      next.bg = BG[code];
    }
    /* 5/8 色（38;5;n / 48;5;n）与 RGB（38;2;r;g;b）不在映射范围：
     * 跳过即可，不会误染后续文本 */
  }
  set(next);
}
