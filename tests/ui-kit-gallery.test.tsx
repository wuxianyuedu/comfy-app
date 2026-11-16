import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { UI_KIT_CATEGORIES } from "~/components/ui/ui-kit-gallery-categories";
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
      "基元 UI 速览",
      "按钮、徽标与状态件",
      "输入与选择",
      "浮层与对话框",
      "导航与布局",
      "反馈与状态",
      "数据展示与杂项",
    ]) {
      /* ISSUE #4125：左侧大类导航也列出同名标题 ⇒ 每个标题出现两次（导航 + 分区），
         这里只钉「至少出现一次」。锚点与分区 id 的一一对应另有一条专门测。 */
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });

  /**
   * ISSUE #4110：基元 UI 单独成区 —— 速览区必须在 token 墙之后、第一个功能分区
   * 之前，且每枚核心基元都带可访问名称 / 标签（速览区是给明暗两态「一眼扫」的，
   * 控件没有可访问名就既不可读也不可测）。钉住顺序与内容，避免它被挪到末尾或被删。
   */
  it("基元 UI 速览区在 token 墙之后、功能分区之前，核心基元带可访问名", () => {
    const { container } = render(<UIKitGallery />);
    const sections = [...container.querySelectorAll("section")];
    const sectionOf = (title: string) =>
      sections.findIndex((section) => section.textContent?.includes(title));
    const tokenAt = sectionOf("语义 token 墙");
    const overviewAt = sectionOf("基元 UI 速览");
    const firstDetailAt = sectionOf("按钮、徽标与状态件");
    expect(tokenAt).toBeGreaterThanOrEqual(0);
    expect(overviewAt).toBeGreaterThan(tokenAt);
    expect(firstDetailAt).toBeGreaterThan(overviewAt);

    /* 可访问名：按 aria-label 精确捞，捞不到即红（不会误中功能分区里的同类控件）。 */
    expect(screen.getByRole("button", { name: "速览收藏" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "速览输入框" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "速览开关" })).toBeInTheDocument();
    /* 内容锚：核心基元的记号标签在速览区那一节里各出现一次（限定在该 section 内）。 */
    /* overviewAt 上面已断言 >= 0；索引取值兜一个空 section，缺失时下面的内容锚必失败。 */
    const overviewSection = sections[overviewAt] ?? document.createElement("section");
    for (const label of [
      "Button",
      "Toggle",
      "Input / Textarea",
      "Checkbox / Switch",
      "Badge / StatusBadge",
    ]) {
      expect(
        [...overviewSection.querySelectorAll("span")].some((s) => s.textContent === label),
      ).toBe(true);
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

  /**
   * ISSUE #4125：左侧大类导航 —— 八个分区各有锚点链接，href 指向对应分区 id，
   * 且每个 id 在页面里真有落点（否则点过去跳空）。清单与分区共用 ui-kit-gallery-categories。
   */
  it("左侧大类导航的锚点一一对应分区 id", () => {
    const { container } = render(<UIKitGallery />);
    const nav = screen.getByRole("navigation", { name: "控件分类" });
    const links = [...nav.querySelectorAll("a")];
    expect(links).toHaveLength(UI_KIT_CATEGORIES.length);
    for (const [i, category] of UI_KIT_CATEGORIES.entries()) {
      expect(links[i]).toHaveAttribute("href", `#${category.id}`);
      expect(container.querySelector(`#${category.id}`)).toBeInTheDocument();
    }
  });

  /** ISSUE #4125：大标题去掉 —— 唯一 h1 以 sr-only 留在 DOM（读屏可跳转），无可见 h1。 */
  it("页头标题仅读屏可见，页面只有一个 h1", () => {
    const { container } = render(<UIKitGallery />);
    const headings = [...container.querySelectorAll("h1")];
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("UI 控件总览");
    expect(headings[0]?.className).toContain("sr-only");
  });

  /** ISSUE #4125：补全的基元都有一枚代表形态落在对应分区（按可访问名 / 记号标签锚定）。 */
  it("补全的基元在对应分区可见", () => {
    const { container } = render(<UIKitGallery />);
    const labels = [
      "Icon",
      "Separator",
      "TruncatedText",
      "StepperInput（悬浮步进）",
      "SelectMenu（深色定制下拉）",
      "MultiSegmentPopover（分段选择）",
      "FilePickerButton（文件选择）",
      "MediaThumbnail（媒体缩略图）",
      "StatusButton（状态行专用按钮）",
    ];
    for (const label of labels) {
      expect(
        [...container.querySelectorAll("span")].some((span) => span.textContent === label),
      ).toBe(true);
    }
    /* PageHeader 以 h2 展示（不制造第二个 h1）。 */
    expect(screen.getByRole("heading", { level: 2, name: "页头示例" })).toBeInTheDocument();
  });
});
