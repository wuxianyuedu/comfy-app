// @vitest-environment jsdom
/**
 * 侧栏选中态的**接线**判据（ISSUE #1291）。
 *
 * 对比度判据在 `tests/sidebar-state-contrast.test.ts`（量 token 的相对亮度），
 * 这里只管一件事：`isActive` 这条线有没有真的接到「选中档」上。
 *
 * 为什么单独需要这一条：修复前 `isActive` 与 `hover` 共用同一个 class
 * （`data-active:bg-sidebar-accent`）—— prop 一直接得好好的，视觉上却与「指针
 * 路过」没有区别。所以「选中走的是选中档、不是悬停档」必须由用例盯着，
 * 光看 prop 有没有传是判不出来的。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { SidebarMenuButton, SidebarProvider } from "~/components/ui/sidebar";

/* jsdom 没有 matchMedia，`use-mobile` 会直接抛。桩只求「不窄」——本文件的判据
   与视口无关（形态同 `sidebar-auto-collapse.test.tsx`）。 */
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

/** 渲染一个导航项按钮，返回它的 DOM 节点。 */
function renderButton(isActive: boolean): HTMLElement {
  render(
    <SidebarProvider>
      <SidebarMenuButton isActive={isActive}>首页</SidebarMenuButton>
    </SidebarProvider>,
  );
  return screen.getByRole("button", { name: "首页" });
}

describe("侧栏导航项选中态接到选中档（ISSUE #1291）", () => {
  it("选中时用 data-active:bg-sidebar-selected，而不是悬停档", () => {
    const btn = renderButton(true);
    expect(btn.className).toContain("data-active:bg-sidebar-selected");
    // 反例：退回「选中 = 悬停同一档」时，两级状态在结构上就不可分辨 —— 这正是
    // 修复前的形态（`data-active:bg-sidebar-accent`）。
    expect(btn.className).not.toContain("data-active:bg-sidebar-accent");
  });

  it("选中态带品牌色指示条（不靠颜色深浅单打独斗）", () => {
    const btn = renderButton(true);
    // 形状/位置通道与色彩通道正交（规范 06 §6.3 / WCAG 1.4.1）——
    // 只靠底色深浅区分，色觉障碍用户看不出选中在哪一项。
    expect(btn.className).toContain("data-active:before:opacity-100");
    expect(btn.className).toContain("before:bg-primary-strong");
  });

  it("未选中时不落 data-active，但仍保留悬停档", () => {
    const btn = renderButton(false);
    // `active` state 由 isActive 经 useRender 落到 data-active（基元的既有通道）
    expect(btn.hasAttribute("data-active")).toBe(false);
    expect(btn.className).toContain("hover:bg-sidebar-accent");
  });

  it("选中时落 data-active（与上一条互为反面）", () => {
    const btn = renderButton(true);
    expect(btn.hasAttribute("data-active")).toBe(true);
  });
});
