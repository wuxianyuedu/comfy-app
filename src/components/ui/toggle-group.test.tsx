// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

afterEach(cleanup);

function renderPair() {
  render(
    <ToggleGroup value={["b"]} multiple={false} aria-label="测试分段控件">
      <ToggleGroupItem value="a">甲</ToggleGroupItem>
      <ToggleGroupItem value="b">乙</ToggleGroupItem>
    </ToggleGroup>,
  );
  return screen.getAllByRole("button");
}

/**
 * 选中档的三层（描边 / 字重 / 抬层）是本仓库在 `ui/toggle-group` 上做的有意定制
 * （规范 16 §16.8 台账）。这里钉住它 —— 因为官方版只有 `data-pressed:bg-muted`，
 * 而 `toggleVariants()` 的**悬停档是同一个值**，划过未选中项就会长得像选中项。
 */
describe("ToggleGroupItem 的选中档", () => {
  it("描边 + 字重挂在 pressed 档上（不与悬停撞），且抬层不被邻项盖住", () => {
    for (const item of renderPair()) {
      const pressed = (item.className.match(/data-pressed:\S+/g) ?? []).join(
        " ",
      );
      expect(pressed).toContain("ring-1");
      expect(pressed).toContain("ring-primary/45");
      expect(pressed).toContain("font-semibold");
      expect(pressed).toContain("z-10");
    }
  });

  it("悬停档仍是官方版那个底色（本次不靠改悬停解决，两层并存才读得出差别）", () => {
    for (const item of renderPair()) {
      expect(item.className).toContain("hover:bg-muted");
    }
  });

  it("选中语义照旧由基元持有：aria-pressed 跟着 value 走", () => {
    const [a, b] = renderPair();
    if (!a || !b) throw new Error("只渲染出两个 item");
    expect(a).toHaveAttribute("aria-pressed", "false");
    expect(b).toHaveAttribute("aria-pressed", "true");
  });
});
