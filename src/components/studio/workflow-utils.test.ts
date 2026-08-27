import { describe, it, expect } from "vitest";
import {
  extractNoteTitle,
  isNoteType,
  resolveNodePackage,
  hexToRgba,
  lightenHex,
  mixHex,
} from "./workflow-utils";

describe("extractNoteTitle", () => {
  it("从 markdown 首个标题提取", () => {
    expect(extractNoteTitle("# 标题\n正文")).toBe("标题");
    expect(extractNoteTitle("## 二级\n正文")).toBe("二级");
    expect(extractNoteTitle("正文\n# 标题")).toBe("标题");
  });

  it("无标题时取首个非空行并截断", () => {
    expect(extractNoteTitle("  hello  ")).toBe("hello");
    const long = "a".repeat(40);
    expect(extractNoteTitle(long)).toBe("a".repeat(30) + "…");
  });

  it("fallback 优先，并剥离 Note: 前缀", () => {
    expect(extractNoteTitle("", "Note: My Note")).toBe("My Note");
    expect(extractNoteTitle("# Body", "Note：正文")).toBe("正文");
    expect(extractNoteTitle("ignored", "fallback")).toBe("fallback");
  });

  it("空输入返回空串", () => {
    expect(extractNoteTitle("", "")).toBe("");
    expect(extractNoteTitle("", undefined)).toBe("");
  });
});

describe("isNoteType", () => {
  it("识别注释节点", () => {
    expect(isNoteType("Note")).toBe(true);
    expect(isNoteType("MarkdownNote")).toBe(true);
  });
  it("非注释节点返回 false", () => {
    expect(isNoteType("KSampler")).toBe(false);
    expect(isNoteType("")).toBe(false);
  });
});

describe("resolveNodePackage", () => {
  it("未知节点回退 ComfyUI", () => {
    expect(resolveNodePackage("TotallyUnknown")).toBe("ComfyUI");
  });
  it("rgthree 后缀识别", () => {
    expect(resolveNodePackage("AnySwitch (rgthree)")).toBe("rgthree-comfy");
  });
  it("cnr_id 属性优先于回退", () => {
    expect(resolveNodePackage("X", { cnr_id: "custom-pack" })).toBe("custom-pack");
    expect(resolveNodePackage("X", { cnr_id: "comfy-core" })).toBe("ComfyUI");
  });
});

describe("hex color helpers", () => {
  it("hexToRgba 输出 rgba 字符串", () => {
    expect(hexToRgba("#a855f7", 0.5)).toMatch(/^rgba\(\d+,\d+,\d+,0\.5\)$/);
  });

  it("lightenHex 提高亮度分量", () => {
    const [before, after] = [lightenHex("#111111", 0), lightenHex("#111111", 0.5)];
    expect(after).not.toBe(before);
  });

  it("mixHex 在两端之间插值（rgb 格式）", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("rgb(0,0,0)");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("rgb(255,255,255)");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("rgb(128,128,128)");
  });
});
