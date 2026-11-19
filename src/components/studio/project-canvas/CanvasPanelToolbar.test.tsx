import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { CanvasPanelToolbar } from "./CanvasPanelToolbar";

afterEach(cleanup);

/**
 * 画布面板工具条（素材库 / 历史记录）的悬停回归（ISSUE #1925）。
 * 这枚是开关而非单选 radio；`ghost` 自带 hover 会盖过原来没写 `hover:` 的选中档，
 * 划过当前打开项时紫色翻成灰底黑字（ISSUE #1423）。这里钉：选中档钉住悬停值，与常态同值。
 */
describe("CanvasPanelToolbar 打开面板的那一枚（ISSUE #1925）", () => {
  it("选中档同时钉住悬停底色与字色（不会被 ghost 的默认悬停档改写）", () => {
    render(<CanvasPanelToolbar active="materials" floating onSelect={vi.fn()} />);
    const tokens = new Set(screen.getByRole("button", { name: "素材库" }).className.split(/\s+/));
    expect(tokens.has("bg-primary/20")).toBe(true);
    /* 关键的那两条：选中档自己带 hover 覆盖，且值就是常态值。 */
    expect(tokens.has("hover:bg-primary/20")).toBe(true);
    expect(tokens.has("hover:text-primary-strong")).toBe(true);
  });

  it("未选中的那一枚不带选中态配色（区别仍读得出来）", () => {
    render(<CanvasPanelToolbar active="materials" floating onSelect={vi.fn()} />);
    const tokens = new Set(screen.getByRole("button", { name: "历史记录" }).className.split(/\s+/));
    expect(tokens.has("bg-primary/20")).toBe(false);
    expect(tokens.has("hover:bg-subtle")).toBe(true);
  });
});
