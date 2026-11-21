/**
 * 启动日志正文的**纯展示变换**（规范 17 §17.2 第①层：无 React、无副作用）。
 *
 * 落盘的每一行都由写侧加了 `YYYY-MM-DD HH:mm:ss ` 前缀（comfyui / ollama /
 * drizzle-studio 四个生产者共用同一格式，见 `formatLocalStamp`）。「隐藏时间」
 * 只是视觉偏好，不改落盘原文、也不改 controller 的 `text`（滚动跟随仍按原文
 * 判有没有新内容）—— 只对即将渲染的 ANSI 片段做一次行首剥离。
 *
 * 用 `m` 标志逐行匹配：一段 plain 片段可能跨多行，行首时间戳要在每个 `\n`
 * 之后都剥一次；时间戳只可能出现在行首（写侧固定前置），不会命中正文里
 * 偶然出现的日期字样。
 */
import type { AnsiSegment } from "~/lib/log/log-ansi";

/** 行首写入时间戳：`YYYY-MM-DD HH:mm:ss `（含尾部空格）。 */
const LINE_STAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /gm;

/**
 * 行首流前缀。写侧两种形态（`lifecycle-wait` / `lifecycle-exit`）：
 *   常规行  `[out] …` / `[err] …`
 *   崩溃尾行 `[exit][out] …` / `[exit][err] …`
 * 流标记对读者是噪声（Python 的 INFO 也走 stderr，满屏 `[err]` 像在报错，ISSUE #4699）
 * ——展示层剥掉；`[exit] ` 保留（它是「进程退出」标记，有信息量）。
 * 与时间戳同一条纪律：只动渲染片段，不改落盘原文与 controller 的 text。
 */
const EXIT_STREAM_PREFIX_RE =
  /^(?<stamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} )?\[exit\]\[(?:out|err)\] /gm;
const STREAM_PREFIX_RE = /^(?<stamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} )?\[(?:out|err)\] /gm;

export function stripLineTimestamps(segments: Array<AnsiSegment>): Array<AnsiSegment> {
  const out: Array<AnsiSegment> = [];
  for (const seg of segments) {
    const text = seg.text.replaceAll(LINE_STAMP_RE, "");
    /* 剥空后的片段不渲染：它只是时间戳，留着会多一个空 span。 */
    if (text.length === 0) {
      continue;
    }
    out.push(text === seg.text ? seg : { ...seg, text });
  }
  return out;
}

/** 行首时间戳剥掉后再剥流前缀。时间戳在行首与否两种形态都吃（「隐藏时间」开关
 *  只影响是否先走 stripLineTimestamps，流前缀剥离本身不依赖它）；
 *  崩溃尾行的 `[exit][out] ` 剥流段、保留 `[exit]` 标记（时间戳同样原样保留）。 */
export function stripStreamPrefixes(segments: Array<AnsiSegment>): Array<AnsiSegment> {
  const out: Array<AnsiSegment> = [];
  for (const seg of segments) {
    const text = seg.text
      .replaceAll(EXIT_STREAM_PREFIX_RE, (_m, stamp: string | undefined) => `${stamp ?? ""}[exit] `)
      .replaceAll(STREAM_PREFIX_RE, (_m, stamp: string | undefined) => stamp ?? "");
    if (text.length === 0) {
      continue;
    }
    out.push(text === seg.text ? seg : { ...seg, text });
  }
  return out;
}
