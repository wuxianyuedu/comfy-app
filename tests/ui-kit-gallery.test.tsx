import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { UIKitGallery } from "~/components/ui/ui-kit-gallery";

afterEach(cleanup);

/**
 * UI 控件总览页（`/ui-kit`，ISSUE #3525）冒烟判据：这一页的用途是「把全部基元
 * 摆到一屏检查颜色 / 背景错档」，所以只钉三件结构性的事 —— 分组标题齐全、
 * token 墙在页、主题开关可操作；逐基元的 props 矩阵归 Storybook，不在这里重复。
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
});
