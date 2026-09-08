import { describe, expect, it } from "vitest";

import { describeGlobalError, describeUnhandledRejection } from "./LogProvider";

describe("describeGlobalError", () => {
  it("Error 实例输出 name + message + 首行堆栈", () => {
    const e = new TypeError("boom");
    const text = describeGlobalError(e);
    expect(text).toContain("TypeError: boom");
    expect(text).toContain("at ");
  });

  it("带 message 的普通对象取 message（tRPC 错误体不一定是 Error 实例）", () => {
    expect(describeGlobalError({ message: "网络错误" })).toBe("网络错误");
  });

  it("字符串直接返回", () => {
    expect(describeGlobalError("炸了")).toBe("炸了");
  });

  it("无法识别的抛值回落 JSON / String 兜底，不抛错", () => {
    expect(describeGlobalError(undefined)).toBe("undefined");
    expect(describeGlobalError(42)).toBe("42");
    // 循环引用 JSON.stringify 会抛错，应走 String() 兜底而不是抛出
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeGlobalError(circular)).not.toThrow();
    expect(describeGlobalError(circular)).toContain("[object Object]");
  });
});

describe("describeUnhandledRejection", () => {
  it("reason 是 Error 时输出完整堆栈", () => {
    const text = describeUnhandledRejection(new Error("async boom"));
    expect(text).toContain("Error: async boom");
  });

  it("reason 是字符串时输出带说明的原文", () => {
    expect(describeUnhandledRejection("something")).toBe(
      "something（未提供错误对象，仅有此信息）",
    );
  });
});
