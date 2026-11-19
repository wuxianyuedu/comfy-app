/** tooltip 气泡的限高与滚动条口径（源级钉住，防回退）。
 * 不做渲染断言：happy-dom 不做布局，Base UI Positioner 的 `--available-height`
 * 算不出来（同 `multi-mode-select.test.ts` 的取舍）。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.resolve(__dirname, "tooltip.tsx"), "utf8");

describe("TooltipContent 气泡（ui/tooltip）", () => {
  it("限高与滚动能力保留（#4188：不超过定位器给出的可用空间，超限仍可滚）", () => {
    expect(source).toContain("max-h-(--available-height)");
    expect(source).toContain("overflow-y-auto");
  });

  it("不显示滚动条（#4512：气泡出现瞬间箭头溢出不该闪现一道滚动条）", () => {
    expect(source).toContain("scrollbar-none");
  });
});
