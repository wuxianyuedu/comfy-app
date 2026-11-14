import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { UIKitGallery } from "~/components/ui/ui-kit-gallery";

afterEach(cleanup);

/**
 * UI 控件总览页（`/ui-kit`，ISSUE #3525 / #3798）冒烟判据：这一页的用途是「把全部
 * 基元摆到一屏检查颜色 / 背景错档」，所以钉四件结构性的事 —— 分组标题齐全、
 * token 墙在页、主题开关可操作、根节点自带滚动容器（#3798 的「内容看不全」）；
 * 逐基元的 props 矩阵归 Storybook，不在这里重复。
 */

describe("UIKitGallery", () => {
  it("渲染全部分组标题", () => {
    render(<UIKitGallery />);
    for (const title of [
      "语义 token 墙",
      "按钮、徽标与状态件",
      "输入与选择",
      "浮层与对话框",
      "导航与布局",
      "反馈与状态",
      "数据展示与杂项",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("token 墙列出表面 / 文字 / 边框 token 名", () => {
    render(<UIKitGallery />);
    for (const token of ["bg-card", "text-ink-muted", "border-border-strong"]) {
      expect(screen.getAllByText(token).length).toBeGreaterThan(0);
    }
  });

  it("主题开关以当前主题（默认深色档）呈现", () => {
    render(<UIKitGallery />);
    expect(screen.getByRole("group", { name: "预览主题" })).toBeInTheDocument();
    /* ThemeProvider 默认 dark：开关初值落在「深色」那一枚（aria-pressed）。 */
    expect(screen.getByRole("button", { name: "深色" })).toHaveAttribute("aria-pressed", "true");
  });

  it("根节点是独立滚动容器，内容不会被外层裁掉（ISSUE #3798）", () => {
    const { container } = render(<UIKitGallery />);
    const root = container.querySelector('[data-slot="ui-kit-scroll"]');
    expect(root).toBeInTheDocument();
    /* 这里锁的正是缺陷本身：少了 `overflow-y-auto`，工作区页签里
       `overflow-hidden` 的外层会把下半屏基元裁掉、滚轮无处可滚。 */
    expect(root?.className).toContain("overflow-y-auto");
    expect(root?.className).toContain("custom-scrollbar");
  });

  it("两个挂载点各给一种高度：页签里撑满父级，独立路由用视口档", () => {
    const { container, rerender } = render(<UIKitGallery fillHeight />);
    expect(container.querySelector('[data-slot="ui-kit-scroll"]')?.className).toContain("h-full");
    rerender(<UIKitGallery />);
    expect(container.querySelector('[data-slot="ui-kit-scroll"]')?.className).toContain("100vh");
  });
});
