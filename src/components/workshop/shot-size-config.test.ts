import { describe, it, expect } from "vitest";

import {
  clarityPresetOf,
  parseShotSize,
  ratioValueOf,
  shotSizeSummary,
  shotSizeToDims,
  shotSizeToExposed,
  shotSizeToParam,
} from "./shot-size-config";

describe("shot-size-config", () => {
  it("默认状态 → 竖屏 1k（3:4 长边 1024 → 768x1024）", () => {
    const param = shotSizeToParam({ ratio: "3:4", clarity: "1k" });
    expect(param).toBe("768x1024");
  });

  it("16:9 + 1M 像素（64 对齐）保持总像素预算", () => {
    const { width, height } = shotSizeToDims({
      ratio: "16:9 横屏",
      clarity: "1M",
    });
    expect(width * height).toBeGreaterThanOrEqual(1_000_000);
    expect(width / height).toBeGreaterThan(1.5);
    expect(width / height).toBeLessThan(2);
  });

  it("parseShotSize 反解历史 WxH 字符串", () => {
    const state = parseShotSize("832x1216");
    expect(ratioValueOf(state.ratio)).toBeCloseTo(832 / 1216, 1);
    /* 832x1216 ≈ 1.01M 总像素 → 归入百万像素 1M 档。 */
    expect(clarityPresetOf(state.clarity).label).toBe("1M");
  });

  it("parseShotSize 对非 WxH / 空值回退默认", () => {
    expect(parseShotSize(undefined).clarity).toBe("1k");
    expect(parseShotSize("").ratio).toBe("3:4");
    expect(parseShotSize("abc").ratio).toBe("3:4");
    expect(parseShotSize("0x0").ratio).toBe("3:4");
  });

  it("对外形状给的是「比例 + 像素基准」，不是 WxH", () => {
    /* 像素档（1k/2k/4k）：给长边像素，不给百万像素量。 */
    const pixel = shotSizeToExposed({ ratio: "3:4", clarity: "1k" });
    expect(pixel.aspect).toBe("3:4");
    expect(pixel.pixelLongEdge).toBe(1024);
    expect(pixel.megapixels).toBeUndefined();

    /* 百万像素档（1M/2M/4M）：给总像素量（单位 M），不给长边。 */
    const mega = shotSizeToExposed({ ratio: "16:9 横屏", clarity: "2M" });
    expect(mega.aspect).toBe("16:9");
    expect(mega.megapixels).toBe(2);
    expect(mega.pixelLongEdge).toBeUndefined();
  });

  it("摘要只说「比例 + 像素」，不带折算出的 WxH", () => {
    const summary = shotSizeSummary({ ratio: "3:4", clarity: "1k" });
    expect(summary).toBe("3:4 / 1k");
    expect(summary).not.toContain("768x1024");
  });
});
