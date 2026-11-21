/**
 * 侧栏「项目」分组在缩略态（图标轨，窗口窄于 `NAV_EXPANDED_MIN_PX`）也要能按名字找到项目
 * （ISSUE #1691）：此前整组挂 `group-data-[collapsible=icon]:hidden` 直接消失。判 DOM 而非源码 ——
 * 每条按钮要有图标、并作为 tooltip 触发器（基元只在 collapsed 时渲染内容，故判接线而非文案）。
 */ import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";
import { tabKey } from "./workspace-tabs";

/* CommandPalette 新增的「其他」组用 useRouter 导航：测试环境没有 App Router 上下文，按
 * BrowserStatusBar 用例的同一约定在渲染入口 mock 掉（真实链路在 workspace 页里）。 */
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

const PROJECTS = [
  { id: "proj_a", name: "城市夜景" },
  { id: "proj_b", name: "角色设定集" },
];

function renderShell() {
  const onOpenProject = vi.fn();
  const { container } = render(
    <AppShell
      active="home"
      activeProjectId="proj_a"
      onNewProject={vi.fn()}
      onOpenProject={onOpenProject}
      onOpenSettings={vi.fn()}
      onSelect={vi.fn()}
      onShowAllProjects={vi.fn()}
      projects={PROJECTS}
    >
      <div />
    </AppShell>,
  );
  return { container, onOpenProject };
}

/** 「项目」分组 = 含「查看全部」那一条按钮的那个 `data-slot="sidebar-group"`。 */
function projectGroup(): HTMLElement {
  const btn = screen.getByRole("button", { name: "查看全部" });
  const group = btn.closest('[data-slot="sidebar-group"]');
  if (!(group instanceof HTMLElement)) {
    throw new Error("没找到「项目」分组容器（data-slot=sidebar-group）");
  }
  return group;
}

describe("侧栏「项目」分组的缩略态", () => {
  it("分组不再在图标档整组隐藏", () => {
    renderShell();
    /* 这是这一条 bug 的正面判据：`hidden` 在图标档把整组拿掉，用户就没得选了。
       只看「渲染出了几条」不够 —— jsdom 里没有窄窗，那个类在展开态同样不影响
       渲染结果，漏掉它用例照样绿。 */
    expect(projectGroup().className).not.toContain("group-data-[collapsible=icon]:hidden");
  });

  it("每条项目按钮里都有图标与名字（收起后不是空格子）", () => {
    renderShell();
    for (const project of PROJECTS) {
      const btn = screen.getByRole("button", { name: project.name });
      expect(btn.querySelector("svg")).not.toBeNull();
      expect(btn.textContent).toContain(project.name);
    }
  });

  it("每条项目按钮都挂上了 tooltip 触发器（缩略态的名字出口）", () => {
    /* 用例不用 `container` —— 名字出口挂在按钮自己身上。 */
    renderShell();
    for (const project of PROJECTS) {
      const btn = screen.getByRole("button", { name: project.name });
      /* 判的是**「接线接上了没」**，不是气泡里的字：基元把内容挡在 `hidden={state !== "collapsed"}`
         后面，且 base-ui 的 Popup 只在打开时挂载 —— jsdom 里没有窄窗也没有悬停，气泡永不出现。
         同时反证「名字只有这一个出口」：按钮内 `<span>` 收起后被基元压成零宽，无处悬停即无字可读。 */
      expect(btn.dataset.baseUiTooltipTrigger !== undefined, `${project.name} 没接 tooltip`).toBe(
        true,
      );
    }
  });

  it("「查看全部 / 新建项目」也在同一个分组里、也带图标", () => {
    renderShell();
    const group = projectGroup();
    for (const label of ["查看全部", "新建项目"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(group.contains(btn)).toBe(true);
      expect(btn.querySelector("svg")).not.toBeNull();
    }
  });
});

/**
 * 项目的「界面打开」态（ISSUE #4770）：项目有开着的项目类页签时，这一行与上方
 * 导航项同一套表达 —— 图标落进品牌色浅底胶片（打开态），悬停浮现关闭按钮；
 * 关闭关掉这个项目开着的**全部**页签（侧栏行表达的是项目界面这个整体）。
 */
describe("侧栏「项目」分组的打开态（ISSUE #4770）", () => {
  const tabs = [
    { key: tabKey("project", "proj_a"), projectId: "proj_a", view: "project" as const },
    { key: tabKey("workshop", "proj_a"), projectId: "proj_a", view: "workshop" as const },
  ];

  function renderWithTabs() {
    const onCloseViewTab = vi.fn();
    render(
      <AppShell
        active="project"
        activeProjectId="proj_a"
        onCloseViewTab={onCloseViewTab}
        onNewProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenSettings={vi.fn()}
        onSelect={vi.fn()}
        onShowAllProjects={vi.fn()}
        projects={PROJECTS}
        viewTabs={tabs}
      >
        <div />
      </AppShell>,
    );
    return onCloseViewTab;
  }

  it("开着页签的项目：图标住进打开态胶片（data-open-state），行是当前项目时高亮", () => {
    renderWithTabs();
    const openBtn = screen.getByRole("button", { name: "城市夜景" });
    expect(openBtn.querySelector('[data-open-state="true"]')).not.toBeNull();
    expect(openBtn.dataset.active).toBeDefined();
    /* 没开页签的项目：没有胶片，也没有关闭按钮。 */
    const idleBtn = screen.getByRole("button", { name: "角色设定集" });
    expect(idleBtn.querySelector('[data-open-state="true"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭 角色设定集 页签" })).toBeNull();
  });

  it("关闭按钮关掉这个项目开着的全部页签（逐个 key 交给 onCloseViewTab）", () => {
    const onCloseViewTab = renderWithTabs();
    fireEvent.pointerDown(screen.getByRole("button", { name: "关闭 城市夜景 页签" }));
    expect(onCloseViewTab).toHaveBeenCalledTimes(tabs.length);
    for (const tab of tabs) {
      expect(onCloseViewTab).toHaveBeenCalledWith(tab.key);
    }
  });
});
