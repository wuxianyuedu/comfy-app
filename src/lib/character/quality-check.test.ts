/**
 * 立绘质量打分用例（ISSUE #5009）：PNG 解码（含反滤波）、确定性打分规则、
 * 「需要重新生成」的判定边界。PNG 字节用 tests/helpers/png-fixture 现场拼装。
 */
import { describe, expect, it } from "vitest";

import {
  flatImage,
  makePng,
  makePngWithFilters,
  noiseImage,
} from "../../../tests/helpers/png-fixture";
import { decodePng, needsRegeneration, scorePortraitPng } from "./quality-check";

describe("decodePng", () => {
  it("解码规则 PNG（None / Sub / Up / Paeth 滤波逐一还原）", () => {
    const pixels = new Uint8Array([
      255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 12, 34, 56, 65, 76, 87, 200, 100, 50, 1, 2, 3,
    ]);
    const decoded = decodePng(makePngWithFilters(2, 4, pixels, [0, 1, 2, 4]));
    expect(decoded).not.toBeNull();
    expect(decoded?.width).toBe(2);
    expect(decoded?.height).toBe(4);
    expect([...(decoded?.pixels ?? [])]).toEqual([...pixels]);
  });

  it("解码 makePng 直拼的图（filter=0）", () => {
    const decoded = decodePng(
      makePng(
        3,
        2,
        new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]),
      ),
    );
    expect(decoded?.width).toBe(3);
    expect(decoded?.height).toBe(2);
    expect(decoded?.pixels.length).toBe(18);
  });

  it("垃圾字节 / 截断 / 16bit / 隔行 → null", () => {
    expect(decodePng(new Uint8Array([1, 2, 3]))).toBeNull();
    const good = noiseImage(4);
    expect(decodePng(good.subarray(0, 30))).toBeNull();
    const sliced = noiseImage(4);
    sliced[24] = 16; // bit depth = 16
    expect(decodePng(sliced)).toBeNull();
    const interlaced = noiseImage(4);
    interlaced[28] = 1; // Adam7
    expect(decodePng(interlaced)).toBeNull();
  });
});

describe("scorePortraitPng —— 打分规则", () => {
  it("细节丰富的正常图：高分、无 issue", () => {
    const q = scorePortraitPng(noiseImage(512));
    expect(q.score).toBeGreaterThanOrEqual(90);
    expect(q.issues).toEqual([]);
    expect(q.metrics?.width).toBe(512);
  });

  it("纯色图：重扣并标注疑似空白", () => {
    const q = scorePortraitPng(flatImage(256));
    expect(q.score).toBeLessThan(40);
    expect(q.issues.some((i) => i.includes("纯色 / 空白"))).toBe(true);
  });

  it("分辨率过低：扣分并标注", () => {
    const q = scorePortraitPng(noiseImage(128));
    expect(q.issues.some((i) => i.includes("分辨率过低"))).toBe(true);
    expect(q.score).toBeLessThan(100);
  });

  it("文件过小（低分辨率纯色小图）叠加扣分", () => {
    const q = scorePortraitPng(flatImage(64));
    expect(q.issues.some((i) => i.includes("文件过小"))).toBe(true);
    expect(q.score).toBeLessThan(40);
  });

  it("非 PNG / 损坏字节：0 分并标注无法解码", () => {
    const q = scorePortraitPng(new Uint8Array([1, 2, 3, 4, 5]));
    expect(q.score).toBe(0);
    expect(q.issues[0]).toContain("无法解码");
  });
});

describe("needsRegeneration —— 阈值边界", () => {
  it("低于 60 分判为需要重新生成", () => {
    const bad = scorePortraitPng(flatImage(256));
    const good = scorePortraitPng(noiseImage(512));
    expect(needsRegeneration(bad)).toBe(true);
    expect(needsRegeneration(good)).toBe(false);
  });
});
