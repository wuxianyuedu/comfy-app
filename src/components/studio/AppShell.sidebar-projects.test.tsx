/**
 * 侧栏「项目」分组在缩略态（图标轨，窗口窄于 `NAV_EXPANDED_MIN_PX`）也要能按名字找到项目
 * （ISSUE #1691）：此前整组挂 `group-data-[collapsible=icon]:hidden` 直接消失。判 DOM 而非源码 ——
 * 每条按钮要有图标、并作为 tooltip 触发器（基元只在 collapsed 时渲染内容，故判接线而非文案）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";
import { ToastProvider } from "./ToastProvider";
import { tabKey } from "./workspace-tabs";
import { renameProject } from "~/lib/project-canvas/canvas-store";

/* CommandPalette 新增的「其他」组用 useRouter 导航：测试环境没有 App Router 上下文，按
 * BrowserStatusBar 用例的同一约定在渲染入口 mock 掉（真实链路在 workspace 页里）。 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

/* 改名动作走 store（真实链路在 canvas-store → 服务端）：组件用例只判接线 ——
 * 菜单 → 对话框 → `renameProject(id, 新名)` 的参数与收起时机。importOriginal
 * 保留其余导出（对话框的重名预览 `findNextAvailableName` 用真的）。 */
vi.mock("~/lib/project-canvas/canvas-store", async (importOriginal) => ({
  /* SAFETY: 展开真实模块、只覆写 renameProject —— 其余导出保持原样。 */
  ...(await importOriginal<Record<string, unknown>>()),
  renameProject: vi.fn(),
}));

/** 输入框守卫：`getByPlaceholderText` 只给 HTMLElement，收窄用类型守卫不用断言。 */
function asInput(el: Element): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) {
    throw new Error("改名输入框没渲染成 <input>");
  }
  return el;
}

/** 按钮守卫：与 `asInput` 同一收口（收窄用类型守卫不用断言）。 */
function asButton(el: Element): HTMLButtonElement {
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error("按钮没渲染成 <button>");
  }
  return el;
}

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

function renderShell(handlers: { onDeleteProject?: (id: string) => void } = {}) {
  const onOpenProject = vi.fn();
  const { container } = render(
    /* 「项目」分组的右键菜单会用到 toast（删除成功回执）：ToastProvider 在应用里
       由根布局全局挂载，这里按真实层级包上。 */
    <ToastProvider>
      <AppShell
        active="home"
        activeProjectId="proj_a"
        onDeleteProject={handlers.onDeleteProject}
        onNewProject={vi.fn()}
        onOpenProject={onOpenProject}
        onOpenSettings={vi.fn()}
        onSelect={vi.fn()}
        onShowAllProjects={vi.fn()}
        projects={PROJECTS}
      >
        <div />
      </AppShell>
    </ToastProvider>,
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
      <ToastProvider>
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
        </AppShell>
      </ToastProvider>,
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

/**
 * 侧栏「项目」行的右键菜单 → 编辑名称（ISSUE #4808）。改名动作的真实链路
 * （canvas-store → 服务端镜像）由 store 用例判；这里判接线：菜单只在右键出现、
 * 对话框预填当前名、确认把 (id, 新名) 交给 renameProject、随后收起。
 */
describe("侧栏「项目」行的右键菜单 → 编辑名称（ISSUE #4808）", () => {
  beforeEach(() => {
    vi.mocked(renameProject).mockClear();
  });

  it("右键项目行弹出菜单（含「编辑名称」）；左键不开菜单、仍走打开项目", () => {
    const { onOpenProject } = renderShell();
    const btn = screen.getByRole("button", { name: "城市夜景" });
    fireEvent.click(btn);
    expect(screen.queryByText("编辑名称")).toBeNull();
    expect(onOpenProject).toHaveBeenCalledWith("proj_a");
    fireEvent.contextMenu(btn);
    expect(screen.getByText("编辑名称")).toBeTruthy();
  });

  it("点「编辑名称」开改名对话框：预填当前名，确认把 (id, 新名) 交给 renameProject 并收起", () => {
    renderShell();
    fireEvent.contextMenu(screen.getByRole("button", { name: "城市夜景" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑名称" }));
    const input = asInput(screen.getByPlaceholderText("项目名称（必填）"));
    expect(input.value).toBe("城市夜景");
    fireEvent.change(input, { target: { value: "夜景 2.0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(vi.mocked(renameProject)).toHaveBeenCalledWith("proj_a", "夜景 2.0");
    expect(screen.queryByPlaceholderText("项目名称（必填）")).toBeNull();
  });

  it("空名不能确认（与新建「名称为空不能确认」同一口径）", () => {
    renderShell();
    fireEvent.contextMenu(screen.getByRole("button", { name: "角色设定集" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "编辑名称" }));
    const input = asInput(screen.getByPlaceholderText("项目名称（必填）"));
    fireEvent.change(input, { target: { value: "   " } });
    expect(asButton(screen.getByRole("button", { name: "保存" })).disabled).toBe(true);
    expect(vi.mocked(renameProject)).not.toHaveBeenCalled();
  });
});

/**
 * 行级悬停组（ISSUE #4812）：「项目」面板嵌在外层「项目」行（一个带
 * `group/menu-item` 的 SidebarMenuItem）里，Tailwind 命名组变体是「任一祖先
 * 命中」—— 悬停面板里任意一行，外层 li 也处于 :hover。行内反馈（按钮背景 /
 * 关闭按钮浮现）必须只认本行的 li：用独立组名 `group/row`，外层不带它。
 */
describe("侧栏「项目」面板的行级悬停组（ISSUE #4812）", () => {
  /* 与上方「打开态」describe 同形的夹具：开着页签才有关闭按钮可判。 */
  const tabsFixture = [
    { key: tabKey("project", "proj_a"), projectId: "proj_a", view: "project" as const },
    { key: tabKey("workshop", "proj_a"), projectId: "proj_a", view: "workshop" as const },
  ];

  /** 与上方「打开态」describe 同一夹具：开着页签才有关闭按钮可判。 */
  function renderRowWithTabs() {
    render(
      <ToastProvider>
        <AppShell
          active="project"
          activeProjectId="proj_a"
          onCloseViewTab={vi.fn()}
          onNewProject={vi.fn()}
          onOpenProject={vi.fn()}
          onOpenSettings={vi.fn()}
          onSelect={vi.fn()}
          onShowAllProjects={vi.fn()}
          projects={PROJECTS}
          viewTabs={tabsFixture}
        >
          <div />
        </AppShell>
      </ToastProvider>,
    );
  }

  it("项目行按钮与关闭按钮的行内反馈走 group/row，不再挂 menu-item 组", () => {
    renderRowWithTabs();
    const openBtn = screen.getByRole("button", { name: "城市夜景" });
    expect(openBtn.className).toContain("group-hover/row:bg-sidebar-accent");
    expect(openBtn.className).not.toContain("group-hover/menu-item:");
    const closeBtn = screen.getByRole("button", { name: "关闭 城市夜景 页签" });
    expect(closeBtn.className).toContain("group-hover/row:opacity-100");
    expect(closeBtn.className).toContain("group-focus-within/row:opacity-100");
    expect(closeBtn.className).not.toContain("group-hover/menu-item:");
    /* 行 li 自己带 group/row；外层「项目」行带 menu-item 组但不带 group/row
       —— 串色链条断在这里。 */
    const rowLi = openBtn.closest('[data-slot="sidebar-menu-item"]');
    expect(rowLi?.className).toContain("group/row");
    const outerLi = rowLi?.parentElement?.closest("li");
    expect(outerLi?.className).toContain("group/menu-item");
    expect(outerLi?.className).not.toContain("group/row");
  });
});

/**
 * 侧栏「项目」行的右键菜单 → 删除项目（ISSUE #4836）。删除的真实链路
 * （deleteProjectEverywhere → 关页签 → 刷新活跃项目）在 workspace 页的
 * handleDeleteProject，由接线保证；这里判接线：菜单里有危险态「删除项目」项、
 * 点击弹确认框、确认把 id 交给 onDeleteProject、取消不动。
 */
describe("侧栏「项目」行的右键菜单 → 删除项目（ISSUE #4836）", () => {
  it("右键菜单里有危险态「删除项目」项；确认后把 id 交给 onDeleteProject 并收起确认框", () => {
    const onDeleteProject = vi.fn();
    renderShell({ onDeleteProject });
    fireEvent.contextMenu(screen.getByRole("button", { name: "城市夜景" }));
    const item = screen.getByRole("menuitem", { name: "删除项目" });
    expect(item.dataset.variant).toBe("destructive");
    fireEvent.click(item);
    expect(screen.getByText("删除此画布项目？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除项目" }));
    expect(onDeleteProject).toHaveBeenCalledTimes(1);
    expect(onDeleteProject).toHaveBeenCalledWith("proj_a");
    expect(screen.queryByText("删除此画布项目？")).toBeNull();
  });

  it("取消不删除（onDeleteProject 不被调用，确认框收起）", () => {
    const onDeleteProject = vi.fn();
    renderShell({ onDeleteProject });
    fireEvent.contextMenu(screen.getByRole("button", { name: "角色设定集" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除项目" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onDeleteProject).not.toHaveBeenCalled();
    expect(screen.queryByText("删除此画布项目？")).toBeNull();
  });
});
