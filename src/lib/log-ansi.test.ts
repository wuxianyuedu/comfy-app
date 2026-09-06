import { describe, expect, it } from "vitest";

import { parseAnsiSegments, stripAnsi } from "./log-ansi";

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
