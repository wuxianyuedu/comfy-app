/**
 * 跨镜尾帧接力（ISSUE #5212）：参数形状与来源识别的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import { continuityFromOf, tailFrameArgs } from "./tail-frame";

describe("tailFrameArgs", () => {
  it("从片段尾部取一帧，不重编码整段", () => {
    const args = tailFrameArgs("/api/generated/a.mp4", "/generated/films/tail/x.jpg");
    expect(args).toEqual([
      "-y",
      "-sseof",
      "-0.15",
      "-i",
      "/api/generated/a.mp4",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "/generated/films/tail/x.jpg",
    ]);
  });
});

describe("continuityFromOf", () => {
  it("只认非空字符串，脏值当没开接力", () => {
    expect(continuityFromOf({ continuityFromShotId: "shot-1" })).toBe("shot-1");
    expect(continuityFromOf({ continuityFromShotId: "" })).toBeNull();
    expect(continuityFromOf({ continuityFromShotId: 42 })).toBeNull();
    expect(continuityFromOf({})).toBeNull();
  });
});
