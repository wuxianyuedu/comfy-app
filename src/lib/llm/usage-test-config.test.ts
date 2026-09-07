import { describe, expect, it } from "vitest";
import {
  USAGE_FIELD_PRESETS,
  buildVideoPollUrls,
  defaultVideoFields,
  hasUsageFieldKey,
  usageFieldsToJson,
  looksLikeImage,
  isMediaField,
  isMediaArrayField,
  videoModeHidesMedia,
  videoModeMissingHint,
  isModeValueBroken,
  isPreviewableUrl,
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

describe("isPreviewableUrl", () => {
  it("http(s) 与 data:image 一律可尝试预览，即使路径无图片扩展名", () => {
    // Bing / 云存储等 CDN 图片地址常无扩展名，looksLikeImage 会漏判，
    // 但预览入口应放开：能加载就显示，加载失败由 onError 兜底。
    expect(
      isPreviewableUrl(
        "https://ts1.tc.mm.bing.net/th/id/R-C.df954332469ba562a496acc5c1e778a6?rik=0&pid=ImgRaw",
      ),
    ).toBe(true);
    expect(isPreviewableUrl("https://cdn.example.com/signed/id12345")).toBe(
      true,
    );
    expect(isPreviewableUrl("https://cdn.example.com/ff.png")).toBe(true);
    expect(isPreviewableUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isPreviewableUrl("data:image/webp;base64,xx")).toBe(true);
  });
  it("非 URL / 空值不算可预览", () => {
    expect(isPreviewableUrl("42")).toBe(false);
    expect(isPreviewableUrl("text/keyframe")).toBe(false);
    expect(isPreviewableUrl("一只柴犬")).toBe(false);
    expect(isPreviewableUrl("")).toBe(false);
    expect(isPreviewableUrl("   ")).toBe(false);
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
    expect(videoModeHidesMedia([{ key: "mode", value: "keyframe" }])).toBe(
      false,
    );
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

describe("isModeValueBroken / rescue 场景", () => {
  it("mode 被图片 URL / data URL / 空值覆盖时判定为损坏", () => {
    expect(isModeValueBroken("")).toBe(true);
    expect(
      isModeValueBroken(
        "https://cnb.cool/moon-read/comfy-app-t3/-/imgs/issues/xxx.png",
      ),
    ).toBe(true);
    expect(
      isModeValueBroken("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="),
    ).toBe(true);
    expect(isModeValueBroken("   ")).toBe(true);
  });

  it("正常模式值不被误判（含大小写与自定义值）", () => {
    expect(isModeValueBroken("text")).toBe(false);
    expect(isModeValueBroken("keyframe")).toBe(false);
    expect(isModeValueBroken("reference")).toBe(false);
    expect(isModeValueBroken(" TEXT ")).toBe(false);
    expect(isModeValueBroken("v2f_text")).toBe(false);
  });

  it("mode 被覆盖为超长杂值时判定为损坏", () => {
    expect(isModeValueBroken("x".repeat(65))).toBe(true);
    expect(isModeValueBroken("x".repeat(64))).toBe(false);
  });
});

describe("数组媒体字段（images / audios）", () => {
  it("单张裸 URL 自动包成数组，避免服务端期望 []string 却收到 string", () => {
    const json = usageFieldsToJson([
      { key: "images", value: "https://cdn.example.com/a.png" },
    ]);
    expect(JSON.parse(json)).toEqual({
      images: ["https://cdn.example.com/a.png"],
    });
  });

  it("多张裸 URL 用逗号分隔自动拆成数组", () => {
    const json = usageFieldsToJson([
      {
        key: "images",
        value: "https://a.example/1.png, https://b.example/2.jpg",
      },
    ]);
    expect(JSON.parse(json)).toEqual({
      images: ["https://a.example/1.png", "https://b.example/2.jpg"],
    });
  });

  it("带引号的单个字符串（合法 JSON）也包成数组", () => {
    const json = usageFieldsToJson([
      { key: "images", value: '"https://cdn.example.com/a.png"' },
    ]);
    expect(JSON.parse(json)).toEqual({
      images: ["https://cdn.example.com/a.png"],
    });
  });

  it("已是 JSON 数组时原样保留（不重复包裹）", () => {
    const json = usageFieldsToJson([
      { key: "audios", value: '["https://a.example/1.mp3"]' },
    ]);
    expect(JSON.parse(json)).toEqual({
      audios: ["https://a.example/1.mp3"],
    });
  });

  it("非数组字段不受影响（first_frame 仍是单个字符串）", () => {
    const json = usageFieldsToJson([
      { key: "first_frame", value: "https://example.com/a.png" },
    ]);
    expect(JSON.parse(json)).toEqual({
      first_frame: "https://example.com/a.png",
    });
  });

  it("isMediaArrayField 只命中 images / audios", () => {
    expect(isMediaArrayField("images")).toBe(true);
    expect(isMediaArrayField(" audios ")).toBe(true);
    expect(isMediaArrayField("first_frame")).toBe(false);
    expect(isMediaArrayField("mode")).toBe(false);
  });
});

describe("USAGE_FIELD_PRESETS / hasUsageFieldKey", () => {
  it("预设集合包含固定名称字段，供一键添加", () => {
    const keys = USAGE_FIELD_PRESETS.map((p) => p.key);
    expect(keys).toContain("images");
    expect(keys).toContain("first_frame");
    expect(keys).toContain("seed");
    expect(new Set(keys).size).toBe(keys.length); // key 不重复
  });

  it("hasUsageFieldKey 命中同名已存在的字段行（含首尾空白）", () => {
    expect(hasUsageFieldKey([{ key: "mode", value: "text" }], "mode")).toBe(
      true,
    );
    expect(
      hasUsageFieldKey(
        [{ key: " images ", value: "https://a/x.png" }],
        "images",
      ),
    ).toBe(true);
    expect(hasUsageFieldKey([{ key: "mode", value: "text" }], "images")).toBe(
      false,
    );
  });
});

import {
  usageTestDraftKey,
  mediaExtensionFromUrl,
  mediaDefaultExt,
} from "./usage-test-config";

describe("usageTestDraftKey", () => {
  it("把 kind 与条目名拼成稳定键", () => {
    expect(usageTestDraftKey("video", "Agnes 视频")).toBe("video::Agnes 视频");
    expect(usageTestDraftKey("image", "a").startsWith("image::")).toBe(true);
  });
});

describe("mediaExtensionFromUrl", () => {
  it("http(s) 地址取路径扩展名", () => {
    expect(mediaExtensionFromUrl("https://x.com/a/out.png", "mp4")).toBe("png");
    expect(mediaExtensionFromUrl("https://x.com/v.mp4?token=1", "png")).toBe(
      "mp4",
    );
    expect(mediaExtensionFromUrl("https://x.com/out", "mp4")).toBe("mp4");
  });
  it("data:image 按 mime 取扩展名", () => {
    expect(mediaExtensionFromUrl("data:image/jpeg;base64,xx", "png")).toBe(
      "jpg",
    );
    expect(mediaExtensionFromUrl("data:image/webp;base64,xx", "png")).toBe(
      "webp",
    );
  });
  it("无法识别时回落到默认扩展名", () => {
    expect(mediaExtensionFromUrl("", "png")).toBe("png");
    expect(mediaExtensionFromUrl("随便", "png")).toBe("png");
  });
});

describe("mediaDefaultExt", () => {
  it("按用途给默认扩展名", () => {
    expect(mediaDefaultExt("video")).toBe("mp4");
    expect(mediaDefaultExt("image")).toBe("png");
    expect(mediaDefaultExt("chat")).toBe("png");
  });
});


describe("buildVideoPollUrls", () => {
  it("REST 风格：任务 ID 拼在端点目录后", () => {
    const { rest, agnes } = buildVideoPollUrls(
      "https://api.example.com/v1",
      "/videos/generations",
      "vid-x",
      "task_123",
    );
    expect(rest).toBe("https://api.example.com/v1/videos/task_123");
    expect(agnes).toBe(
      "https://api.example.com/agnesapi?video_id=task_123&model_name=vid-x",
    );
  });

  it("对已有查询参数 / 特殊字符的任务 ID 做 URL 编码（agnes 形状）", () => {
    const { rest, agnes } = buildVideoPollUrls(
      "https://h.example",
      "/v1/videos/generations",
      "m&y=model",
      "id with space",
    );
    expect(rest).toBe("https://h.example/v1/videos/id with space");
    expect(agnes).toContain(
      "video_id=id%20with%20space&model_name=m%26y%3Dmodel",
    );
  });

  it("baseUrl 尾斜杠与 path 首斜杠不产生双斜杠", () => {
    const { rest } = buildVideoPollUrls(
      "https://api.example.com/v1/",
      "/videos/generations",
      "vid",
      "task_1",
    );
    expect(rest).toBe("https://api.example.com/v1/videos/task_1");
  });
});
