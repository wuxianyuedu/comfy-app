/**
 * 「媒体引用 → 可渲染地址」的唯一出口（规范 16 §16.2.4.32）。
 *
 * 用例钉两处收口前**各判各的**地方：
 *  ① 空引用返回 `null`（不拼出 `?filename=` 让服务端报错）；
 *  ② 「以 `/` 开头 = 已是可直接使用的路径」这条判据 —— 收口前只有一处写了。
 */
import { describe, expect, it } from "vitest";

import { comfyImageUrl, mediaPreviewUrl } from "./media-url";

describe("comfyImageUrl", () => {
  it("拼出带 type=input 的代理地址", () => {
    expect(comfyImageUrl({ filename: "abc.png" })).toBe(
      "/api/images?filename=abc.png&type=input",
    );
  });

  it("subfolder 只在给定时出现", () => {
    expect(comfyImageUrl({ filename: "a.png", subfolder: "sub" })).toBe(
      "/api/images?filename=a.png&subfolder=sub&type=input",
    );
    expect(comfyImageUrl({ filename: "a.png", subfolder: null })).toBe(
      "/api/images?filename=a.png&type=input",
    );
  });

  it("文件名与子目录都被编码（带 # / & 时不能打到另一个端点）", () => {
    expect(comfyImageUrl({ filename: "sub#dir&x.png", subfolder: "a b" })).toBe(
      `/api/images?filename=${encodeURIComponent("sub#dir&x.png")}&subfolder=${encodeURIComponent("a b")}&type=input`,
    );
  });

  it("type 可覆盖（output / temp 都走同一出口）", () => {
    expect(comfyImageUrl({ filename: "a.png", type: "output" })).toBe(
      "/api/images?filename=a.png&type=output",
    );
  });

  it("空 / 全空白 filename 返回 null（不拼出 ?filename=）", () => {
    /* 相册数组越界时原来会拼出 `?filename=` 并请求服务端 ——
     * 「这张图还不存在」不该由服务端报错来表达。 */
    expect(comfyImageUrl({ filename: "" })).toBeNull();
    expect(comfyImageUrl({ filename: "   " })).toBeNull();
  });
});

describe("mediaPreviewUrl", () => {
  it("以 / 开头 = 已是应用内绝对路径，原样返回", () => {
    expect(mediaPreviewUrl("/api/generated/x/img_0.png")).toBe(
      "/api/generated/x/img_0.png",
    );
  });

  it("裸文件名走 /api/images 代理", () => {
    expect(mediaPreviewUrl("abc.png")).toBe(
      "/api/images?filename=abc.png&type=input",
    );
  });

  it("空引用返回 null（与 comfyImageUrl 同口径）", () => {
    expect(mediaPreviewUrl(null)).toBeNull();
    expect(mediaPreviewUrl(undefined)).toBeNull();
    expect(mediaPreviewUrl("")).toBeNull();
    expect(mediaPreviewUrl("  ")).toBeNull();
  });
});
