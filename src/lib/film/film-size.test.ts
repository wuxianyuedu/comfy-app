/**
 * 单镜画幅的口径（ISSUE #5138）：场景无关档让出图与视频两侧算出同一组宽高，
 * 否则 MiniMax H3 的图生视频会在首帧编码时形状不匹配。
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_SIZE_PRESET_TABLE, sizeSpecDims } from "~/lib/media/size-presets";

import { FILM_COMPOSE_SIZE, NATIVE_SHOT_SIZE, shotSizeFor } from "./film-size";

describe("shotSizeFor（ISSUE #5138）", () => {
  it("图片与视频两个场景算出同一组宽高", () => {
    const size = shotSizeFor(FILM_COMPOSE_SIZE);
    const image = sizeSpecDims(size, "image", DEFAULT_SIZE_PRESET_TABLE);
    const video = sizeSpecDims(size, "video", DEFAULT_SIZE_PRESET_TABLE);
    expect(image).toEqual(video);
    expect(image.width).toBeGreaterThan(0);
  });

  it("比例沿用调用方给的，档位与倍数固定为场景无关档", () => {
    expect(shotSizeFor({ ratio: "9:16 竖屏", clarity: "1k", multiple: 64 })).toEqual({
      ratio: "9:16 竖屏",
      clarity: "1M",
      multiple: 64,
    });
    expect(NATIVE_SHOT_SIZE).toMatchObject({ clarity: "1M", multiple: 64 });
  });

  it("text 列里的 JSON 形态也认（与 #5136 同一容错出口）", () => {
    expect(
      shotSizeFor(JSON.stringify({ ratio: "16:9 横屏", clarity: "1k", multiple: 64 })),
    ).toMatchObject({ ratio: "16:9 横屏", clarity: "1M", multiple: 64 });
  });
});
