import { describe, it, expect } from "vitest";
import {
  makeExtractLog,
  emptyExtractLog,
  formatRequestMessages,
  type ExtractLogEntry,
} from "./extraction-log";

describe("extraction-log 纯函数", () => {
  it("emptyExtractLog 返回空数组", () => {
    expect(emptyExtractLog()).toEqual([]);
  });

  it("makeExtractLog 生成带时间戳与类型的结构化条目", () => {
    const entry = makeExtractLog("init", "开始提取角色");
    expect(entry.kind).toBe("init");
    expect(entry.summary).toBe("开始提取角色");
    expect(entry.detail).toBeUndefined();
    // ts 是 ISO 字符串
    expect(Number.isNaN(new Date(entry.ts).getTime())).toBe(false);
  });

  it("formatRequestMessages 按 role 分段展示并支持超长截断", () => {
    const messages = [
      { role: "system" as const, content: "你是分镜师" },
      { role: "user" as const, content: "剧本全文:\n场景1 小满出门" },
    ];
    const text = formatRequestMessages(messages);
    expect(text).toContain("── system ──");
    expect(text).toContain("你是分镜师");
    expect(text).toContain("── user ──");
    expect(text).toContain("场景1 小满出门");

    // 超长内容截断
    const longContent = "x".repeat(6000);
    const truncated = formatRequestMessages([
      { role: "user" as const, content: longContent },
    ]);
    expect(truncated).toContain("已截断");
    expect(truncated.length).toBeLessThan(5000);
  });

  it("ExtractLogEntry 结构可被消费者直接构造（无运行时依赖）", () => {
    const manual: ExtractLogEntry = {
      ts: new Date().toISOString(),
      kind: "result",
      summary: "已提取 3 个角色",
      detail: "…",
    };
    expect(manual.kind).toBe("result");
    expect(manual.summary).toBe("已提取 3 个角色");
  });
});
