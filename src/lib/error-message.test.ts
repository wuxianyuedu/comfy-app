import { describe, expect, it } from "vitest";

import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it("Error 取 message", () => {
    expect(errorMessage(new Error("炸了"), "兜底")).toBe("炸了");
  });

  it("带 message 字段的普通对象同样取出（tRPC 错误体不一定是 Error 实例）", () => {
    expect(errorMessage({ message: "网络错误" }, "兜底")).toBe("网络错误");
  });

  it("空串回落兜底——否则提示条是一片空白", () => {
    expect(errorMessage(new Error(""), "兜底")).toBe("兜底");
  });

  it("message 非字符串（数字/对象）时回落兜底", () => {
    expect(errorMessage({ message: 500 }, "兜底")).toBe("兜底");
    expect(errorMessage({ message: { code: "E" } }, "兜底")).toBe("兜底");
  });

  it("null / undefined / 原始值抛错一律回落兜底", () => {
    expect(errorMessage(null, "兜底")).toBe("兜底");
    expect(errorMessage(undefined, "兜底")).toBe("兜底");
    expect(errorMessage("boom", "兜底")).toBe("兜底");
    expect(errorMessage(0, "兜底")).toBe("兜底");
  });
});

describe("网络层报错翻译", () => {
  it("JSON 解析失败翻译成可读文案（ISSUE #220 设置页报错原文）", () => {
    const e = new Error(
      `Unexpected token '<', "<!DOCTYPE "...is not valid JSON`,
    );
    expect(errorMessage(e, "加载失败")).toBe(
      "服务返回了非预期内容（通常是应用服务正在重启或未就绪），请稍候重试",
    );
  });

  it("Failed to fetch 翻译成网络提示", () => {
    expect(errorMessage(new TypeError("Failed to fetch"), "兜底")).toBe(
      "网络请求失败，请检查应用服务是否正在运行",
    );
  });

  it("普通业务错误不受翻译影响，原样返回", () => {
    expect(errorMessage(new Error("模型名称已存在"), "兜底")).toBe(
      "模型名称已存在",
    );
  });

  it("翻译命中但配合空串仍走兜底", () => {
    expect(errorMessage(new Error(""), "兜底")).toBe("兜底");
  });
});
