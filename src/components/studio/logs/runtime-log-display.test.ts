/**
 * 时间戳显隐变换的行为契约（ISSUE #4631）。「隐藏时间」只动渲染片段，
 * 不改落盘原文 / controller 的 text；这里钉住它逐行、跨 ANSI 片段都剥得对。
 */
import { describe, expect, it } from "vitest";

import { stripLineTimestamps, stripStreamPrefixes } from "./runtime-log-display";

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

describe("stripStreamPrefixes", () => {
  it("剥掉常规行的 [out] / [err] 前缀，正文与级别字样保留", () => {
    const segments = [{ text: "[err] [INFO] first\n[out] second\n[err] [WARNING] third\n" }];
    expect(stripStreamPrefixes(segments)).toEqual([
      { text: "[INFO] first\nsecond\n[WARNING] third\n" },
    ]);
  });

  it("崩溃尾行剥流段、保留 [exit] 标记（写侧形态 [exit][out] 无空格）", () => {
    const segments = [
      {
        text: "[exit][out] main window Finished\n[exit][err] Traceback (most recent call last)\n[exit] 非零退出（exit code 1）\n",
      },
    ];
    expect(stripStreamPrefixes(segments)).toEqual([
      {
        text: "[exit] main window Finished\n[exit] Traceback (most recent call last)\n[exit] 非零退出（exit code 1）\n",
      },
    ]);
  });

  it("先剥时间戳再剥流前缀：两步组合与写侧顺序一致", () => {
    const segments = [
      { text: "2026-11-17 16:28:42 [err] [INFO] boot\n2026-11-17 16:28:43 [out] ready" },
    ];
    expect(stripStreamPrefixes(stripLineTimestamps(segments))).toEqual([
      { text: "[INFO] boot\nready" },
    ]);
  });

  it("时间戳保留时（showTime=true）同样只剥流前缀，时间戳原样保留", () => {
    const segments = [
      { text: "2026-11-17 16:28:42 [err] [INFO] boot\n2026-11-17 16:28:43 [out] ready\n" },
    ];
    expect(stripStreamPrefixes(segments)).toEqual([
      { text: "2026-11-17 16:28:42 [INFO] boot\n2026-11-17 16:28:43 ready\n" },
    ]);
  });

  it("崩溃尾行带时间戳时：剥流段、保留时间戳与 [exit] 标记", () => {
    const segments = [
      { text: "2026-11-17 16:28:59 [exit][err] Traceback (most recent call last)\n" },
    ];
    expect(stripStreamPrefixes(segments)).toEqual([
      { text: "2026-11-17 16:28:59 [exit] Traceback (most recent call last)\n" },
    ]);
  });

  it("跨 ANSI 片段：时间戳片段与流前缀片段各自剥空后都不渲染", () => {
    const segments = [
      { text: "2026-11-17 16:28:42 " },
      { text: "[err] ", styles: ["dim" as const] },
      { text: "[INFO] boot\n2026-11-17 16:28:43 " },
      { text: "[out] ready", styles: ["green" as const] },
    ];
    expect(stripStreamPrefixes(stripLineTimestamps(segments))).toEqual([
      { text: "[INFO] boot\n" },
      { text: "ready", styles: ["green"] },
    ]);
  });

  it("正文里行中的 [out]/[err] 字样（非行首前缀）原样保留", () => {
    const segments = [{ text: "[INFO] tag=[out] demo [err] sample\n" }];
    expect(stripStreamPrefixes(segments)).toEqual([
      { text: "[INFO] tag=[out] demo [err] sample\n" },
    ]);
  });

  it("无前缀片段同一引用通过；纯前缀片段剥空后不渲染", () => {
    const plain = { text: "[spawn] pid=1\n" };
    const onlyPrefix = { text: "[err] " };
    const out = stripStreamPrefixes([plain, onlyPrefix]);
    expect(out[0]).toBe(plain);
    expect(out).toHaveLength(1);
  });
});
