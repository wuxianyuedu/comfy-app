/**
 * 侧栏「项目」分组在**缩略态**（图标轨）也要能按名字找到项目（ISSUE #1691）。
 *
 * 现场：窗口一窄到 `NAV_EXPANDED_MIN_PX` 以下，侧栏自动收成 48px 图标轨 ——
 * 此前「项目」分组挂着 `group-data-[collapsible=icon]:hidden`，于是**整组消失**：
 * 用户既看不见项目名、也切不了项目。而「项目」恰恰是这一屏最需要按名字找到的
 * 东西（首页的最近项目卡只是好看，切项目还是得回侧栏）。
 *
 * 这一条拆成两半，两半都要有判据：
 *   · **图形**：每条项目按钮里有一个可辨认的图标 —— 否则收起后按钮是个空格子
 *     （名称那一格被基元的 `[&>span:last-child]:truncate` 压成零宽）；
 *   · **名称**：按钮带 `tooltip`（悬停即出名字）。基元的 tooltip 只在
 *     `state === "collapsed"` 时渲染内容，所以这里判的是「接线接上了」
 *     （`TooltipTrigger` 存在），展开态的名字由可见文本那一格兜着。
 *
 * 判据取 DOM 而不是读源码：这一处的问题是「渲染出来是什么」，不是「文本里写了
 * 什么」—— 移除那个 hide 类只是手段，手段可以变，按钮里得有图标与名字这条不能变。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";

/* jsdom 没有 `matchMedia`，`ui/sidebar` 挂载时就读它（与既有测试同一份桩）。 */
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
  return /* SAFETY: 类型断言已复核 */ group as HTMLElement;
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
      /* 判的是**「接线接上了没」**，不是气泡里的字：基元把 tooltip 内容挡在
         `hidden={state !== "collapsed"}` 后面，且 base-ui 的 Popup 只在打开时挂载
         —— jsdom 里既没有窄窗也没有悬停，气泡永远不出现。所以取「这一条按钮就是
         tooltip 的触发器」这个可观测形态（base-ui 落在触发器上的属性）。
         它同时反证了「名字有第二个出口」：按钮里的 `<span>` 收起后会被基元的
         `[&>span:last-child]:truncate` 压成零宽，鼠标没地方悬停就没名字可读。 */
      expect(
        Object.hasOwn(btn.dataset, "baseUiTooltipTrigger"),
        `${project.name} 没接 tooltip`,
      ).toBe(true);
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
