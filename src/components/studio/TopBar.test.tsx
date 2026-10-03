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

/* `next-themes` 在测试里没有 Provider，`useTheme()` 会回落到默认上下文（点一下
 * 什么都不发生），断言不到「按当前档反向翻」。这里换成可观测的桩。 */
const themeMock = vi.hoisted(() => ({
  resolvedTheme: "dark",
  setTheme: vi.fn(),
}));
vi.mock("next-themes", () => ({ useTheme: () => themeMock }));

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

  /* ISSUE #1384：应用菜单那一颗此前把 `<Hint>` 套在 `DropdownMenuTrigger` 的
     `render` 里，menu 的触发 props（`aria-haspopup` / pointerdown）全被 `Hint`
     吞掉 —— 按钮点不开。这里判 `aria-haspopup`：它是**渲染结果的属性**，不依赖
     pointerdown，所以 jsdom 也拿得到证据（"菜单真的弹出来" 只能在真浏览器里判，
     见 `e2e/top-bar-app-menu.spec.ts`；jsdom 下连光秃秃的 trigger 都点不开）。
     `data-slot` 被 tooltip 接管属于已知无害的副作用，不在这里判（规范 16 §16.2.3.2）。 */
  it("应用菜单是菜单触发按钮：menu 的触发 props 没被外层 Hint 吞掉", () => {
    renderTopBar("home");
    expect(screen.getByRole("button", { name: "应用菜单" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
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

  it("光暗按钮按当前档反向翻 —— 不是固定写死某一档", () => {
    /* 每次都要重新渲染：改桩对象的值不会让已挂载的组件重取 `useTheme()`，
       第二次点击仍会读到旧档（那不是被测行为，是夹具在骗自己）。 */
    themeMock.resolvedTheme = "dark";
    const first = renderTopBar("home");
    fireEvent.click(screen.getByRole("button", { name: "切换深浅色" }));
    expect(themeMock.setTheme).toHaveBeenLastCalledWith("light");
    first.unmount();

    themeMock.resolvedTheme = "light";
    renderTopBar("home");
    fireEvent.click(screen.getByRole("button", { name: "切换深浅色" }));
    expect(themeMock.setTheme).toHaveBeenLastCalledWith("dark");
    cleanup();
  });

  /* 两枚图标**同时**在 DOM 里，靠 `dark:` 变体决定谁可见。若改成按 `resolvedTheme`
     条件渲染，服务端与首帧那个值是 undefined —— 按钮会在 hydration 后跳一下，
     而这正是 next-themes 文档要求 suppressHydrationWarning 的那类问题。 */
  it("太阳与月亮同时存在，可见性交给 CSS（不靠首帧未定的 resolvedTheme）", () => {
    const { container } = renderTopBar("home");
    const icons = container.querySelectorAll("svg");
    const sun = container.querySelector("svg.dark\\:hidden");
    const moon = container.querySelector("svg.hidden.dark\\:block");
    expect(sun).toBeTruthy();
    expect(moon).toBeTruthy();
    expect(icons.length).toBeGreaterThanOrEqual(2);
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
