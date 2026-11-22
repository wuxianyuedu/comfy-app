/**
 * 侧栏「临时页签」组（ISSUE #4770）：顶部页签栏退役后，已打开的页签改在左侧栏列出。
 * 判用户能看见的结构（规范 11.2）：组里列了谁、当前页高亮、点关闭把 key 交给
 * `onCloseViewTab`、桌面壳 iframe 页签（ComfyUI）同组列出且可切可关。
 * 首页是固定页签（侧栏常驻项），不进这一组。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MAIN_TAB_ID, useShellTabs } from "~/lib/shell/shell-tabs-store";

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

const MAIN_ONLY = {
  tabs: [{ id: MAIN_TAB_ID, label: "主应用", url: null, closable: false }],
  activeTabId: MAIN_TAB_ID,
};

/** 主应用 + 一个已打开的 ComfyUI iframe 页签（当前停在主应用）。 */
const WITH_COMFY = {
  tabs: [
    { id: MAIN_TAB_ID, label: "主应用", url: null, closable: false },
    { id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true },
  ],
  activeTabId: MAIN_TAB_ID,
};

afterEach(() => {
  cleanup();
  useShellTabs.setState(MAIN_ONLY);
});

/** 造一组页签（全局项 projectId 为 null，项目类带项目 id）。 */
function tabsOf(...specs: Array<[WorkspaceView, string | null]>): Array<ViewTab> {
  return specs.map(([view, projectId]) => ({
    key: tabKey(view, projectId),
    projectId,
    view,
  }));
}

function renderShell(
  opts: {
    active?: WorkspaceView;
    activeViewKey?: string;
    openableViews?: Array<{ label: string; view: WorkspaceView }>;
    tabs?: Array<ViewTab>;
  } = {},
) {
  const handlers = {
    onCloseViewTab: vi.fn(),
    onOpenView: vi.fn(),
    onSelectViewTab: vi.fn(),
  };
  render(
    /* 「项目」分组挂了 useToast（删除回执）：按应用真实层级包上 Provider。 */
    <ToastProvider>
      <AppShell
        active={opts.active ?? "home"}
        activeProjectId="p1"
        activeViewKey={opts.activeViewKey}
        onCloseViewTab={handlers.onCloseViewTab}
        onNewProject={vi.fn()}
        onOpenProject={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenView={handlers.onOpenView}
        onSelect={vi.fn()}
        onSelectViewTab={handlers.onSelectViewTab}
        onShowAllProjects={vi.fn()}
        openableViews={opts.openableViews}
        projectNameOf={(id) => (id === "p1" ? "雾中来信" : null)}
        projects={[{ id: "p1", name: "雾中来信" }]}
        viewTabs={opts.tabs ?? []}
      >
        <div />
      </AppShell>
    </ToastProvider>,
  );
  return handlers;
}

/** 「临时页签」分组容器（按组标签定位）。 */
function tempGroup(): HTMLElement {
  const label = screen.getByText("临时页签");
  const group = label.closest('[data-slot="sidebar-group"]');
  if (!(group instanceof HTMLElement)) {
    throw new Error("没找到「临时页签」分组容器");
  }
  return group;
}

/**
 * 组内按可访问名找按钮。**必须 scoped**：全局导航里也有「ComfyUI」「设置」等同名项，
 * 全局查询会撞 multiple elements（撞上的还是另一条路 —— 点它走的是 onSelect 而非页签切换）。
 */
function tempButton(name: string): HTMLElement {
  const btn = [...tempGroup().querySelectorAll("button")].find((candidate) =>
    (candidate.getAttribute("aria-label") ?? candidate.textContent ?? "").includes(name),
  );
  if (!(btn instanceof HTMLElement)) {
    throw new Error(`「临时页签」组里没找到按钮：${name}`);
  }
  return btn;
}

describe("侧栏「临时页签」组（ISSUE #4770 / #4798）", () => {
  it("只列瞬时页签；项目类页签不进这一组（ISSUE #4798：项目在「项目」分组已有打开态）", () => {
    renderShell({
      activeViewKey: tabKey("workshop", "p1"),
      tabs: tabsOf(["home", null], ["settings", null], ["workshop", "p1"]),
    });
    const names = [...tempGroup().querySelectorAll("button")].map((btn) => btn.textContent ?? "");
    expect(names.some((name) => name.includes("设置"))).toBe(true);
    expect(names.some((name) => name.includes("工坊·雾中来信"))).toBe(false);
    /* 首页是侧栏常驻项：不进这一组重复列。 */
    expect(names.some((name) => name.includes("首页"))).toBe(false);
  });

  it("只开着项目页签时整组不渲染（项目不该在临时页签组里出现）", () => {
    renderShell({
      activeViewKey: tabKey("workshop", "p1"),
      tabs: tabsOf(["home", null], ["workshop", "p1"]),
    });
    expect(screen.queryByText("临时页签")).toBeNull();
  });

  it("当前页高亮（data-active），点某一页把 key 交给 onSelectViewTab", () => {
    const { onSelectViewTab } = renderShell({
      activeViewKey: tabKey("settings", null),
      tabs: tabsOf(["home", null], ["settings", null], ["workshop", "p1"]),
    });
    expect(tempButton("设置").dataset.active).toBeDefined();

    fireEvent.click(tempButton("设置"));
    expect(onSelectViewTab).toHaveBeenCalledWith(tabKey("settings", null));
  });

  it("可关页签有关闭按钮，点它把 key 交给 onCloseViewTab；首页没有关闭按钮", () => {
    const { onCloseViewTab } = renderShell({
      activeViewKey: tabKey("settings", null),
      tabs: tabsOf(["home", null], ["settings", null], ["workshop", "p1"]),
    });
    fireEvent.pointerDown(tempButton("关闭 设置"));
    expect(onCloseViewTab).toHaveBeenCalledWith(tabKey("settings", null));
    /* 首页固定页签：组里不列它，自然也没有它的关闭按钮。 */
    expect(screen.queryByRole("button", { name: "关闭 首页" })).toBeNull();
  });

  it("「+」菜单在组内，点选项走 onOpenView", () => {
    const { onOpenView } = renderShell({
      activeViewKey: tabKey("settings", null),
      tabs: tabsOf(["home", null], ["settings", null]),
      openableViews: [
        { label: "画布", view: "canvas" },
        { label: "产出", view: "outputs" },
      ],
    });
    const trigger = tempButton("打开视图");
    /* jsdom 里点开下拉后选项挂在 portal，点它走 onOpenView。 */
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "画布" }));
    expect(onOpenView).toHaveBeenCalledWith("canvas");
  });

  it("桌面壳 iframe 页签（ComfyUI）同组列出；它激活时视图页签不亮", () => {
    useShellTabs.setState({
      tabs: [
        { id: MAIN_TAB_ID, label: "主应用", url: null, closable: false },
        { id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true },
      ],
      activeTabId: "comfyui",
    });
    renderShell({
      activeViewKey: tabKey("settings", null),
      tabs: tabsOf(["home", null], ["settings", null]),
    });
    expect(tempButton("ComfyUI").dataset.active).toBeDefined();
    /* iframe 页签激活时，主应用整体被盖住 —— 视图页签即使是 activeViewKey 也不亮。 */
    expect(tempButton("设置").dataset.active).toBeUndefined();
  });

  it("点 iframe 页签切换它，点它的关闭按钮关掉它（走 shell-tabs-store）", () => {
    useShellTabs.setState(WITH_COMFY);
    renderShell({
      activeViewKey: tabKey("settings", null),
      tabs: tabsOf(["home", null], ["settings", null]),
    });
    fireEvent.click(tempButton("ComfyUI"));
    expect(useShellTabs.getState().activeTabId).toBe("comfyui");

    fireEvent.pointerDown(tempButton("关闭 ComfyUI"));
    expect(useShellTabs.getState().tabs.some((tab) => tab.id === "comfyui")).toBe(false);
  });

  it("没有要列的页签时整组不渲染（不给侧栏添空分组）", () => {
    renderShell({ active: "home", tabs: tabsOf(["home", null]) });
    expect(screen.queryByText("临时页签")).toBeNull();
  });
});
