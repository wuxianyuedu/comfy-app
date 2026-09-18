import { describe, it, expect } from "vitest";
import {
  escapePwshSingle,
  buildStartProcessArgumentList,
  decodePowerShellOutput,
} from "./process-launch";

describe("escapePwshSingle", () => {
  it("普通路径原样包进单引号", () => {
    expect(escapePwshSingle("D:\\ComfyUI\\python.exe")).toBe(
      "'D:\\ComfyUI\\python.exe'",
    );
  });

  it("含单引号转义为双单引号（防注入）", () => {
    expect(escapePwshSingle("it's")).toBe("'it''s'");
  });

  it("含空格的路径不拆分（整体仍在一个单引号字符串内）", () => {
    const out = escapePwshSingle("C:/Program Files/Ollama/ollama.exe");
    expect(out).toContain(" ");
    expect(out.startsWith("'")).toBe(true);
    expect(out.endsWith("'")).toBe(true);
  });
});

describe("buildStartProcessArgumentList", () => {
  it("多参数整体写成一个 @() 数组字面量（裸排会被 PS5.1 当位置参数拒绝）", () => {
    expect(buildStartProcessArgumentList(["-s", "D:\\x\\main.py"])).toBe(
      `@('"-s"','"D:\\x\\main.py"')`,
    );
  });

  it("含空格的参数由元素自带双引号，拼接后不会被拆分", () => {
    const out = buildStartProcessArgumentList([
      "--input-directory",
      "D:/a b/input",
    ]);
    expect(out).toBe(`@('"--input-directory"','"D:/a b/input"')`);
    expect(out).toContain('"D:/a b/input"');
  });

  it("参数值里的双引号按 Windows 命令行约定转义", () => {
    expect(buildStartProcessArgumentList(['a"; rm -rf /'])).toBe(
      `@('"a\\"; rm -rf /"')`,
    );
  });

  it("空数组返回空数组字面量", () => {
    expect(buildStartProcessArgumentList([])).toBe("@()");
  });
});

describe("decodePowerShellOutput", () => {
  it("UTF-16LE 带 BOM 的输出解码为可读文本", () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("hello 中文", "utf16le"),
    ]);
    expect(decodePowerShellOutput(utf16)).toBe("hello 中文");
  });

  it("普通 UTF-8 输出原样解码（不带 BOM、非宽字符）", () => {
    expect(decodePowerShellOutput(Buffer.from("hello utf8", "utf8"))).toBe(
      "hello utf8",
    );
  });

  it("空缓冲返回空串", () => {
    expect(decodePowerShellOutput(Buffer.alloc(0))).toBe("");
  });
});
