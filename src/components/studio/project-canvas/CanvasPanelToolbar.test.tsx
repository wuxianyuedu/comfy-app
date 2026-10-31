import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { CanvasPanelToolbar } from "./CanvasPanelToolbar";

afterEach(cleanup);

/**
 * 画布面板工具条（素材库 / 历史记录）的悬停回归（ISSUE #1925 第三批收口）。
 *
 * 这一枚是**开关**（再点一次收起当前面板，`onSelect(null)`），不是单选
 * radio —— 所以它不走 `SelectChip`，而是在原地把那半个接缝补上：
 * `variant="ghost"` 自带 `hover:bg-muted hover:text-foreground`，而原来的
 * 选中分支**没有写 `hover:`** ⇒ 划过**当前打开**的那一枚时悬停档胜出，
 * 紫色高亮翻成灰底黑字，看上去像「未选中」（用户原话「悬浮和非悬浮一个紫
 * 一个白」那一族，ISSUE #1423）。
 *
 * 这里钉的是：选中档**钉住悬停值**，且与常态同值。
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
