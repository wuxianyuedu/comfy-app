import { describe, expect, it } from "vitest";

import {
  generationLogFileName,
  normalizeGenerationLogEntry,
  parseGenerationLogLine,
  parseGenerationLogStage,
} from "../src/lib/workshop/generation-log";

describe("工坊生成执行日志：落盘条目归一化", () => {
  it("合法条目保留字段并截断超长正文", () => {
    const entry = normalizeGenerationLogEntry({
      ts: 1_700_000_000_000,
      kind: "request",
      summary: "  向模型发送请求  ",
      detail: "x".repeat(20000),
    });
    expect(entry).not.toBeNull();
    expect(entry?.ts).toBe(1_700_000_000_000);
    expect(entry?.summary).toBe("向模型发送请求");
    expect(entry?.detail?.length).toBe(12000);
  });

  it("无摘要 / 非对象输入返回 null（坏数据不炸文件）", () => {
    expect(normalizeGenerationLogEntry({ kind: "info" })).toBeNull();
    expect(normalizeGenerationLogEntry("junk")).toBeNull();
    expect(normalizeGenerationLogEntry(null)).toBeNull();
  });

  it("缺 ts / 非法 ts 归一为当前时间；ISO 字符串可解析", () => {
    const entry = normalizeGenerationLogEntry({ kind: "error", summary: "失败" });
    expect(entry?.ts).toBeGreaterThan(0);
    const iso = normalizeGenerationLogEntry({
      ts: "2026-09-13T09:00:00.000Z",
      kind: "info",
      summary: "s",
    });
    expect(iso?.ts).toBe(Date.parse("2026-09-13T09:00:00.000Z"));
  });
});

describe("工坊生成执行日志：JSONL 解析与 stage 校验", () => {
  it("逐行解析，坏行跳过", () => {
    const lines = [
      JSON.stringify({ ts: 1, kind: "init", summary: "开始" }),
      "not-json",
      "",
      JSON.stringify({ kind: "info" }), // 无 summary → null
    ];
    const parsed = lines.map(parseGenerationLogLine);
    expect(parsed.filter(Boolean)).toHaveLength(1);
    expect(parsed[0]?.summary).toBe("开始");
  });

  it("stage 只认白名单环节", () => {
    expect(parseGenerationLogStage("character")).toBe("character");
    expect(parseGenerationLogStage("storyboard")).toBe("storyboard");
    expect(parseGenerationLogStage("portrait")).toBe("portrait");
    expect(parseGenerationLogStage("nope")).toBeNull();
    expect(parseGenerationLogStage(undefined)).toBeNull();
  });
});

describe("工坊生成执行日志：按天文件名", () => {
  it("文件名带日期、按天自然轮转", () => {
    expect(generationLogFileName(new Date(2026, 8, 13))).toBe(
      "generation-2026-09-13.log",
    );
  });
});
