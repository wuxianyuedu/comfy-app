/**
 * 侧栏打开项的页签态（ISSUE #3740）：某项的视图页签开着时，侧栏项要表达「这一页开着」
 * —— 图标落进品牌色浅底胶片，并在悬停 / 聚焦时浮现关闭按钮（点它走
 * `onCloseViewTab`，关的是那一页的页签）。首页是固定页签：永不出现打开态与关闭按钮。
 * 顶部视图页签条不再渲染侧栏常驻项的页签（#3740 追加反馈）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";
import type { WorkspaceView } from "./NavItems";
import { tabKey, type ViewTab } from "./workspace-tabs";

/* CommandPalette 用 useRouter：测试环境没有 App Router 上下文，按既有用例的同一约定 mock。 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

/* jsdom 没有 `matchMedia`，`ui/sidebar` 挂载时就读它（与既有测试同一份桩）。 */
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {
      void 0;
    },
    removeListener() {
      void 0;
    },
    addEventListener() {
      void 0;
    },
    removeEventListener() {
      void 0;
    },
    dispatchEvent() {
      return false;
    },
  });
}

afterEach(cleanup);

/** 造一组全局视图的打开页签（全局项无项目维度，projectId 恒 null）。 */
function tabsOf(...views: Array<WorkspaceView>): Array<ViewTab> {
  return views.map((view) => ({ key: tabKey(view, null), projectId: null, view }));
}

function renderShell(opts: { active?: WorkspaceView; tabs?: Array<ViewTab> } = {}): {
  onCloseViewTab: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
} {
  const onCloseViewTab = vi.fn();
  const onSelect = vi.fn();
  render(
    <AppShell
      active={opts.active ?? "home"}
      activeProjectId={null}
      onCloseViewTab={onCloseViewTab}
      onNewProject={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenSettings={vi.fn()}
      onSelect={onSelect}
      onShowAllProjects={vi.fn()}
      projects={[]}
      viewTabs={opts.tabs ?? []}
    >
      <div />
    </AppShell>,
  );
  return { onCloseViewTab, onSelect };
}

describe("侧栏打开项的页签态（ISSUE #3740）", () => {
  it("开着页签的那几项，图标住进品牌色浅底胶片（打开态，不像通知角点）", () => {
    renderShell({ active: "home", tabs: tabsOf("home", "models", "console") });
    for (const label of ["模型", "控制台"]) {
      const chip = screen
        .getByRole("button", { name: label })
        .querySelector('[data-open-state="true"]');
      expect(chip, `${label} 应有打开态胶片`).not.toBeNull();
      expect(chip?.className).toContain("bg-primary-soft");
      expect(chip?.className).toContain("text-primary-strong");
    }
  });

  it("没开页签的项没有胶片，也没有关闭按钮", () => {
    renderShell({ active: "home", tabs: tabsOf("home", "models") });
    expect(
      screen.getByRole("button", { name: "历史" }).querySelector('[data-open-state="true"]'),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭 历史 页签" })).toBeNull();
  });

  it("开着的那项有关闭按钮，点它把那一页的页签 key 交给 onCloseViewTab", () => {
    const { onCloseViewTab } = renderShell({
      active: "home",
      tabs: tabsOf("home", "models", "console"),
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭 控制台 页签" }));
    expect(onCloseViewTab).toHaveBeenCalledTimes(1);
    expect(onCloseViewTab).toHaveBeenCalledWith(tabKey("console", null));
  });

  it("点关闭按钮不会顺带触发 onSelect（关闭是兄弟控件，不进导航）", () => {
    const { onSelect } = renderShell({ active: "home", tabs: tabsOf("home", "models") });
    fireEvent.click(screen.getByRole("button", { name: "关闭 模型 页签" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("首页是固定页签：即使它在打开列表里，也没有打开态与关闭按钮", () => {
    renderShell({ active: "home", tabs: tabsOf("home", "models") });
    expect(
      screen.getByRole("button", { name: "首页" }).querySelector('[data-open-state="true"]'),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭 首页 页签" })).toBeNull();
  });

  it("顶部页签条不渲染侧栏常驻项的页签（设置等瞬时页签仍渲染）", () => {
    renderShell({
      active: "home",
      tabs: tabsOf("home", "models", "console", "settings"),
    });
    /* 常驻项（首页除外也一并不再进页签条） */
    expect(screen.queryByRole("tab", { name: "首页" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "模型" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "控制台" })).toBeNull();
    /* 不在侧栏的瞬时页签照常进页签条 */
    expect(screen.getByRole("tab", { name: "设置" })).not.toBeNull();
  });

  it("没传 viewTabs（旧调用方）时整格静默：无角点、无关闭按钮，导航照旧", () => {
    const { onSelect } = renderShell({ active: "home" });
    expect(screen.queryByRole("button", { name: "关闭 模型 页签" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(onSelect).toHaveBeenCalledWith("models");
  });
});
