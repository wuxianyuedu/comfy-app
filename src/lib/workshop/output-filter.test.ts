import { describe, expect, it } from "vitest";

import { isWantedOutput } from "./output-filter";

describe("isWantedOutput — 工坊产物按「命中本媒体」精确收（#4596）", () => {
  it("图片目标只收 image", () => {
    expect(isWantedOutput("image", { kind: "image" })).toBe(true);
    expect(isWantedOutput("image", { kind: "video" })).toBe(false);
    /* 回归现场：other（ShowText / 未知输出）不许通过——旧写法 `kind !== "video"`
     * 会把它放进去，覆盖已写入的 imageUrl。 */
    expect(isWantedOutput("image", { kind: "other" })).toBe(false);
  });

  it("视频目标只收 video", () => {
    expect(isWantedOutput("video", { kind: "video" })).toBe(true);
    expect(isWantedOutput("video", { kind: "image" })).toBe(false);
    /* 旧写法 `kind !== "image"` 会放行 audio/other，污染成片合成的镜头素材。 */
    expect(isWantedOutput("video", { kind: "other" })).toBe(false);
  });
});
