import { describe, expect, it } from "vitest";
import {
  defaultVideoFields,
  usageFieldsToJson,
  looksLikeImage,
  isMediaField,
  videoModeHidesMedia,
  videoModeMissingHint,
} from "./usage-test-config";

describe("usageFieldsToJson", () => {
  it("把字段行转成合法 JSON 对象字符串", () => {
    const json = usageFieldsToJson([
      { key: "mode", value: "text" },
      { key: "seed", value: "42" },
    ]);
    expect(JSON.parse(json)).toEqual({ mode: "text", seed: 42 });
  });

  it("值是 JSON 字面量时按字面量类型解析（数字 / 布尔 / 数组）", () => {
    const json = usageFieldsToJson([
      { key: "seed", value: "42" },
      { key: "enhance", value: "true" },
      { key: "duration", value: "5" },
      { key: "images", value: '["https://a.example/x.png"]' },
    ]);
    expect(JSON.parse(json)).toEqual({
      seed: 42,
      enhance: true,
      duration: 5,
      images: ["https://a.example/x.png"],
    });
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

describe("defaultVideoFields", () => {
  it("视频弹窗预填一行可改的 mode 字段", () => {
    expect(defaultVideoFields()).toEqual([{ key: "mode", value: "text" }]);
  });
});

describe("videoModeMissingHint", () => {
  it("keyframe 缺 first_frame / last_frame 时给出引导", () => {
    const hint = videoModeMissingHint([{ key: "mode", value: "keyframe" }]);
    expect(hint).toContain("first_frame");
  });

  it("reference 缺 images / audios 时给出引导", () => {
    const hint = videoModeMissingHint([{ key: "mode", value: "reference" }]);
    expect(hint).toContain("images");
  });

  it("text 带媒体字段时提示不匹配（对应 invalid mode 报错的常见成因）", () => {
    const hint = videoModeMissingHint([
      { key: "mode", value: "text" },
      { key: "first_frame", value: "https://example.com/a.png" },
    ]);
    expect(hint).toContain("first_frame");
  });

  it("字段齐全或纯 text 时不提示", () => {
    expect(videoModeMissingHint([{ key: "mode", value: "text" }])).toBeNull();
    expect(
      videoModeMissingHint([
        { key: "mode", value: "keyframe" },
        { key: "first_frame", value: "data:image/png;base64,AA" },
      ]),
    ).toBeNull();
    expect(videoModeMissingHint([])).toBeNull();
  });
});

describe("videoModeHidesMedia / isMediaField", () => {
  it("mode=text 时隐藏媒体字段，其它 mode 不隐藏", () => {
    expect(videoModeHidesMedia([{ key: "mode", value: "text" }])).toBe(true);
    expect(
      videoModeHidesMedia([{ key: "mode", value: "keyframe" }]),
    ).toBe(false);
    expect(videoModeHidesMedia([])).toBe(false);
  });

  it("mode 取值大小写不敏感（界面允许手改任意值）", () => {
    expect(videoModeHidesMedia([{ key: "mode", value: " TEXT " }])).toBe(true);
  });

  it("isMediaField 命中媒体字段集合（含首尾空白）", () => {
    expect(isMediaField("first_frame")).toBe(true);
    expect(isMediaField(" images ")).toBe(true);
    expect(isMediaField("audios")).toBe(true);
    expect(isMediaField("last_frame")).toBe(true);
    expect(isMediaField("seed")).toBe(false);
    expect(isMediaField("")).toBe(false);
  });
});
