/**
 * 驼峰 ⇄ kebab 换算的判据（规范 16 §16.2.4.59）。
 *
 * 这条账的实质不是「重复」而是「**没有一处写下来**」：唯一落点
 * （`zClass`）把判据写在表达式里，而 5 个工具类名与 `globals.css` 的
 * `@theme` 必须与它一致 —— 错误的方式是**静默**的（Tailwind 找不到类名
 * 不报错，只是那一层没有 `z-index`）。
 */
import { describe, expect, it } from "vitest";

import { toCamelCase, toKebabCase } from "./case-token";

describe("toKebabCase", () => {
  it("单驼峰档名逐字转成工具类名（与 globals.css 的 @theme 同源）", () => {
    expect(toKebabCase("canvasUi")).toBe("canvas-ui");
    expect(toKebabCase("canvasMax")).toBe("canvas-max");
  });

  it("全小写原样返回（不凭空加连字符）", () => {
    expect(toKebabCase("popup")).toBe("popup");
    expect(toKebabCase("base")).toBe("base");
    expect(toKebabCase("")).toBe("");
  });

  it("首字母大写的帕斯卡也按同一规则", () => {
    expect(toKebabCase("CanvasUi")).toBe("-canvas-ui");
  });

  it("连续大写不做词边界猜测（`HTTPServer` 逐字符拆）", () => {
    /* 刻意不做「识别缩写」的花活：本仓库档名全是单驼峰，猜边界只会引入
     * 一处永远没人能确认对错的规则。这条用例把「就这样」钉住。 */
    expect(toKebabCase("HTTPServer")).toBe("-h-t-t-p-server");
  });

  it("前导下划线保留（私有语义不该被换算抹掉）", () => {
    expect(toKebabCase("_private")).toBe("_private");
  });
});

describe("toCamelCase", () => {
  it("读回自己的输出", () => {
    expect(toCamelCase("canvas-ui")).toBe("canvasUi");
    expect(toCamelCase("canvas-max")).toBe("canvasMax");
  });

  it("多个连字符都处理（只处理第一个是最常见的写错方式）", () => {
    expect(toCamelCase("a-b-c")).toBe("aBC");
  });

  it("无连字符时原样返回", () => {
    expect(toCamelCase("popup")).toBe("popup");
    expect(toCamelCase("")).toBe("");
  });

  it("与 toKebabCase 往返一致（单驼峰）", () => {
    for (const name of ["base", "canvasUi", "canvasMax", "popup"]) {
      expect(toCamelCase(toKebabCase(name))).toBe(name);
    }
  });
});
