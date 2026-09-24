/**
 * `raw-cli-lines` 的两条契约：
 *   1. 同一行的解析结果**身份稳定** —— 下游 `memo`（弹窗的行 + JsonViewer 的树）
 *      全靠它；身份一变，每轮 1.5s 轮询都会把整棵树重建一遍。
 *   2. 两轮输出**逐字比较** —— 没新行时不发 setState，整块界面一次都不重渲染。
 */
import { describe, expect, it } from "vitest";

import { parseRawCliLine, sameRawCliLines } from "./raw-cli-lines";

describe("parseRawCliLine", () => {
  it("同一行重复解析返回同一个对象（身份稳定）", () => {
    const line = '[comfy-cli 原始] {"type":"converted","node_count":9}';

    expect(parseRawCliLine(line)).toBe(parseRawCliLine(line));
    expect(parseRawCliLine("x")).not.toBe(parseRawCliLine("y"));
  });

  it("comfy-cli 原文 JSON 行 → json 载荷（带来源标记）", () => {
    expect(parseRawCliLine('[comfy-cli 原始] {"a":1}')).toMatchObject({
      kind: "json",
      tag: "原始",
    });
  });

  it("stdout 行 → 原文（去掉前缀、保留标记）", () => {
    expect(parseRawCliLine("[comfy-cli stdout] hello")).toEqual({
      kind: "text",
      tag: "stdout",
      text: "hello",
    });
  });

  it("非 comfy-cli 原文行 → 原文且不带标记（不会被前缀规则吞掉）", () => {
    expect(parseRawCliLine("plain log line")).toEqual({
      kind: "text",
      tag: "",
      text: "plain log line",
    });
  });

  it("首字符是 { 但 JSON 非法 → 退回原文（解析失败不等于丢行）", () => {
    expect(parseRawCliLine("[comfy-cli 原始] {broken")).toEqual({
      kind: "text",
      tag: "原始",
      text: "{broken",
    });
  });
});

describe("sameRawCliLines", () => {
  it("内容相同（含都为空）→ true", () => {
    expect(sameRawCliLines([], [])).toBe(true);
    expect(sameRawCliLines(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("行数不同 / 任一行不同 → false", () => {
    expect(sameRawCliLines(["a"], ["a", "b"])).toBe(false);
    expect(sameRawCliLines(["a", "b"], ["a", "c"])).toBe(false);
  });
});
