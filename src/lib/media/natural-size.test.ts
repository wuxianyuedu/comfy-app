/**
 * 「一张媒体图的自然尺寸是多少」的唯一出口（规范 16 §16.2.4.31）。
 *
 * 用例钉两处收口前**各判各的**地方：
 *  ① 读不到尺寸（0 / NaN）时是 `null` 而不是 `{0,0}` —— 后者会让下游除法
 *     产出 `Infinity`，界面表现为塌掉的盒子；
 *  ② 竖图判据是**三态**：「还不知道」与「确定不是竖图」在布局上是两种处置。
 */
import { describe, expect, it } from "vitest";

import {
  formatNaturalSize,
  isPortraitMedia,
  naturalAspectRatio,
  readNaturalSize,
} from "./natural-size";

/** 图片元素的最小宿主（只暴露出口要读的四个读数）。 */
const img = (width: number, height: number) => ({
  naturalWidth: width,
  naturalHeight: height,
});
/** 视频元素：自然尺寸在 `video*` 上。 */
const video = (width: number, height: number) => ({
  videoWidth: width,
  videoHeight: height,
});

describe("readNaturalSize", () => {
  it("读图片的 natural* 与视频的 video*", () => {
    expect(readNaturalSize(img(1102, 834))).toEqual({
      width: 1102,
      height: 834,
    });
    expect(readNaturalSize(video(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("未解码 / 未取到元数据（四个读数为 0）时返回 null", () => {
    /* 把 0 当尺寸往下算的那几处会得到 `Infinity` / `NaN` 比例 ——
     * 界面上是一个塌掉的盒子，看不出原因。 */
    expect(readNaturalSize(img(0, 0))).toBeNull();
    expect(readNaturalSize(video(0, 0))).toBeNull();
  });

  it("只有一侧是 0 也判读不到（比例无意义）", () => {
    expect(readNaturalSize(img(100, 0))).toBeNull();
    expect(readNaturalSize(img(0, 100))).toBeNull();
  });

  it("NaN / 负数 / 无限都不算有效尺寸", () => {
    expect(readNaturalSize(img(Number.NaN, 10))).toBeNull();
    expect(readNaturalSize(img(-10, 10))).toBeNull();
    expect(readNaturalSize(img(Number.POSITIVE_INFINITY, 10))).toBeNull();
  });

  it("元素本身缺席（null / undefined）时返回 null", () => {
    expect(readNaturalSize(null)).toBeNull();
    expect(readNaturalSize(undefined)).toBeNull();
  });

  it("同时有两组读数时优先 natural*（图片宿主上 video* 恒为 0）", () => {
    expect(
      readNaturalSize({ naturalWidth: 10, naturalHeight: 5, videoWidth: 99 }),
    ).toEqual({ width: 10, height: 5 });
  });
});

describe("naturalAspectRatio", () => {
  it("宽 / 高（16:9 与竖版都对）", () => {
    expect(naturalAspectRatio(img(1600, 900))).toBeCloseTo(16 / 9, 5);
    expect(naturalAspectRatio(img(1080, 1920))).toBeCloseTo(1080 / 1920, 5);
  });

  it("读不到尺寸时返回 null（不是 NaN / Infinity）", () => {
    expect(naturalAspectRatio(img(0, 0))).toBeNull();
    expect(naturalAspectRatio(null)).toBeNull();
  });
});

describe("isPortraitMedia", () => {
  it("高三态：竖 / 横 / 方", () => {
    expect(isPortraitMedia(img(100, 200))).toBe(true);
    expect(isPortraitMedia(img(200, 100))).toBe(false);
    expect(isPortraitMedia(img(100, 100))).toBe(false);
  });

  it("读不到尺寸时是 null 而不是 false（「还不知道」≠「确定不是竖图」）", () => {
    expect(isPortraitMedia(img(0, 0))).toBeNull();
    expect(isPortraitMedia(undefined)).toBeNull();
  });
});

describe("formatNaturalSize", () => {
  it("用 ×（U+00D7）连接，各处必须同一个字符", () => {
    expect(formatNaturalSize(img(1102, 834))).toBe("1102 × 834");
  });

  it("读不到尺寸时返回 null，由调用处决定显示什么", () => {
    expect(formatNaturalSize(img(0, 0))).toBeNull();
  });
});
