import { describe, expect, it } from "vitest";

import { parseAnsiSegments, parseOllamaLogText, stripAnsi } from "./log-ansi";

describe("stripAnsi", () => {
  it("剥掉 SGR 颜色序列与 \\r，保留正文", () => {
    expect(stripAnsi("\x1b[31merror\x1b[0m\r\n")).toBe("error\n");
  });

  it("剥掉光标/清屏等非 SGR 序列", () => {
    expect(stripAnsi("\x1b[2K\rloading...\x1b[1A")).toBe("loading...");
  });
});

describe("parseAnsiSegments", () => {
  it("无序列文本原样返回单片段", () => {
    expect(parseAnsiSegments("plain log line")).toEqual([
      { text: "plain log line" },
    ]);
  });

  it("颜色序列解析为带样式片段", () => {
    const segs = parseAnsiSegments("\x1b[31mERROR\x1b[0m done");
    expect(segs).toEqual([
      { text: "ERROR", styles: ["red"] },
      { text: " done" },
    ]);
  });

  it("样式跨片段延续，0m 复位", () => {
    const segs = parseAnsiSegments("\x1b[32mok\x1b[36mcyan\x1b[0m|");
    expect(segs).toEqual([
      { text: "ok", styles: ["green"] },
      { text: "cyan", styles: ["cyan"] },
      { text: "|" },
    ]);
  });

  it("bold/亮色/背景色映射", () => {
    const segs = parseAnsiSegments("\x1b[1mheavy\x1b[91mhot\x1b[41m bg\x1b[0m");
    /* bold 跨片段延续，直到 \x1b[0m 复位 */
    expect(segs.map((s) => s.styles)).toEqual([
      ["bold"],
      ["red-bright", "bold"],
      ["red-bright", "red-bg", "bold"],
    ]);
  });

  it("22/39/49 分别复位 bold、前景、背景", () => {
    const segs = parseAnsiSegments("\x1b[1;31mX\x1b[22mY\x1b[39mZ");
    /* 22 只复位 bold，39 才复位前景色 */
    expect(segs.map((s) => s.styles)).toEqual([
      ["red", "bold"],
      ["red"],
      undefined,
    ]);
  });

  it("38;5;n / 38;2;r;g;b 不误染后续文本", () => {
    const segs = parseAnsiSegments("\x1b[38;5;208mhi\x1b[0m|tail");
    expect(segs.every((s) => !s.styles?.includes("red"))).toBe(true);
    expect(segs.at(-1)).toEqual({ text: "|tail" });
  });

  it("空参数 \\x1b[m 等价复位", () => {
    const segs = parseAnsiSegments("\x1b[31ma\x1b[mb");
    expect(segs).toEqual([{ text: "a", styles: ["red"] }, { text: "b" }]);
  });

  it("空文本返回空数组", () => {
    expect(parseAnsiSegments("")).toEqual([]);
  });
});

describe("parseOllamaLogText（logrus 纯文本语义上色）", () => {
  it("level=INFO 行：时间戳前缀调暗、level 绿色、正文默认", () => {
    const segments = parseOllamaLogText(
      '[2026-09-06 14:27:22] [err] time=2026-09-06T14:27:22+08:00 level=INFO source=routes.go:2008 msg="Listening on 127.0.0.1:11434"',
    );
    const dim = segments.find((s) => s.styles?.includes("dim"));
    expect(dim?.text).toContain("[2026-09-06 14:27:22]");
    const green = segments.find((s) => s.styles?.includes("green"));
    expect(green?.text).toBe("level=INFO");
    expect(segments.some((s) => s.text.includes("Listening on"))).toBe(true);
  });

  it("level=ERROR 行标红；无 level= 的行走原样解析", () => {
    const segments = parseOllamaLogText(
      '[err] level=ERROR msg="boom"\nplain line without level',
    );
    expect(segments.find((s) => s.styles?.includes("red"))?.text).toBe(
      "level=ERROR",
    );
    expect(segments.some((s) => s.text.includes("plain line"))).toBe(true);
  });

  it("level=WARN 黄色；行间保留换行", () => {
    const segments = parseOllamaLogText(
      'level=WARN msg="a"\nlevel=WARN msg="b"',
    );
    expect(segments.filter((s) => s.styles?.includes("yellow"))).toHaveLength(
      2,
    );
    expect(segments.filter((s) => s.text === "\n")).toHaveLength(1);
  });
});
