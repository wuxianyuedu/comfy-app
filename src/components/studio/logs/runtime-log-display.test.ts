/**
 * 时间戳显隐变换的行为契约（ISSUE #4631）。「隐藏时间」只动渲染片段，
 * 不改落盘原文 / controller 的 text；这里钉住它逐行、跨 ANSI 片段都剥得对。
 */
import { describe, expect, it } from "vitest";

import { stripLineTimestamps } from "./runtime-log-display";

describe("stripLineTimestamps", () => {
  it("剥掉每行行首的 YYYY-MM-DD HH:mm:ss 前缀", () => {
    const segments = [
      { text: "2026-11-17 16:28:42 [err] [INFO] first\n2026-11-17 16:28:43 [out] second" },
    ];
    expect(stripLineTimestamps(segments)).toEqual([{ text: "[err] [INFO] first\n[out] second" }]);
  });

  it("跨 ANSI 片段：时间戳所在片段剥空后不渲染，样式片段原样保留", () => {
    const segments = [
      { text: "2026-11-17 16:28:42 " },
      { text: "[err] ", styles: ["dim" as const] },
      { text: "[INFO] boot\n2026-11-17 16:28:43 " },
      { text: "[out] ready", styles: ["green" as const] },
    ];
    expect(stripLineTimestamps(segments)).toEqual([
      { text: "[err] ", styles: ["dim"] },
      { text: "[INFO] boot\n" },
      { text: "[out] ready", styles: ["green"] },
    ]);
  });

  it("正文里的日期字样（非行首写入前缀）原样保留", () => {
    const segments = [{ text: "2026-11-17 16:28:42 [info] path=2026-11-17 00:00:00 snapshot" }];
    expect(stripLineTimestamps(segments)).toEqual([
      { text: "[info] path=2026-11-17 00:00:00 snapshot" },
    ]);
  });

  it("无时间戳的片段不改变（同一引用），会话横幅与空行安全通过", () => {
    const banner = { text: "▶ ComfyUI 启动会话" };
    const blank = { text: "\n" };
    const out = stripLineTimestamps([banner, blank]);
    expect(out[0]).toBe(banner);
    expect(out[1]).toBe(blank);
  });
});
