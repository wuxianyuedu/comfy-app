/** 锚定浮层的「可用高度」限高回归（ISSUE #4188）。
 * happy-dom 不做布局，base-ui Positioner 的 `--available-height` 不会算出像素，
 * 因此判据取**源码形态**（与 multi-mode-select.test.ts 同一口径）：每族浮层的
 * Popup 都必须按定位器算出的真实可用空间限高 —— 写死整屏比例（85vh / 60vh）
 * 或与触发点无关的固定档，在触发点靠下时照样溢出窗口，不许回潮。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments } from "../../../tests/helpers/strip-comments";

const CASES = [
  "popover.tsx",
  "segment-popover.tsx",
  "hover-card.tsx",
  "select-menu.tsx",
  "tooltip.tsx",
  "dropdown-menu.tsx",
  "select.tsx",
  "context-menu.tsx",
  "multi-mode-select.tsx",
] as const;

function readSource(file: string): string {
  return stripComments(readFileSync(path.resolve(__dirname, file), "utf8"));
}

describe("锚定浮层按 --available-height 限高（ISSUE #4188）", () => {
  for (const file of CASES) {
    it(`${file} 的 Popup 按定位器的 --available-height 限高`, () => {
      expect(readSource(file)).toContain("max-h-(--available-height)");
    });
  }

  it("写死整屏比例 / 旧固定档的限高不回潮", () => {
    expect(readSource("segment-popover.tsx")).not.toContain("max-h-[min(60vh,460px)]");
    expect(readSource("multi-mode-select.tsx")).not.toContain("max-h-[85vh]");
    expect(readSource("select-menu.tsx")).not.toContain("max-h-96");
  });
});
