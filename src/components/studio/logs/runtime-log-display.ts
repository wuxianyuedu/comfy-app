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
