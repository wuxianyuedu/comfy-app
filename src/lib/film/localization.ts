/**
 * 一集多语字幕派生（ISSUE #5280，借鉴 OpenMontage 的 Localization & Dub 管线）：
 * 以同源 SRT 为唯一文本源，用**人工校对过的译文表**逐条替换，产出目标语言字幕。
 * 不调用外部翻译 API、不猜译文——没翻译的条目原样保留并标记，可回读可校对。
 * 纯函数，不碰 IO/DB/时钟。
 */
import { asRecord } from "~/lib/is-record";
import { compareText, uniqueBy } from "~/lib/ordered-set";

export type LocalizationEntry = {
  audioPath: string;
  language: string;
  subtitlePath: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** 外来 delivery.localizations → 受控条目；脏项跳过，重复语言取最后一条。 */
export function localizationsOf(raw: unknown): Array<LocalizationEntry> {
  const rec = asRecord(raw);
  if (rec === null || !Array.isArray(rec.localizations)) {
    return [];
  }
  const entries: Array<LocalizationEntry> = [];
  for (const item of rec.localizations) {
    const entry = asRecord(item);
    const language = text(entry?.language);
    const subtitlePath = text(entry?.subtitlePath);
    if (language !== null && subtitlePath !== null) {
      entries.push({
        audioPath: text(entry?.audioPath) ?? "",
        language,
        subtitlePath,
      });
    }
  }
  /* 去重与排序走统一出口（P51）：倒序后 uniqueBy 保留首次 ⇒ 等价于「重复语言取最后一条」。 */
  const latestFirst = uniqueBy([...entries].reverse(), (entry) => entry.language);
  return latestFirst.sort((a, b) => compareText(a.language, b.language));
}

/** 译文表只认字面量对象里的字符串值；非字符串项忽略。 */
export function translationsOf(raw: unknown): Record<string, string> {
  const rec = asRecord(raw);
  if (rec === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [source, target] of Object.entries(rec)) {
    const value = text(target);
    if (value !== null) {
      result[source] = value;
    }
  }
  return result;
}

/**
 * 派生目标语言 SRT：时间轴逐字不动，只替换序号块里的文本行（同一条字幕的第一行）。
 * 译文缺失时保留原文并在行尾加 `[未翻译:<language>]` 标记，让人一眼看到需要校对。
 */
export function buildLocalizedSrt(
  srt: string,
  translations: Record<string, string>,
  language: string,
): string {
  if (language === "" || !srt.includes("-->")) {
    return srt;
  }
  const blocks = srt.split(/\r?\n\r?\n/).filter((block) => block.trim() !== "");
  const localized: Array<string> = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const marker = lines.findIndex((line) => line.includes("-->"));
    if (marker === -1 || marker + 1 >= lines.length) {
      localized.push(block);
      continue;
    }
    const original = lines[marker + 1] ?? "";
    const translated = translations[original];
    const next = [...lines];
    next[marker + 1] = translated ?? `${original} [未翻译:${language}]`;
    localized.push(next.join("\n"));
  }
  return localized.join("\n\n") + (localized.length > 0 ? "\n" : "");
}
