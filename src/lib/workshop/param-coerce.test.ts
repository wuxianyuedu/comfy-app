import { describe, expect, it } from "vitest";

import { paramInt, paramNumber, paramString } from "./param-coerce";

describe("paramString", () => {
  it("字符串原样返回", () => {
    expect(paramString("euler", "dpmpp_2m")).toBe("euler");
  });

  it('空串落回缺省——参数表里的 "" 是「用户清空了输入框」，不是有效值', () => {
    expect(paramString("", "normal")).toBe("normal");
  });

  it("非字符串一律落回缺省（数字 / 对象 / 数组 / 布尔 / null / undefined）", () => {
    expect(paramString(7, "normal")).toBe("normal");
    expect(paramString({ name: "euler" }, "normal")).toBe("normal");
    expect(paramString(["euler"], "normal")).toBe("normal");
    expect(paramString(true, "normal")).toBe("normal");
    expect(paramString(null, "normal")).toBe("normal");
    expect(paramString(undefined, "normal")).toBe("normal");
  });
});

describe("paramNumber", () => {
  it("数字原样返回（含 0 与负数——它们是合法值，不该被当成空）", () => {
    expect(paramNumber(7, 28)).toBe(7);
    expect(paramNumber(0, 28)).toBe(0);
    expect(paramNumber(-1, 28)).toBe(-1);
  });

  it("数字字符串按数值解析——参数表可能来自 JSON / 表单输入", () => {
    expect(paramNumber("7", 28)).toBe(7);
    expect(paramNumber("7.5", 28)).toBe(7.5);
    expect(paramNumber(" 7 ", 28)).toBe(7);
  });

  it("解析失败 / 非有限值落回缺省", () => {
    expect(paramNumber("", 28)).toBe(28);
    expect(paramNumber("abc", 28)).toBe(28);
    expect(paramNumber(NaN, 28)).toBe(28);
    expect(paramNumber(Infinity, 28)).toBe(28);
    expect(paramNumber({ value: 7 }, 28)).toBe(28);
    expect(paramNumber([7], 28)).toBe(28);
    expect(paramNumber(null, 28)).toBe(28);
    expect(paramNumber(undefined, 28)).toBe(28);
  });
});

describe("paramInt", () => {
  it("四舍五入到整数——steps 这类由 ComfyUI 按整数消费", () => {
    expect(paramInt("7.5", 28)).toBe(8);
    expect(paramInt("7.4", 28)).toBe(7);
    expect(paramInt(30, 28)).toBe(30);
  });

  it("落回缺省时同样取整，缺省值本身若是小数不会漏过去", () => {
    expect(paramInt("abc", 28.6)).toBe(29);
  });
});
