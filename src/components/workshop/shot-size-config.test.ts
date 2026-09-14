import { describe, it, expect } from "vitest";

import {
  clarityPresetOf,
  parseShotSize,
  ratioValueOf,
  shotClarityKind,
  shotSizeSummary,
  shotSizeToDims,
  shotSizeToExposed,
  shotSizeToParam,
  shotSizeToRelay,
  type ShotSizeState,
} from "./shot-size-config";

const state = (over: Partial<ShotSizeState> = {}): ShotSizeState => ({
  ratio: "3:4",
  clarity: "1k",
  multiple: 64,
  ...over,
});

describe("shot-size-config", () => {
  it("默认状态 → 竖屏 1k（图片场景 3:4 档 768x1024）", () => {
    expect(shotSizeToParam(state())).toBe("768x1024");
  });

  it("同一档位在图片 / 视频场景取不同的值（1k：1024 vs 1280 长边）", () => {
    /* 16:9 + 1k：图片场景按 AI 出图口径 1024×576，视频场景按行业标准 1280×720。 */
    expect(shotSizeToParam(state({ ratio: "16:9 横屏" }), "image")).toBe("1024x576");
    expect(shotSizeToParam(state({ ratio: "16:9 横屏" }), "video")).toBe("1280x720");
  });

  it("16:9 + 1M 像素（64 对齐）保持总像素预算", () => {
    const { width, height } = shotSizeToDims(state({ ratio: "16:9 横屏", clarity: "1M" }));
    expect(width * height).toBeGreaterThanOrEqual(1_000_000);
    expect(width / height).toBeGreaterThan(1.5);
    expect(width / height).toBeLessThan(2);
    expect(width % 64).toBe(0);
    expect(height % 64).toBe(0);
  });

  it("倍数改变百万像素档的宽高网格（8 / 64 吸附到不同档）", () => {
    const fine = shotSizeToDims(state({ ratio: "16:9 横屏", clarity: "1M", multiple: 8 }));
    const coarse = shotSizeToDims(state({ ratio: "16:9 横屏", clarity: "1M", multiple: 64 }));
    expect(fine.width % 8).toBe(0);
    expect(coarse.width % 64).toBe(0);
    expect(fine).not.toEqual(coarse);
  });

  it("parseShotSize 反解历史 WxH 字符串", () => {
    const parsed = parseShotSize("832x1216");
    expect(ratioValueOf(parsed.ratio)).toBeCloseTo(832 / 1216, 1);
    /* 832x1216 ≈ 1.01M 总像素 → 归入百万像素 1M 档；两侧都能被 64 整除。 */
    expect(clarityPresetOf(parsed.clarity).label).toBe("1M");
    expect(parsed.multiple).toBe(64);
  });

  it("parseShotSize 对非 WxH / 空值回退默认", () => {
    expect(parseShotSize(undefined).clarity).toBe("1k");
    expect(parseShotSize(undefined).multiple).toBe(64);
    expect(parseShotSize("").ratio).toBe("3:4");
    expect(parseShotSize("abc").ratio).toBe("3:4");
    expect(parseShotSize("0x0").ratio).toBe("3:4");
  });

  it("分辨率档换算成「比例 + 百万像素 + 倍数」下发", () => {
    /* 用户口径：界面选的是「比例 + 分辨率」，工作流要「比例 + 百万像素 + 倍数」
     * 时按尺寸表换算 —— 百万像素取该档宽高的实际总像素，倍数取能整除两侧的最大候选。 */
    const exposed = shotSizeToExposed(state({ ratio: "16:9 横屏", clarity: "2k" }));
    expect(exposed.aspect).toBe("16:9");
    /* 图片场景 16:9 2k = 2048×1152 → 2.359M，两侧都能被 64 整除。 */
    expect(exposed.megapixels).toBe(2.359);
    expect(exposed.multiple).toBe(64);
    /* 只暴露单个「分辨率」端口的工作流仍能拿到长边像素。 */
    expect(exposed.pixelLongEdge).toBe(2048);
  });

  it("百万像素档原样透传「比例 + 百万像素 + 倍数」", () => {
    const exposed = shotSizeToExposed(
      state({ ratio: "16:9 横屏", clarity: "2M", multiple: 32 }),
    );
    expect(exposed.aspect).toBe("16:9");
    expect(exposed.megapixels).toBe(2);
    expect(exposed.multiple).toBe(32);
    expect(exposed.pixelLongEdge).toBeUndefined();
  });

  it("远端通道拿到的是「比例 + 百万像素 + 倍数」（分辨率档也要换算）", () => {
    const relay = shotSizeToRelay(state({ ratio: "16:9 横屏", clarity: "1k" }));
    expect(relay.aspectRatio).toBe("16:9");
    expect(relay.megapixels).toBe("0.59");
    /* 与「模型适配」里契约 size 口的三行同口径。 */
    expect(relay.multiple).toBe(64);

    const mega = shotSizeToRelay(
      state({ ratio: "16:9 横屏", clarity: "2M", multiple: 32 }),
    );
    expect(mega.megapixels).toBe("2");
    expect(mega.multiple).toBe(32);
  });

  it("摘要：分辨率档只说「比例 + 像素」，百万像素档追加倍数", () => {
    expect(shotSizeSummary(state())).toBe("3:4 / 1k");
    expect(shotSizeSummary(state({ clarity: "2M", multiple: 32 }))).toBe("3:4 / 2M / 32");
  });

  it("子类判定区分分辨率与百万像素", () => {
    expect(shotClarityKind(state({ clarity: "4k" }))).toBe("pixel");
    expect(shotClarityKind(state({ clarity: "4M" }))).toBe("megapixel");
  });
});
