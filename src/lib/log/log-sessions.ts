/* ── 追加写日志的「会话」切分与标签（纯函数，无 IO）────────────────────
 *
 * 背景：`log/services/` 下的 runtime 日志（comfyui / drizzle-studio / ollama）
 * 都是**追加不轮转**的 —— 本次、上一次、上上一次启动的行全落在同一个文件里。
 * 设置页的「启动日志」小窗口此前只跟随文件尾部，读到的常常是「上一次启动的
 * 结尾」，也无从回看某一次启动到底输出了什么。要能按「每次启动」看，就需要
 * 一个把整份日志切成会话的判据。
 *
 * 判据只有一条，就是**会话横幅**（唯一实现见 `session-banner.server.ts` 的
 * `buildSessionBanner`）：文件的连续三行若是「分隔线 / 标题 / 分隔线」，即为
 * 一条横幅。其中 start（亮绿）是会话**起点**，end（亮黄）只标记终点、不切分
 * —— 进程退出说明可能落在 end 横幅之后，拿它切会多出一个只有一两行的伪会话。
 *
 * 纯函数：读文件归调用方（`GET /api/logs/sessions`），本模块不碰 node:fs，
 * 因此可脱离文件系统单测，也能被浏览器侧的标签格式化复用。
 */

import { stripAnsi } from "./log-ansi";

/**
 * 会话正文的保留上限（字符）。取尾部窗口：一次「保活」会话可能累积几个小时
 * 的输出，整段回传既撑爆响应也撑爆界面；而排障真正要看的是**最新那一段**。
 */
const MAX_SESSION_CHARS = 400_000;

/** 横幅分隔线：box 字符 U+2500，`buildSessionBanner` 用 72 个（这里放宽到 16+）。 */
const BANNER_BAR_RE = /^\u2500{16,}$/;

/** 会话**结束**横幅的 ANSI 亮黄（start 是亮绿，见 `session-banner.server.ts`）。 */
const BANNER_END_ANSI = "\u001b[1;33m";

/** 无横幅可依据时（横幅机制上线前写的日志）那条「会话」的标题。 */
const LEGACY_TITLE = "更早的日志（无会话标记）";

/** 横幅标题为空时的兜底文案（横幅只画出边界、标题没写内容）。 */
const BANNER_FALLBACK_TITLE = "启动会话";

/** 行内时刻（`YYYY-MM-DD HH:mm:ss` 与带 `T` 的 ISO 形态），用于给会话起可读标签。 */
const TIMESTAMP_RE =
  /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?/;

/** 会话元信息（下拉选项 + 选中项；不含正文）。 */
export interface LogSessionMeta {
  /** 会话标识：`<起点行号>`；无横幅的早期内容为 `legacy`。 */
  id: string;
  /** 横幅标题（已去 ANSI 与首尾空白）。 */
  title: string;
  /** 会话内第一条带时刻的行的时刻（毫秒）；读不到为 null。 */
  startedAt: number | null;
}

/** 会话切分结果：元信息 + 正文切片。 */
export interface LogSessionChunk extends LogSessionMeta {
  /** 会话起点行号（含）。 */
  startLine: number;
  /** 会话终点行号（不含）。 */
  endLine: number;
  /** 会话正文；超过上限时是**尾部窗口**（已掐头对齐到行边界）。 */
  text: string;
  /** 正文因超上限被截断（界面据此提示「只看得到最近一段」）。 */
  truncated: boolean;
}

/**
 * `GET /api/logs/sessions` 的响应体。
 *
 * 定义在这里而不是端点或客户端任一侧：它是**两端共用的契约**，写在一边就会
 * 出现「服务端改了字段、客户端还在按旧字段读」的静默漂移。
 */
export interface LogSessionsPayload {
  /** 可选会话（新→旧按文件行序，最后一项为最新），已按上限裁剪。 */
  sessions: LogSessionMeta[];
  /** 本次返回的正文属于哪一项；没有可用会话时为 null。 */
  selectedId: string | null;
  /** 选中会话的正文（可能被 `MAX_SESSION_CHARS` 截断）。 */
  content: string;
  /** 正文被截断（界面据此提示只见最近一段）。 */
  truncated: boolean;
  /** 文件太大，服务端只扫了尾部窗口 —— 更早的启动不在列表里。 */
  windowed: boolean;
  /** 文件当前字节数（面板页脚展示 / 排障用）。 */
  size: number;
}

/** 该行是不是横幅的分隔线（剥掉 ANSI 后只剩 box 字符）。 */
function isBannerBar(line: string): boolean {
  return BANNER_BAR_RE.test(stripAnsi(line).trim());
}

/** 取文本里第一条时刻（会话的「开始时间」）；读不到返回 null。 */
function firstTimestampMs(text: string): number | null {
  const matched = TIMESTAMP_RE.exec(text);
  if (!matched) return null;
  const [, year, month, day, hour, minute, second, fraction] = matched;
  const ms = fraction ? Number.parseInt(fraction.padEnd(3, "0"), 10) : 0;
  const value = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    ms,
  ).getTime();
  return Number.isFinite(value) ? value : null;
}

/** 毫秒 → `HH:mm:ss`（本地时区；手写格式化，避免 locale 影响断言）。 */
function clockOf(tsMs: number): string {
  const date = new Date(tsMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 会话 → 下拉选项文案：`10:27:51 · ▶ ComfyUI 启动会话`。
 *
 * 时刻在前是必要的：同一通道每次启动的横幅标题逐字相同，**只有时刻能区分**它们。
 */
export function formatSessionLabel(session: LogSessionMeta): string {
  const title = session.title.trim();
  if (session.startedAt === null) return title || BANNER_FALLBACK_TITLE;
  const clock = clockOf(session.startedAt);
  return title ? `${clock} · ${title}` : clock;
}

/** 按行区间切出一个会话（顺带做正文截断与时刻提取）。 */
function buildChunk(
  lines: string[],
  id: string,
  startLine: number,
  endLine: number,
  title: string | null,
  maxChars: number,
): LogSessionChunk {
  const raw = lines.slice(startLine, endLine).join("\n").replace(/\s+$/, "");
  const truncated = raw.length > maxChars;
  let text = raw;
  if (truncated) {
    /* 掐头对齐到行边界：尾部窗口的一半行会在界面上显示成一条乱码行。 */
    const tail = raw.slice(raw.length - maxChars);
    const firstBreak = tail.indexOf("\n");
    text = firstBreak >= 0 ? tail.slice(firstBreak + 1) : tail;
  }
  return {
    id,
    title: title ?? LEGACY_TITLE,
    startedAt: firstTimestampMs(raw),
    startLine,
    endLine,
    text,
    truncated,
  };
}

/**
 * 把一份追加写日志切成「每次启动」的会话（新→旧按行序，最后一项是最新一次）。
 *
 * 只按 start 横幅切分；第一条 start 横幅之前的内容（横幅机制上线前写的行、
 * 或服务端尾窗截断后剩下的半段）单独作为一项，标题为
 * `更早的日志（无会话标记）`——它同样要能看，不能因为「没有横幅」被丢掉。
 *
 * 整份日志里一条横幅都没有时，返回**一个**覆盖全文的会话（标题同上）：
 * 调用方据此退化成「只有一次启动」的展示，而不是空列表。
 */
export function parseLogSessions(
  text: string,
  maxChars: number = MAX_SESSION_CHARS,
): LogSessionChunk[] {
  const lines = text.split("\n");
  const starts: number[] = [];
  for (let i = 0; i + 2 < lines.length; i += 1) {
    if (!isBannerBar(lines[i]!) || !isBannerBar(lines[i + 2]!)) continue;
    /* end 横幅只标记终点：其后还可能有退出说明，切了会多出伪会话。 */
    if (lines[i]!.includes(BANNER_END_ANSI)) continue;
    starts.push(i);
  }

  const chunks: LogSessionChunk[] = [];
  const firstStart = starts.length > 0 ? starts[0]! : lines.length;
  if (lines.slice(0, firstStart).some((line) => line.trim() !== "")) {
    chunks.push(buildChunk(lines, "legacy", 0, firstStart, null, maxChars));
  }
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]! : lines.length;
    const title = stripAnsi(lines[start + 1] ?? "").trim();
    chunks.push(
      buildChunk(
        lines,
        String(start),
        start,
        end,
        title || BANNER_FALLBACK_TITLE,
        maxChars,
      ),
    );
  });
  return chunks;
}
