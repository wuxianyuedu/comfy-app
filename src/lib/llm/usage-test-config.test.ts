import { describe, expect, it } from "vitest";
import {
  usageFieldsToJson,
  looksLikeImage,
} from "./usage-test-config";

describe("usageFieldsToJson", () => {
  it("把字段行转成合法 JSON 对象字符串", () => {
    const json = usageFieldsToJson([
      { key: "mode", value: "text" },
      { key: "seed", value: "42" },
    ]);
    expect(JSON.parse(json)).toEqual({ mode: "text", seed: 42 });
  });

  it("值是 JSON 字面量时按字面量类型解析（数字 / 布尔 / 对象）", () => {
    const json = usageFieldsToJson([
      { key: "seed", value: "42" },
      { key: "enhance", value: "true" },
      { key: "duration", value: "5" },
    ]);
    expect(JSON.parse(json)).toEqual({ seed: 42, enhance: true, duration: 5 });
  });

  it("非 JSON 字面量的文本原样按字符串保留（如图片 data URL）", () => {
    const json = usageFieldsToJson([
      { key: "mode", value: "keyframe" },
      { key: "first_frame", value: "https://example.com/a.png" },
    ]);
    expect(JSON.parse(json)).toEqual({
      mode: "keyframe",
      first_frame: "https://example.com/a.png",
    });
  });

  it("跳过空白 key 或空白 value，全空则返回空串", () => {
    expect(
      usageFieldsToJson([
        { key: "", value: "x" },
        { key: "a", value: "  " },
      ]),
    ).toBe("");
  });
});

describe("looksLikeImage", () => {
  it("识别 data URL 与常见图片扩展名的 http(s) 地址", () => {
    expect(looksLikeImage("data:image/png;base64,AAAA")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/ff.png")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/ff.jpeg?x=1")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/video.mp4")).toBe(false);
    expect(looksLikeImage("一只柴犬")).toBe(false);
    expect(looksLikeImage("")).toBe(false);
  });
});
