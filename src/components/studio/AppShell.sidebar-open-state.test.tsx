/**
 * 侧栏打开项的页签态（ISSUE #3740）：某项的视图页签开着时，侧栏项要表达「这一页开着」
 * —— 图标落进品牌色浅底胶片，并在悬停 / 聚焦时浮现关闭按钮（点它走
 * `onCloseViewTab`，关的是那一页的页签）。首页是固定页签：永不出现打开态与关闭按钮。
 * 顶部页签栏已退役（ISSUE #4770）：瞬时页签改在侧栏「临时页签」组列出，常驻项不重复列。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";
import { ToastProvider } from "./ToastProvider";
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

function renderShell(
  opts: { active?: WorkspaceView; defaultSidebarOpen?: boolean; tabs?: Array<ViewTab> } = {},
): {
  onCloseViewTab: ReturnType<typeof vi.fn>;
  onSelect: ReturnType<typeof vi.fn>;
} {
  const onCloseViewTab = vi.fn();
  const onSelect = vi.fn();
  render(
    /* 「项目」分组挂了 useToast（删除回执）：按应用真实层级包上 Provider。 */
    <ToastProvider>
      <AppShell
        active={opts.active ?? "home"}
        activeProjectId={null}
        defaultSidebarOpen={opts.defaultSidebarOpen}
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
      </AppShell>
    </ToastProvider>,
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
    /* 关闭走 pointerDown（ISSUE #3789）：行级 tooltip 收起引发的重渲染会让
       真实点击的 click 事件落到行 <li> 上；pointerdown 阶段目标稳定。 */
    fireEvent.pointerDown(screen.getByRole("button", { name: "关闭 控制台 页签" }));
    expect(onCloseViewTab).toHaveBeenCalledTimes(1);
    expect(onCloseViewTab).toHaveBeenCalledWith(tabKey("console", null));
  });

  it("点关闭按钮不会顺带触发 onSelect（关闭是兄弟控件，不进导航）", () => {
    const { onSelect } = renderShell({ active: "home", tabs: tabsOf("home", "models") });
    fireEvent.pointerDown(screen.getByRole("button", { name: "关闭 模型 页签" }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("首页是固定页签：即使它在打开列表里，也没有打开态与关闭按钮", () => {
    renderShell({ active: "home", tabs: tabsOf("home", "models") });
    expect(
      screen.getByRole("button", { name: "首页" }).querySelector('[data-open-state="true"]'),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭 首页 页签" })).toBeNull();
  });

  it("侧栏常驻项不进「临时页签」组；设置这类瞬时页签列在那里（ISSUE #4770）", () => {
    renderShell({
      active: "home",
      tabs: tabsOf("home", "models", "console", "settings"),
    });
    /* 「临时页签」组 = 带「临时页签」组标签的那个 sidebar-group。 */
    const tempGroup = screen
      .getAllByText("临时页签")
      .map((node) => node.closest('[data-slot="sidebar-group"]'))
      .find((group): group is HTMLElement => group instanceof HTMLElement);
    expect(tempGroup).toBeDefined();
    const names = [...tempGroup!.querySelectorAll("button")].map((btn) => btn.textContent);
    /* 常驻项（首页 / 模型 / 控制台）不重复列；不在侧栏的瞬时页签（设置）列在这里。 */
    expect(names.join("|")).not.toContain("首页");
    expect(names.join("|")).not.toContain("控制台");
    expect(names.some((name) => name?.includes("设置"))).toBe(true);
  });

  it("没传 viewTabs（旧调用方）时整格静默：无角点、无关闭按钮，导航照旧", () => {
    const { onSelect } = renderShell({ active: "home" });
    expect(screen.queryByRole("button", { name: "关闭 模型 页签" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(onSelect).toHaveBeenCalledWith("models");
  });
});

/* ── 折叠态（图标轨）的关闭按钮（ISSUE #4981）────────────────────────────
 * 此前关闭按钮挂 `group-data-[collapsible=icon]:hidden`，折叠后想关页签必须先
 * 展开侧栏。现在折叠态收成图标右上角的角标，悬停 / 聚焦浮现，交互链路不变。 */
describe("折叠态侧栏的关闭按钮（ISSUE #4981）", () => {
  /** 折叠前提先验：侧栏真处于 `data-collapsible=icon`，后面的类断言才有意义。 */
  function expectCollapsedContext() {
    const collapsed = document.querySelector('[data-collapsible="icon"]');
    expect(collapsed, "侧栏应处于折叠（图标轨）态").not.toBeNull();
  }

  it("折叠态下开着页签的项，关闭按钮不再被藏，改为图标右上角角标", () => {
    renderShell({
      active: "home",
      tabs: tabsOf("home", "models"),
      defaultSidebarOpen: false,
    });
    expectCollapsedContext();
    const close = screen.getByRole("button", { name: "关闭 模型 页签" });
    expect(close.className).not.toContain("group-data-[collapsible=icon]:hidden");
    expect(close.className).toContain("group-data-[collapsible=icon]:top-0.5");
    expect(close.className).toContain("group-data-[collapsible=icon]:right-0.5");
    expect(close.className).toContain("group-data-[collapsible=icon]:size-4");
  });

  it("折叠态点关闭按钮仍走 pointerdown → onCloseViewTab（链路不回退）", () => {
    const { onCloseViewTab } = renderShell({
      active: "home",
      tabs: tabsOf("home", "console"),
      defaultSidebarOpen: false,
    });
    fireEvent.pointerDown(screen.getByRole("button", { name: "关闭 控制台 页签" }));
    expect(onCloseViewTab).toHaveBeenCalledWith(tabKey("console", null));
  });

  it("展开态回归：关闭按钮仍是行右缘形态（right-2），无折叠隐藏类", () => {
    renderShell({ active: "home", tabs: tabsOf("home", "models"), defaultSidebarOpen: true });
    const close = screen.getByRole("button", { name: "关闭 模型 页签" });
    expect(close.className).toContain("right-2");
    expect(close.className).not.toContain("group-data-[collapsible=icon]:hidden");
  });
});
