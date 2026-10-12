/**
 * 精简窗口标题行（整屏路由页自带的那条 chrome）的两条契约。
 *
 * 背景（ISSUE #1794 第二次修正）：错误页 / 404 / global-error / 登录页一显示，
 * `ShellTabs`（含 `TitleBarTabs` 与右上角的最小化 / 最大化 / **关闭**）整个
 * 卸载 —— 第一次修复只让位（`top-title-bar`），让出来的是一条不在 DOM 里的
 * 标题行，用户实测「处理过还是会被盖住」。正确形态是这些页面**自带**标题行，
 * 本文件守的就是它：
 *
 *   1. **壳态渲染**：标题行在（`data-slot="title-bar"`，与 `TitleBarTabs` 同
 *      名标记，e2e 按它找 chrome），三个窗口按钮齐备且可访问名正确；
 *   2. **非壳态不渲染**：浏览器 / dev 由系统窗口提供标题行，再画一条既重复
 *      又占纵向空间（与 `ShellTabs` 同判据）。
 *
 * 壳形态怎么摆：`useTitleBarTabsActive` 读的是 `isDesktopShell()` 读的那个全局
 * 标记（`__TAURI_INTERNALS__`），直接打标记、不 mock 模块（同
 * `ShellTabs.test.tsx` 的手法）。窗口控制函数（minimize / toggleMaximize /
 * close）在非壳降级、壳内 jsdom 下 import 失败也会 catch 静默，所以点按钮
 * 不会把测试炸掉 —— 这里只判「按钮在、名字对」。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ShellFullPage } from "./ShellFullPage";
import { WindowTitleBar } from "./WindowTitleBar";

/** 摆形态：`true` = 桌面壳（打 Tauri 注入的全局标记），`false` = 浏览器 / dev。 */
function setShellForm(on: boolean) {
  if (on) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: { invoke: async () => null, transformCallback: () => 0 },
    });
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

afterEach(() => {
  cleanup();
  setShellForm(false);
});

describe("WindowTitleBar", () => {
  it("壳态渲染标题行与三个窗口按钮（可访问名取自窗口按钮标签表）", () => {
    setShellForm(true);
    render(<WindowTitleBar />);
    /* `data-slot` 与 `TitleBarTabs` 一致 —— e2e（overlay-boundary.spec.ts）
       按它断言「应用顶部这条 chrome 在不在」。 */
    expect(document.querySelector('[data-slot="title-bar"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "最小化" })).toBeTruthy();
    /* 初始未最大化 → 按钮语义是「最大化」（不是「向下还原」）。 */
    expect(screen.getByRole("button", { name: "最大化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });

  it("点窗口按钮不炸（壳内降级路径静默，页面该干什么干什么）", () => {
    setShellForm(true);
    render(<WindowTitleBar />);
    /* jsdom 里 `@tauri-apps/api/window` 的 import 会失败并被 catch —— 这里判的
       正是「点了没有未处理拒绝把测试炸掉」。 */
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "最小化" }));
    fireEvent.click(screen.getByRole("button", { name: "最大化" }));
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  });

  it("非壳态不渲染标题行（系统窗口自带，不重复不占位）", () => {
    setShellForm(false);
    render(<WindowTitleBar />);
    expect(document.querySelector('[data-slot="title-bar"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  });
});

describe("ShellFullPage", () => {
  it("壳态自带标题行并给子树打 data-shell（标题行高度量依赖同一套变量）", () => {
    setShellForm(true);
    const { container } = render(
      <ShellFullPage>
        <p>整屏页内容</p>
      </ShellFullPage>,
    );
    expect(container.querySelector("[data-shell]")).toBeTruthy();
    expect(document.querySelector('[data-slot="title-bar"]')).toBeTruthy();
    /* 内容照旧渲染 —— 标题行是 chrome，不吞内容。 */
    expect(screen.getByText("整屏页内容")).toBeTruthy();
  });

  it("非壳态只有内容容器（无标题行、无 data-shell）", () => {
    setShellForm(false);
    const { container } = render(
      <ShellFullPage>
        <p>整屏页内容</p>
      </ShellFullPage>,
    );
    expect(container.querySelector("[data-shell]")).toBeNull();
    expect(document.querySelector('[data-slot="title-bar"]')).toBeNull();
    expect(screen.getByText("整屏页内容")).toBeTruthy();
  });
});
