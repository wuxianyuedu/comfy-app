import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIZE_PRESET_TABLE,
  alignMultipleOf,
  megapixelDims,
  megapixelsOf,
  nearestRatioPreset,
  normalizeAlignMultiple,
  resolutionDims,
  resolutionTierOf,
  sceneFromMode,
  sceneIsModified,
  toMegapixelSpec,
} from "./size-presets";

describe("size-presets：分辨率表", () => {
  it("图片与视频两个场景的 1k/2k/4k 取不同的值", () => {
    /* 图片场景（AI 出图）：长边 1024 / 2048 / 3840。 */
    expect(resolutionDims("image", 16 / 9, "1k")).toEqual({ width: 1024, height: 576 });
    expect(resolutionDims("image", 16 / 9, "2k")).toEqual({ width: 2048, height: 1152 });
    expect(resolutionDims("image", 16 / 9, "4k")).toEqual({ width: 3840, height: 2160 });

    /* 视频场景（显示器 / 视频行业标准）：2K = 2560×1440，4K UHD = 3840×2160。 */
    expect(resolutionDims("video", 16 / 9, "1k")).toEqual({ width: 1280, height: 720 });
    expect(resolutionDims("video", 16 / 9, "2k")).toEqual({ width: 2560, height: 1440 });
    expect(resolutionDims("video", 16 / 9, "4k")).toEqual({ width: 3840, height: 2160 });
  });

  it("竖屏比例按同一行取竖版宽高，不靠调用方求倒数", () => {
    expect(resolutionDims("image", 3 / 4, "1k")).toEqual({ width: 768, height: 1024 });
    expect(resolutionDims("video", 9 / 16, "2k")).toEqual({ width: 1440, height: 2560 });
  });

  it("自定义比例落到最接近的预设行", () => {
    expect(nearestRatioPreset(1.77).label).toBe("16:9 横屏");
    expect(nearestRatioPreset(0.99).label).toBe("1:1 正方");
  });

  it("由宽高反解分辨率档", () => {
    expect(resolutionTierOf("image", 2048, 1152)).toBe("2k");
    expect(resolutionTierOf("video", 1280, 720)).toBe("1k");
    expect(resolutionTierOf("image", 0, 0)).toBeNull();
  });
});

describe("size-presets：百万像素 × 倍数", () => {
  it("百万像素档的宽高落在倍数网格上，且总像素预算按比例分配", () => {
    const dims = megapixelDims(16 / 9, 1, 64);
    expect(dims.width % 64).toBe(0);
    expect(dims.height % 64).toBe(0);
    expect(dims.width / dims.height).toBeGreaterThan(1.5);
    expect((dims.width * dims.height) / 1_000_000).toBeGreaterThan(0.9);
  });

  it("倍数候选就近规范化，非法值回退默认 64", () => {
    expect(normalizeAlignMultiple(8)).toBe(8);
    expect(normalizeAlignMultiple(31)).toBe(32);
    expect(normalizeAlignMultiple(200)).toBe(64);
    expect(normalizeAlignMultiple(Number.NaN)).toBe(64);
  });

  it("倍数取能同时整除宽高的最大候选；都除不尽时退到 8", () => {
    expect(alignMultipleOf({ width: 1024, height: 576 })).toBe(64);
    expect(alignMultipleOf({ width: 1195, height: 512 })).toBe(8);
  });

  it("百万像素保留三位小数，够表达 0.59M 这类差异", () => {
    expect(megapixelsOf({ width: 1024, height: 576 })).toBe(0.59);
    expect(megapixelsOf({ width: 2048, height: 2048 })).toBe(4.194);
  });
});

describe("size-presets：两类尺寸表达之间的换算", () => {
  it("比例 + 分辨率 → 比例 + 百万像素 + 倍数（唯一解）", () => {
    const spec = toMegapixelSpec("image", 16 / 9, "2k");
    expect(spec.size).toEqual({ width: 2048, height: 1152 });
    expect(spec.megapixels).toBe(2.359);
    expect(spec.multiple).toBe(64);
  });

  it("视频场景同一档位换算出的百万像素不同", () => {
    const spec = toMegapixelSpec("video", 16 / 9, "2k");
    expect(spec.megapixels).toBe(3.686);
    expect(spec.size).toEqual({ width: 2560, height: 1440 });
  });
});

describe("size-presets：场景与改动判定", () => {
  it("模式码推场景：以 V 收尾或含 video 的走视频表", () => {
    expect(sceneFromMode("T2V")).toBe("video");
    expect(sceneFromMode("i2v")).toBe("video");
    expect(sceneFromMode("FLF2V")).toBe("video");
    expect(sceneFromMode("T2I")).toBe("image");
    expect(sceneFromMode(null)).toBe("image");
  });

  it("默认表未被改动；改一格即视为已改", () => {
    expect(sceneIsModified("image", DEFAULT_SIZE_PRESET_TABLE)).toBe(false);
    const edited = structuredClone(DEFAULT_SIZE_PRESET_TABLE);
    edited.image["16:9 横屏"]!["1k"] = { width: 1024, height: 640 };
    expect(sceneIsModified("image", edited)).toBe(true);
    expect(sceneIsModified("video", edited)).toBe(false);
  });
});
