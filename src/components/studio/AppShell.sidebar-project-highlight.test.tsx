/**
 * 侧栏「项目」分组里的高亮判据 —— ISSUE #1691 第 2 条。
 *
 * 用户的原始反馈：**首页上「项目」分组里默认有一项亮着，可那一屏没有任何项目
 * 内容**（截图里 未命名_3 带左侧强调条）。根因是判据取了「存储里有没有活跃 id」，
 * 而活跃 id 是跨视图常驻的：新建项目、从最近项目点进来都会写它，首页 / 模型 /
 * 历史这些全局视图上却一处都没有那个项目的影子。
 *
 * 判据因此改成「**用户此刻在不在项目里**」= 当前视图是不是项目页签
 * （`NavItems.tsx` 的 `isProjectTab`）。这份用例锁两侧：
 *   · 在全局视图（首页 / 模型 / 历史…）上——**活跃 id 再真也不许亮**；
 *   · 在项目页签（主页 / 画布 / 工坊…）上——**亮的就是活跃那一个**。
 *
 * 为什么要读 `data-active` 而不是类名：`isActive` 经 `useRender` 落到
 * `data-active`（`ui/sidebar` 的既有通道），高亮的样式与语义都以它为锚
 * —— 数类名会在换一版底色时静默失效。**它的存在性就是判据**（`useRender`
 * 的 state 通道：真值出空属性 `data-active=""`，假值整个属性不出现），
 * 所以下面判的是「有没有这个属性」，不是它的字符串值。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";
import type { WorkspaceView } from "./NavItems";

/* jsdom 没有 `matchMedia`，`ui/sidebar` 挂载时就读它（与既有侧栏用例同一份桩）。 */
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
  { id: "p-active", name: "未命名_3" },
  { id: "p-other", name: "未命名_2" },
];

function renderShell(active: WorkspaceView) {
  render(
    <AppShell
      active={active}
      onSelect={vi.fn()}
      onOpenSettings={vi.fn()}
      projects={PROJECTS}
      activeProjectId="p-active"
      onOpenProject={vi.fn()}
      onShowAllProjects={vi.fn()}
      onNewProject={vi.fn()}
    >
      <div />
    </AppShell>,
  );
}

/** 某一枚侧栏项目行是否处于高亮态（行本身是 sidebar 的菜单按钮）。
 *
 * 判属性**在不在**：`useRender` 的 state 通道对真值给空属性、对假值整个不发。 */
function rowActive(name: string): boolean {
  return (
    screen.getByRole("button", { name }).hasAttribute("data-active") === true
  );
}

describe("侧栏项目高亮只在项目视图里成立", () => {
  it.each<WorkspaceView>(["home", "models", "history", "queue", "settings"])(
    "全局视图 %s 上：活跃项目也不亮",
    (view) => {
      renderShell(view);
      /* 两行都必须不亮 —— 只判活跃那一行不够：「默认有个选中」的观感来自
       * 「总有一行亮着」，别行亮着同样是这个故障。 */
      expect(rowActive("未命名_3")).toBe(false);
      expect(rowActive("未命名_2")).toBe(false);
    },
  );

  it.each<WorkspaceView>([
    "project",
    "canvas",
    "workshop",
    "library",
    "outputs",
    "film",
  ])("项目页签 %s 上：亮的正是活跃那一个", (view) => {
    renderShell(view);
    expect(rowActive("未命名_3")).toBe(true);
    expect(rowActive("未命名_2")).toBe(false);
  });
});
