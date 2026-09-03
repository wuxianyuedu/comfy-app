import { describe, expect, it } from "vitest";
import {
  extractBase64DataUrl,
  extractSavedOutputs,
  guessMediaKind,
} from "~/lib/workshop/api-channel-shared";

describe("guessMediaKind", () => {
  it("视频扩展名(含 query 与大小写) → video", () => {
    expect(guessMediaKind("/a/b.mp4")).toBe("video");
    expect(guessMediaKind("http://x/y.webm?token=1")).toBe("video");
    expect(guessMediaKind("clip.MOV")).toBe("video");
  });

  it("图片扩展名 → image", () => {
    expect(guessMediaKind("/a/b.png")).toBe("image");
    expect(guessMediaKind("http://x/y.jpeg?x=1")).toBe("image");
    expect(guessMediaKind("x.avif")).toBe("image");
  });

  it("其它 / 无扩展名 → other", () => {
    expect(guessMediaKind("/a/b.txt")).toBe("other");
    expect(guessMediaKind("noext")).toBe("other");
  });
});

describe("extractBase64DataUrl", () => {
  it("已带 data: 前缀原样返回", () => {
    expect(extractBase64DataUrl({ b64_json: "data:image/png;base64,AAA" })).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("裸 base64 包裹为默认 mime", () => {
    expect(extractBase64DataUrl({ base64: "AAA" })).toBe(
      "data:image/png;base64,AAA",
    );
  });

  it("无字符串可提取 → null", () => {
    expect(extractBase64DataUrl({ not: "here" })).toBeNull();
    expect(extractBase64DataUrl(null)).toBeNull();
  });
});

describe("extractSavedOutputs", () => {
  it("字符串数组 → url + 推断 kind", () => {
    expect(extractSavedOutputs(["/a.png", "/b.mp4"])).toEqual([
      { url: "/a.png", kind: "image" },
      { url: "/b.mp4", kind: "video" },
    ]);
  });

  it("单字符串 → 单元素数组", () => {
    expect(extractSavedOutputs("/a.png")).toEqual([
      { url: "/a.png", kind: "image" },
    ]);
  });

  it("对象条目取 localPath/url 与 mediaType", () => {
    expect(
      extractSavedOutputs([{ localPath: "/c.jpg", mediaType: "image" }]),
    ).toEqual([{ url: "/c.jpg", kind: "image" }]);
  });

  it("无 localPath 的对象跳过", () => {
    expect(extractSavedOutputs([{ foo: 1 }])).toEqual([]);
  });
});
