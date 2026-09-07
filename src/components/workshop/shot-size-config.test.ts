import { describe, it, expect } from "vitest";

import {
  clarityPresetOf,
  normalizeShotSize,
  parseShotSize,
  ratioValueOf,
  shotSizeSummary,
  shotSizeToDims,
  shotSizeToParam,
} from "./shot-size-config";

describe("shot-size-config", () => {
  it("默认状态 → 竖屏 1k（3:4 长边 1024 → 768x1024）", () => {
    const param = shotSizeToParam({
      ratio: "3:4",
      clarity: "1k",
      align: 64,
    });
    expect(param).toBe("768x1024");
  });

  it("16:9 + 1M 像素（64 对齐）保持总像素预算", () => {
    const { width, height } = shotSizeToDims({
      ratio: "16:9 横屏",
      clarity: "1M",
      align: 64,
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
    expect(parseShotSize("abc").align).toBe(64);
    expect(parseShotSize("0x0").ratio).toBe("3:4");
  });

  it("normalizeShotSize 吸附对齐倍数并钳制范围", () => {
    expect(normalizeShotSize({ ratio: "1:1 正方", clarity: "1k", align: 50 }).align).toBe(48);
    expect(normalizeShotSize({ ratio: "1:1 正方", clarity: "1k", align: 4 }).align).toBe(64);
    expect(normalizeShotSize({ ratio: "1:1 正方", clarity: "1k", align: 999 }).align).toBe(128);
  });

  it("摘要包含比例、像素与最终尺寸", () => {
    const summary = shotSizeSummary({ ratio: "3:4", clarity: "1k", align: 64 });
    expect(summary).toContain("3:4");
    expect(summary).toContain("1k");
    expect(summary).toContain("768x1024");
  });
});
