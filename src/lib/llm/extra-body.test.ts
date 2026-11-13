import { describe, expect, it } from "vitest";

import { isExtraBodyJsonObject, parseExtraBodyObject } from "./extra-body";

describe("isExtraBodyJsonObject（写入侧判据）", () => {
  it("空串 / 纯空白 = 合法（未配置）", () => {
    expect(isExtraBodyJsonObject("")).toBe(true);
    expect(isExtraBodyJsonObject("   ")).toBe(true);
    expect(isExtraBodyJsonObject("\n\t\n")).toBe(true);
  });

  it("顶层是 JSON 对象 → 合法", () => {
    expect(isExtraBodyJsonObject('{"response_format":{"type":"json_object"}}')).toBe(true);
    expect(isExtraBodyJsonObject('{"extra_body":{"response_format":{"type":"json_object"}}}')).toBe(
      true,
    );
    expect(isExtraBodyJsonObject("{}")).toBe(true);
  });

  it("顶层不是对象（数组 / 标量）→ 非法", () => {
    expect(isExtraBodyJsonObject("[1,2]")).toBe(false);
    expect(isExtraBodyJsonObject('"a string"')).toBe(false);
    expect(isExtraBodyJsonObject("42")).toBe(false);
    expect(isExtraBodyJsonObject("null")).toBe(false);
    expect(isExtraBodyJsonObject("true")).toBe(false);
  });

  it("非法 JSON → 非法", () => {
    expect(isExtraBodyJsonObject("{")).toBe(false);
    expect(isExtraBodyJsonObject("{response_format: 1}")).toBe(false);
    expect(isExtraBodyJsonObject("{,}")).toBe(false);
  });
});

describe("parseExtraBodyObject（读侧判据）", () => {
  it("空串 / 纯空白 / 非 string 输入 → null（不发送）", () => {
    expect(parseExtraBodyObject("")).toBeNull();
    expect(parseExtraBodyObject("   ")).toBeNull();
    expect(parseExtraBodyObject(null)).toBeNull();
    expect(parseExtraBodyObject(undefined)).toBeNull();
    expect(parseExtraBodyObject(7)).toBeNull();
    expect(parseExtraBodyObject({ a: 1 })).toBeNull();
  });

  it("顶层是 JSON 对象 → 原样返回", () => {
    expect(parseExtraBodyObject('{"response_format":{"type":"json_object"}}')).toEqual({
      response_format: { type: "json_object" },
    });
    expect(parseExtraBodyObject('{"extra_body":{"a":1},"metadata":{"task":"t1"}}')).toEqual({
      extra_body: { a: 1 },
      metadata: { task: "t1" },
    });
  });

  it("顶层不是对象 / 非法 JSON → null（不发半个字段）", () => {
    expect(parseExtraBodyObject("[1]")).toBeNull();
    expect(parseExtraBodyObject("null")).toBeNull();
    expect(parseExtraBodyObject("{")).toBeNull();
    expect(parseExtraBodyObject("not json")).toBeNull();
  });

  it("保存侧与读侧对空串一致：都按未配置处理", () => {
    /* 空串是这两格唯一的交集语义；两函数都已各自钉住，这里钉它们的一致性。 */
    expect(isExtraBodyJsonObject("")).toBe(true);
    expect(parseExtraBodyObject("")).toBeNull();
  });
});
