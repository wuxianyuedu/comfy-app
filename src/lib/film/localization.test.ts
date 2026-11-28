/**
 * 一集多语字幕派生（ISSUE #5280）：交付清单里的语版条目、译文表收窄与同源 SRT 替换的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import { buildLocalizedSrt, localizationsOf, translationsOf } from "./localization";

const SRT =
  "1\n00:00:00,000 --> 00:00:02,000\n你好\n\n" + "2\n00:00:02,000 --> 00:00:04,000\n再见\n";

describe("localizationsOf", () => {
  it("只收有 language/subtitlePath 的条目，重复语言取最后一条", () => {
    const result = localizationsOf({
      localizations: [
        { audioPath: "a.mp3", language: "en", subtitlePath: "en.srt" },
        { language: "en", subtitlePath: "en-final.srt" },
        { language: "ja" },
        42,
      ],
    });
    expect(result).toEqual([{ audioPath: "", language: "en", subtitlePath: "en-final.srt" }]);
    expect(localizationsOf(null)).toEqual([]);
  });
});

describe("translationsOf", () => {
  it("只收字符串译文，脏值忽略", () => {
    expect(translationsOf({ 你好: "Hello", 再见: 42, 空: "" })).toEqual({ 你好: "Hello" });
    expect(translationsOf("x")).toEqual({});
  });
});

describe("buildLocalizedSrt", () => {
  it("时间轴不动、命中译文替换文本", () => {
    const srt = buildLocalizedSrt(SRT, { 你好: "Hello", 再见: "Bye" }, "en");
    expect(srt).toContain("00:00:00,000 --> 00:00:02,000\nHello");
    expect(srt).toContain("00:00:02,000 --> 00:00:04,000\nBye");
  });

  it("未翻译条目保留原文并带可行动标记", () => {
    const srt = buildLocalizedSrt(SRT, { 你好: "Hello" }, "en");
    expect(srt).toContain("再见 [未翻译:en]");
  });

  it("空语言或非 SRT 输入原样返回", () => {
    expect(buildLocalizedSrt(SRT, {}, "")).toBe(SRT);
    expect(buildLocalizedSrt("纯文本", {}, "en")).toBe("纯文本");
  });
});
