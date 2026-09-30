// @vitest-environment jsdom
/* 顶部工具条的可见行为：侧栏开合按钮 + 当前视图标题 + 全局搜索入口。
 *
 * 标题这块是**从侧栏头部搬过来的**（ISSUE #1283：侧栏那条「Comfy-APP」名称行不
 * 承载信息，却白占一整条纵向空间）。所以这里既钉「标题在工具条上」，也钉「应用名
 * 已经不在侧栏头部了」—— 只钉前者的话，旧的名称行再多留一版也没人发现。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SidebarProvider } from "~/components/ui/sidebar";

import { AppShell } from "./AppShell";
import { TopBar } from "./TopBar";

/* jsdom 没有 `matchMedia`，而 `ui/sidebar` 的窄窗判据（`use-mobile` /
 * `use-narrow-nav`）在挂载时就要读它 —— 缺了会当场抛。桩只回答「不窄」：
 * 本文件判的是「标题在哪、名称行还在不在」，与窗口宽度无关。 */
if (!window.matchMedia) {
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

/** 工具条里的 `SidebarTrigger` 依赖 `ui/sidebar` 的 context，得包一层 provider。 */
function renderTopBar(active: Parameters<typeof TopBar>[0]["active"]) {
  return render(
    <SidebarProvider>
      <TopBar active={active} onOpenSettings={vi.fn()} onOpenSearch={vi.fn()} />
    </SidebarProvider>,
  );
}

describe("TopBar", () => {
  it("渲染侧栏开合按钮与当前视图标题", () => {
    renderTopBar("history");
    expect(screen.getByText("历史")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle Sidebar" })).toBeTruthy();
  });

  it("标题跟着当前视图走，未知视图回落到「工作区」", () => {
    const { unmount } = renderTopBar("workflows");
    expect(screen.getByText("流程")).toBeTruthy();
    unmount();

    renderTopBar("home");
    expect(screen.getByText("首页")).toBeTruthy();
  });

  it("全局搜索按钮回抛 onOpenSearch", () => {
    const onOpenSearch = vi.fn();
    render(
      <SidebarProvider>
        <TopBar
          active="home"
          onOpenSettings={vi.fn()}
          onOpenSearch={onOpenSearch}
        />
      </SidebarProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "全局搜索" }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });
});

describe("AppShell 侧栏头部", () => {
  it("不再渲染应用名那一行（名称行整条移除，不占纵向空间）", () => {
    render(
      <AppShell
        active="home"
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        projects={[]}
        activeProjectId={null}
        onOpenProject={vi.fn()}
        onShowAllProjects={vi.fn()}
        onNewProject={vi.fn()}
      >
        <div />
      </AppShell>,
    );
    expect(screen.queryByText("Comfy-APP")).toBeNull();
    /* 侧栏头部整个不在了 —— 全局项直接顶着侧栏顶起（否则会留一条空的 header 内边距）。 */
    expect(document.querySelector('[data-slot="sidebar-header"]')).toBeNull();
    /* 全局项本身照旧：搬走的只有应用名，导航一个都没少。 */
    expect(screen.getByRole("button", { name: "首页" })).toBeTruthy();
  });
});
