/**
 * 侧栏「项目」分组在缩略态（图标轨，窗口窄于 `NAV_EXPANDED_MIN_PX`）也要能按名字找到项目
 * （ISSUE #1691）：此前整组挂 `group-data-[collapsible=icon]:hidden` 直接消失。判 DOM 而非源码 ——
 * 每条按钮要有图标、并作为 tooltip 触发器（基元只在 collapsed 时渲染内容，故判接线而非文案）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";

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
  expect(group).not.toBeNull();
  /* SAFETY: 类型断言已复核 */
  return group as HTMLElement;
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
