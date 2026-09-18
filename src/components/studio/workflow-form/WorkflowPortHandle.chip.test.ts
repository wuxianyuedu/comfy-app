/**
 * 端口类型 chip 的**底色随主题**（ISSUE #609）。
 *
 * 洞见：chip 的**文字色**是端口类型色（类型色例外，见 globals.css 的「固定
 * 暗色清单」），但 chip 的**底色**是「一块承载类型色的表面」，必须走 token。
 * 此前 `portChipStyle` 把底色写死成暗色档的 `#1E1A2E` / `#331A28` / `#26262E`，
 * 浅色主题下是「深底 + 深类型字」叠在浅色面板上 —— 整块读不出来（用户报
 * 「浅色下预览 IO 这些看不清」，红框圈的就是这颗 IMAGE chip）。
 *
 * 判据：底色必须是 `var(--color-…)` token（由 globals.css 两态赋值），
 * 不得是写死的 `#hex` / `rgb()`。
 */
import { describe, expect, it } from "vitest";
import { portChipStyle } from "./WorkflowPortHandle";

const CASES: [string, string][] = [
  ["IMAGE", "var(--color-chip-type-image-bg)"],
  ["MASK", "var(--color-chip-type-image-bg)"],
  ["VIDEO", "var(--color-chip-type-video-bg)"],
  ["AUDIO", "var(--color-chip-type-video-bg)"],
  ["STRING", "var(--color-border-strong)"],
  ["INT", "var(--color-border-strong)"],
];

describe("portChipStyle：底色走主题 token，文字仍是类型色", () => {
  it.each(CASES)("%s 的底色是语义 token", (type, expected) => {
    expect(portChipStyle(type).background).toBe(expected);
  });

  it("任何类型都不返回写死的 #hex / rgb 底色", () => {
    for (const type of [
      "IMAGE",
      "MASK",
      "VIDEO",
      "AUDIO",
      "STRING",
      "INT",
      "FLOAT",
      "COMBO",
      "MODEL",
      "*",
    ]) {
      expect(portChipStyle(type).background).toMatch(/^var\(--/);
    }
  });

  it("文字色仍是类型色（类型色例外，不随主题）", () => {
    expect(portChipStyle("IMAGE").color).toBe("#7C5CFC");
    expect(portChipStyle("VIDEO").color).toBe("#FF5CA8");
    expect(portChipStyle("STRING").color).toBe("#9A9AAD");
  });
});
