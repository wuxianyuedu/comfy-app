/**
 * 侧栏打开项的页签态（ISSUE #3740）：某项的视图页签开着时，侧栏项要表达「这一页开着」
 * —— 图标换打开态（品牌色角点），并在悬停 / 聚焦时浮现关闭按钮（点它走
 * `onCloseViewTab`，关的是那一页的页签）。首页是固定页签：永不出现打开态与关闭按钮。
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
  it("开着页签的那几项，图标带打开态角点（品牌色实心点，形状通道）", () => {
    renderShell({ active: "home", tabs: tabsOf("home", "models", "console") });
    for (const label of ["模型", "控制台"]) {
      const dot = screen
        .getByRole("button", { name: label })
        .querySelector('span[aria-hidden="true"]');
      expect(dot, `${label} 应有打开态角点`).not.toBeNull();
      expect(dot?.className).toContain("rounded-full");
    }
  });

  it("没开页签的项没有角点，也没有关闭按钮", () => {
    renderShell({ active: "home", tabs: tabsOf("home", "models") });
    expect(
      screen.getByRole("button", { name: "历史" }).querySelector('span[aria-hidden="true"]'),
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
      screen.getByRole("button", { name: "首页" }).querySelector('span[aria-hidden="true"]'),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭 首页 页签" })).toBeNull();
  });

  it("没传 viewTabs（旧调用方）时整格静默：无角点、无关闭按钮，导航照旧", () => {
    const { onSelect } = renderShell({ active: "home" });
    expect(screen.queryByRole("button", { name: "关闭 模型 页签" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(onSelect).toHaveBeenCalledWith("models");
  });
});
