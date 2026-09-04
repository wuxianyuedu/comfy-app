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
