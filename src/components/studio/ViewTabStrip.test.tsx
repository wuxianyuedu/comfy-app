// 视图页签条。三件判据各有其所以然：
//   · 标签文案必须来自 NAV_ITEMS 那一份表（另写一张就会长出「侧栏叫队列、页签叫排队」）；
//   · 项目类页签要带项目名 —— 同一视图开两页时，只有视图名分不清哪页是哪个项目；
//   · 首页那一页不给关闭按钮（可关性是 workspace-tabs 的规则，视图只问不判）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ViewTabStrip, viewTabLabel } from "./ViewTabStrip";
import { HOME_VIEW, initialWorkspaceTabs, openViewTab } from "./workspace-tabs";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function strip(over: Partial<Parameters<typeof ViewTabStrip>[0]> = {}) {
  const state = openViewTab(openViewTab(initialWorkspaceTabs(), "queue", null), "workshop", "p1");
  return render(
    <ViewTabStrip
      tabs={state.tabs}
      activeKey={state.activeKey}
      projectNameOf={(id) => (id === "p1" ? "雾中来信" : null)}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      {...over}
    />,
  );
}

describe("viewTabLabel", () => {
  it("取 NAV_ITEMS 那份标签，不另写一张表", () => {
    expect(viewTabLabel("queue")).toBe("队列");
    expect(viewTabLabel("workshop")).toBe("工坊");
  });

  it("项目类页签带项目名（同一视图两页要分得开）", () => {
    expect(viewTabLabel("workshop", "雾中来信")).toBe("工坊·雾中来信");
  });

  it("项目名缺失或空白时退化为只显视图名，不显示 undefined", () => {
    expect(viewTabLabel("workshop", null)).toBe("工坊");
    expect(viewTabLabel("workshop", "   ")).toBe("工坊");
  });

  it("未知视图原样回显，不套一个最近的标签", () => {
    expect(viewTabLabel(/* SAFETY: 类型断言已复核 */ "nope" as never)).toBe("nope");
  });
});

describe("ViewTabStrip", () => {
  it("每页一个 tab，当前页 aria-selected，且整条有可访问名", () => {
    strip();
    const list = screen.getByRole("tablist", { name: "已打开的视图" });
    expect(list).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[2]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
  });

  it("标签渲染出项目名形态（工坊·雾中来信）", () => {
    strip();
    expect(screen.getByText("工坊·雾中来信")).toBeTruthy();
  });

  it("首页那一页没有关闭按钮，其余有", () => {
    strip();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    // 3 页里首页不可关 ⇒ 只有 2 个关闭按钮
    expect(screen.getAllByRole("button", { name: /^关闭 / })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: `关闭 首页` })).toBeNull();
  });

  it("点页签回抛 key；点关闭只回抛关闭、不重复触发选中", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    strip({ onSelect, onClose });
    fireEvent.click(screen.getByText("队列"));
    expect(onSelect).toHaveBeenCalledWith("queue:");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "关闭 工坊·雾中来信" }));
    expect(onClose).toHaveBeenCalledWith("workshop:p1");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("键盘 Space/Enter 能激活（标题行里不能只靠鼠标）", () => {
    const onSelect = vi.fn();
    strip({ onSelect });
    fireEvent.keyDown(screen.getByText("队列"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("queue:");
  });

  it("只剩首页一页时也照常渲染（不塌成空条）", () => {
    const state = initialWorkspaceTabs();
    render(
      <ViewTabStrip
        tabs={state.tabs}
        activeKey={state.activeKey}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const tab = screen.getByRole("tab");
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(tab.textContent).toContain("首页");
    expect(HOME_VIEW).toBe("home");
  });
});

/**
 * 选中态的源码级判据。
 *
 * 为什么落在源码而不是渲染：壳里那条标题行形态（`inTitleBar` 与 iframe 页签）在
 * 浏览器/dev 下**不存在**，e2e 走不到；而当初的缺陷恰好只在那条路径上 —— 选中态给
 * `bg-canvas/70`（#0a0a0f），压在 #0f0f16 的标题行上**比底还暗**，与未选中只差一档
 * 文字色，肉眼读不出当前页。渲染判据管不到的那一半，至少要有人钉住形状。
 */
const ROOT = path.resolve(__dirname, "../../..");

/** 剥块注释再判：说明文字里提到 `bg-canvas` 不算有人这么写。 */
function codeOf(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("两类页签共用一套选中态（壳内形态 e2e 到不了）", () => {
  it.for(
    /* SAFETY: 类型断言已复核 */ [
      "src/components/studio/ViewTabStrip.tsx",
      "src/components/studio/TitleBarTabs.tsx",
    ] as const,
  )("%s 的 active 分支只走 u-tab-active，不自己写背景", (rel) => {
    const code = codeOf(rel);
    expect(
      /active\s*\?\s*"[^"]*u-tab-active[^"]*"/.test(code),
      `${rel} 的选中分支没有走 .u-tab-active`,
    ).toBe(true);
    /* 选中分支里自带背景类 = 那一处会脱离工具类单独漂移。当初就是这个形状。 */
    expect(/active\s*\?\s*"[^"]*\bbg-/.test(code), `${rel} 在选中分支里直接写了背景类`).toBe(false);
  });

  it(".u-tab-active 不是空类：给了更亮的表面，也给了一条品牌色条", () => {
    const css = codeOf("src/app/globals.css");
    const block = /\.u-tab-active\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const bar = /\.u-tab-active::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block, "缺背景（或没取 surface token）").toContain("var(--color-surface)");
    expect(bar, "缺顶部色条的高度").toContain("height: 2px");
    expect(bar, "色条没取品牌渐变 token").toContain("var(--gradient-brand)");
  });
});
