/**
 * 侧栏「项目」分组的高亮判据 —— ISSUE #1691 第 2 条：判据是「用户此刻在不在项目里」
 * （视图是否为项目页签 `isProjectTab`），不是存储里的活跃 id；后者跨视图常驻，会让全局视图
 * 上某项看着被选中而内容一处没显。判 `data-active` 属性存在与否而非类名（换版底色会静默失效）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";
import type { WorkspaceView } from "./NavItems";

/* jsdom 没有 `matchMedia`，`ui/sidebar` 挂载时就读它（与既有侧栏用例同一份桩）。 */
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
  { id: "p-active", name: "未命名_3" },
  { id: "p-other", name: "未命名_2" },
];

function renderShell(active: WorkspaceView) {
  render(
    <AppShell
      active={active}
      activeProjectId="p-active"
      onNewProject={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenSettings={vi.fn()}
      onSelect={vi.fn()}
      onShowAllProjects={vi.fn()}
      projects={PROJECTS}
    >
      <div />
    </AppShell>,
  );
}

/** 某一枚侧栏项目行是否处于高亮态（行本身是 sidebar 的菜单按钮）。
 *
 * 判属性**在不在**：`useRender` 的 state 通道对真值给空属性、对假值整个不发。 */
function rowActive(name: string): boolean {
  return screen.getByRole("button", { name }).dataset.active !== undefined;
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

  it.each<WorkspaceView>(["project", "canvas", "workshop", "library", "outputs", "film"])(
    "项目页签 %s 上：亮的正是活跃那一个",
    (view) => {
      renderShell(view);
      expect(rowActive("未命名_3")).toBe(true);
      expect(rowActive("未命名_2")).toBe(false);
    },
  );
});
