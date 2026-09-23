import { describe, expect, it } from "vitest";

import {
  isCliJsonLine,
  parseCliJsonLine,
  splitCliLogLine,
} from "./log-cli-json";

describe("comfy-cli 原文日志行解析", () => {
  it("拆出 tag 与载荷（剥掉前缀）", () => {
    expect(splitCliLogLine('[comfy-cli 原始] {"a":1}')).toEqual({
      tag: "原始",
      payload: '{"a":1}',
    });
    expect(splitCliLogLine("[comfy-cli stderr] 警告文本")).toEqual({
      tag: "stderr",
      payload: "警告文本",
    });
  });

  it("不是 comfy-cli 原文行时返回 null（不吞无关的 [comfy-cli …] 文本）", () => {
    expect(splitCliLogLine("普通日志")).toBeNull();
    expect(splitCliLogLine("[comfy-cli other] x")).toBeNull();
  });

  it("isCliJsonLine 只看前缀与首字符（对象 / 数组才认）", () => {
    expect(isCliJsonLine('[comfy-cli 原始] {"a":1}')).toBe(true);
    expect(isCliJsonLine("[comfy-cli 原始] [1,2]")).toBe(true);
    expect(isCliJsonLine("[comfy-cli 原始] 不是 JSON")).toBe(false);
    /* 只看首字符，**不做 JSON.parse**（判据要便宜）：载荷不是合法 JSON 也仍算
     * 「JSON 容器」形态，面板据此给单行高度；`原始` 行在源头本就是合法 JSON
     * （见 executor-cli-stream——只有 parse 成功的对象才会走那条分支）。 */
    expect(isCliJsonLine('[comfy-cli 原始] {"a":1')).toBe(true);
    expect(isCliJsonLine("普通日志")).toBe(false);
  });

  it("parseCliJsonLine 解析对象 / 数组；非法或非容器返回 null", () => {
    expect(parseCliJsonLine('[comfy-cli 原始] {"schema":"event/1"}')).toEqual({
      tag: "原始",
      value: { schema: "event/1" },
    });
    expect(parseCliJsonLine("[comfy-cli stdout] [1,2]")).toEqual({
      tag: "stdout",
      value: [1, 2],
    });
    expect(parseCliJsonLine("[comfy-cli 原始] 42")).toBeNull();
    expect(parseCliJsonLine('[comfy-cli 原始] {"a":')).toBeNull();
    expect(parseCliJsonLine("普通日志")).toBeNull();
  });

  it("isCliJsonLine 与 parseCliJsonLine 对合法 JSON 口径一致", () => {
    const line = '[comfy-cli 原始] {"ok":true}';
    expect(isCliJsonLine(line)).toBe(true);
    expect(parseCliJsonLine(line)).not.toBeNull();
  });
});
