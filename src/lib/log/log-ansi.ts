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

/* ── 「剥掉 SGR / 问有没有 SGR」的唯一出口 ───────────────────────────
 *
 * 按形态扫出来的账（规范 16 §16.2.4.58）：全库 **4 处**各写一遍
 * `\x1b\[[0-9;:]*m` 这个形态，而它们**判据各不相同**：
 *
 *   · 本模块的 `SGR_RE` —— 转义符**必须在**（`\x1b[`）；
 *   · `logs/log-record` 的 `stripSgr` —— 先剥完整形态、再剥**残缺颜色码**
 *     （只剩 `[90m` / `[0m`，转义符在管道里丢了）；少剥这一层会在面板上
 *     显示成 `[[OK]【[90m[OK[0m] …`（这条差异此前**没有一处写下来**，
 *     所以「哪个才是对的」只能靠比对两处实现去猜）；
 *   · `logs/log-row-style` 的 `hasAnsi` —— 只**判有没有**，不动文本。
 *
 * 收口后**转义符字面量只有本模块写**：其余三处都从这里取。形态的判据
 * （要不要连残缺码一起剥）经 `includePartial` 显式表达，不再靠「哪一处
 * 抄得更全」。
 */

/** 完整 SGR 序列（含转义符）。带 `g`：`replace` 要一次剥干净。 */
const SGR_RE = /\x1b\[([0-9;:]*)m/g;

/**
 * 残缺颜色码：转义符丢失、只剩 `[90m` / `[0m` 这类尾巴。
 *
 * 它**只**在「读完文本之后再剥一次」的形态下有意义（管道 / 日志文件里
 * 子进程的转义符可能被吃掉），所以不用 `g` 常量复用，单独给一条：
 * 判据是「方括号紧跟数字/分号、以 `m` 收尾」，与 markdown / 正则源码
 * 里的普通方括号不冲突（后者中间不会是纯数字）。
 */
const PARTIAL_SGR_RE = /\[[0-9;:]*m/g;

/** 「有没有 SGR（完整形态）」—— 只判不改。`logs/log-row-style` 的这个判据
 *  用来决定「按 ANSI 上色还是走词法上色」，不动文本。 */
export function hasSgr(text: string): boolean {
  /* `lastIndex` 是 `g` 标志的状态：每次判前复位，避免同一正则跨调用漂移
   *（本判据此前在 `log-row-style` 里是独立的一份，没有这个坑的机会）。 */
  SGR_RE.lastIndex = 0;
  return SGR_RE.test(text);
}

/**
 * 剥掉 SGR 颜色码。
 *
 * `includePartial`（默认 `true`）决定要不要连**残缺颜色码**一起剥 ——
 * 这是本条账里唯一真正的分歧，此前两处实现各判各的。默认取「剥得更全」
 * 的那一档：留在正文里的 `[90m` 会原样显示给用户，比多剥一点更糟。
 * 只想要「严格 SGR」时显式写 `false`。
 */
export function stripSgr(text: string, { includePartial = true } = {}): string {
  const withoutFull = text.replace(/\x1b\[[0-9;:]*m/g, "");
  return includePartial ? withoutFull.replace(PARTIAL_SGR_RE, "") : withoutFull;
}

/* ── 会话横幅的色板曾在这里（ISSUE #1326 之后随写侧一并移除）─────────
 *
 * `BANNER_ANSI`（start 亮绿 / end 亮黄）此前供两个消费方：写侧
 * `session-banner.server.ts` 画横幅、读侧按颜色判「这一行是不是结束横幅」。
 * 四份 runtime 日志改成**一次启动一份文件**之后，边界由文件名承担 —— 写侧与
 * 读侧同时失去消费方，色板随之撤掉（`log()` 里那些给终端看的颜色仍走 SGR，
 * 与本模块的 `stripSgr` / `stripAnsi` 无关）。
 */
/** 剥掉全部 ANSI 转义序列（含非 SGR 的光标 / 清屏序列），保留纯文本。 */
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

  /* 直接复用模块级的 `SGR_RE`（它本身就带 `g`），并先归零 `lastIndex`。
   * 原先是 `new RegExp(SGR_RE.source, "g")` —— 本函数对**每一行**日志调用
   * 一次，等于每行编译一次正则、再丢一个临时对象；日志面板一屏数百行且是
   * 同步计算，这笔开销会直接压在渲染路径上。带 `g` 的实例要显式归零
   * lastIndex（记录的是上次匹配停在哪），与本模块其它使用点同款写法。 */
  const re = SGR_RE;
  re.lastIndex = 0;
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

/* ── Ollama（logrus 纯文本）行的语义上色 ───────────────────────────
 * ollama-runtime.log 里是 logrus 的文本格式：重定向到文件（非 TTY）时
 * logrus 不输出任何 ANSI 码，面板按上面的 SGR 解析渲染出来就是一色灰。
 * 这里按行内 level= 字段语义上色：时间戳与写入前缀调暗，level 着
 * INFO 绿 / WARN 黄 / ERROR、FATAL 红 / DEBUG、TRACE 灰。 */

const LOGRUS_LEVEL_RE = /\blevel=(INFO|WARN|ERROR|FATAL|DEBUG|TRACE)\b/;
const LOGRUS_LEVEL_STYLE: Record<string, AnsiStyleKey> = {
  INFO: "green",
  WARN: "yellow",
  ERROR: "red",
  FATAL: "red",
  DEBUG: "gray",
  TRACE: "gray",
};
/** 行首的 runtime 写入前缀（[时间戳] [流]）与 logrus time=… 字段，统一调暗 */
const LOGRUS_DIM_PREFIX_RE = /^(\[[^\]]*\]\s*)*(time=\S+\s+)?/;

/** 单行 logrus 文本 → 带样式片段；行内没有 level= 字段时返回 null（交回 ANSI 解析）。 */
export function colorizeLogrusLine(line: string): AnsiSegment[] | null {
  const matched = LOGRUS_LEVEL_RE.exec(line);
  if (!matched) return null;
  const levelToken = `level=${matched[1]}`;
  const levelIdx = line.indexOf(levelToken);
  const head = line.slice(0, levelIdx);
  const segments: AnsiSegment[] = [];
  const dimLen = LOGRUS_DIM_PREFIX_RE.exec(head)?.[0].length ?? 0;
  if (dimLen > 0)
    segments.push({ text: head.slice(0, dimLen), styles: ["dim"] });
  if (head.length > dimLen) segments.push({ text: head.slice(dimLen) });
  segments.push({
    text: levelToken,
    styles: [LOGRUS_LEVEL_STYLE[matched[1] ?? "INFO"] ?? "green"],
  });
  const tail = line.slice(levelIdx + levelToken.length);
  if (tail) segments.push({ text: tail });
  return segments;
}

/** Ollama 启动日志整段文本 → 片段：含 level= 的行走 logrus 语义上色，
 *  其余行（spawn 参数、空行等）走原 ANSI 解析。 */
export function parseOllamaLogText(text: string): AnsiSegment[] {
  const lines = text.split("\n");
  const segments: AnsiSegment[] = [];
  lines.forEach((line, index) => {
    const colored = colorizeLogrusLine(line);
    segments.push(...(colored ?? parseAnsiSegments(line)));
    if (index < lines.length - 1) segments.push({ text: "\n" });
  });
  return segments;
}
