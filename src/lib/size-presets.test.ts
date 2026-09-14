import { describe, expect, it } from "vitest";

import {
  DEFAULT_SIZE_PRESET_TABLE,
  DEFAULT_SIZE_SPEC,
  alignMultipleOf,
  aspectLabelForDims,
  megapixelDims,
  megapixelsOf,
  nearestRatioPreset,
  normalizeAlignMultiple,
  normalizeRatioLabel,  normalizeSizeSpec,
  parseSizeText,
  ratioOfLabel,
  resolutionDims,
  resolutionTierOf,
  sceneFromMode,
  sceneIsModified,
  sizeSpecAspect,
  sizeSpecDims,
  sizeSpecFromDims,
  sizeSpecFromText,
  sizeSpecKind,
  sizeSpecLongEdge,
  sizeSpecMegapixels,
  sizeSpecMultiple,
  sizeSpecSummary,
  sizeSpecToWxH,
  toMegapixelSpec,
  toSizeSpec,  type SizeSpec,
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

describe("size-presets：尺寸表达（比例 + 分辨率 / 比例 + 百万像素 + 倍数）", () => {
  /** 尺寸表达（对齐倍数是候选之一，故收一层构造器，免得字面量被推成 number）。 */
  const sizeSpec = (over: Partial<SizeSpec> = {}): SizeSpec => ({
    ratio: "16:9 横屏",
    clarity: "1k",
    multiple: 64,
    ...over,
  });

  it("分辨率档：宽高查场景表，两种场景不同值", () => {
    const spec = sizeSpec();
    expect(sizeSpecDims(spec, "image")).toEqual({ width: 1024, height: 576 });
    expect(sizeSpecDims(spec, "video")).toEqual({ width: 1280, height: 720 });
    expect(sizeSpecToWxH(spec, "image")).toBe("1024x576");
    expect(sizeSpecKind(spec)).toBe("resolution");
    /* 只给「分辨率 / 长边」端口的工作流仍能拿到长边像素。 */
    expect(sizeSpecLongEdge(spec, "image")).toBe(1024);
  });

  it("百万像素档：两边落在倍数网格上，倍数原样透传", () => {
    const spec = sizeSpec({ clarity: "2M", multiple: 32 });
    const dims = sizeSpecDims(spec);
    expect(dims.width % 32).toBe(0);
    expect(sizeSpecMegapixels(spec)).toBe(2);
    expect(sizeSpecMultiple(spec)).toBe(32);
    expect(sizeSpecLongEdge(spec)).toBeUndefined();
    expect(sizeSpecKind(spec)).toBe("megapixel");
  });

  it("分辨率档换算成「比例 + 百万像素 + 倍数」：取实际总像素与最大公约倍数", () => {
    const spec = sizeSpec({ clarity: "2k", multiple: 8 });
    expect(sizeSpecAspect(spec)).toBe("16:9");
    expect(sizeSpecMegapixels(spec)).toBe(2.359);
    /* 分辨率档不读 `multiple`：倍数由该档宽高反推（两侧都能被 64 整除）。 */
    expect(sizeSpecMultiple(spec)).toBe(64);
  });

  it("摘要与默认值：分辨率档只说比例 + 档位，百万像素档追加倍数", () => {
    expect(sizeSpecSummary(DEFAULT_SIZE_SPEC)).toBe("3:4 / 1k");
    expect(sizeSpecSummary({ ...DEFAULT_SIZE_SPEC, clarity: "2M", multiple: 32 })).toBe(
      "3:4 / 2M / 32",
    );
  });

  it("反解：「WxH」字符串 / 宽高 → 尺寸表达（老数据回读）", () => {
    expect(parseSizeText("832x1216")).toEqual({ width: 832, height: 1216 });
    expect(parseSizeText("512×768")).toEqual({ width: 512, height: 768 });
    expect(parseSizeText("abc")).toBeNull();
    expect(parseSizeText(undefined)).toBeNull();

    const parsed = sizeSpecFromText("832x1216");
    expect(ratioOfLabel(parsed.ratio)).toBeCloseTo(832 / 1216, 1);
    /* 832×1216 ≈ 1.01M → 归入百万像素 1M 档。 */
    expect(parsed.clarity).toBe("1M");

    expect(sizeSpecFromDims(1280, 720, "video")).toEqual({
      ratio: "16:9 横屏",
      clarity: "1k",
      /* 1280 与 720 都能被 16 整除（32 除数下 720 不整）→ 倍数取 16。 */
      multiple: 16,
    });
    /* 脏值/空值回退默认，不抛错。 */
    expect(sizeSpecFromText("")).toEqual(DEFAULT_SIZE_SPEC);
    expect(normalizeSizeSpec({ ratio: "42:1", clarity: "999k" })).toEqual(DEFAULT_SIZE_SPEC);
  });

  it("toSizeSpec / normalizeSizeSpec：外部写法（短比例标签 / 旧字符串 / 对象）都收得下", () => {
    /* 外部调用方（MCP / 接口）按直觉给的是短比例标签，落到最接近的预设行。 */
    expect(normalizeRatioLabel("16:9")).toBe("16:9 横屏");
    expect(normalizeRatioLabel("3:4")).toBe("3:4");
    expect(normalizeRatioLabel("9:16")).toBe("9:16 竖屏");
    expect(normalizeRatioLabel("42:1")).toBe(DEFAULT_SIZE_SPEC.ratio);

    expect(
      normalizeSizeSpec({ ratio: "16:9", clarity: "2M", multiple: 32 }),
    ).toEqual({ ratio: "16:9 横屏", clarity: "2M", multiple: 32 });

    /* toSizeSpec：对象 / "WxH" 字符串 / 脏值三态都归一。 */
    expect(toSizeSpec({ ratio: "1:1 正方", clarity: "2k", multiple: 8 })).toEqual({
      ratio: "1:1 正方",
      clarity: "2k",
      multiple: 8,
    });
    expect(toSizeSpec("1280x720")).toEqual(sizeSpecFromText("1280x720"));
    expect(toSizeSpec(undefined)).toEqual(DEFAULT_SIZE_SPEC);
    expect(toSizeSpec(42)).toEqual(DEFAULT_SIZE_SPEC);
  });
  it("宽高 → `aspect_ratio` 端口该写的候选值", () => {
    /* 端口没声明候选 → 用标准短标签。 */
    expect(aspectLabelForDims(1280, 720)).toBe("16:9");
    /* 端口声明了候选、但候选里没有这个比例 → 不猜（返回 null，调用方退回默认值）。 */
    expect(
      aspectLabelForDims(1080, 1920, ["1:1 (Square)", "16:9 (Widescreen)"]),
    ).toBeNull();
    expect(aspectLabelForDims(1280, 720, ["1:1 (Square)", "16:9 (Widescreen)"])).toBe(
      "16:9 (Widescreen)",
    );
    expect(aspectLabelForDims(0, 0)).toBeNull();
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
