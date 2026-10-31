/**
 * 侧栏「模型适配 / 模式契约」两项的接线判据 —— 它们此前是**全局浮层入口**，
 * 现在是**视图页签**（与设置、控制台同一族收口）。
 *
 * 为什么这两件事该是视图：它们是**项目无关**的（模式契约 = 每种模式有哪些统一输入 /
 * 输出；模型适配 = 每个远端模型 × 每个模式的字段映射），入口不该挂在工坊那个项目内
 * 视图上；但「点开弹窗、不改视图」也不是答案 —— 弹窗形态下没有页签、不能一边配着
 * 别的一边对照工作流库，而配置一张适配器恰恰要来回对照。
 *
 * 用例锁四件事（与旧版逐条对照，其中两条的判据方向**反过来**了）：
 *   1. 入口在侧栏、且说得出自己的名字（不变）；
 *   2. 点击走 `onSelect(view)` —— 与别的视图同一条切换路径，不再是外壳自己 `useState`
 *      一份「开没开」（旧版判的是「挂的是不是同一个弹窗」）；
 *   3. **参与**视图高亮：当前视图就是它时要有 active 态（旧版判的是「不参与高亮」，
 *      因为那时它们根本不是视图 —— 形态翻了，判据方向跟着翻）；
 *   4. 外壳不再持有这两个视图的渲染路径（渲染只在 `workspace/page.tsx` 一处）。
 *
 * 第五组（ISSUE #1784）判的是**反面**：设置**不该**在侧栏里。那一项在侧栏列表与
 * 侧栏底部各有一处，两处都会走到 `onOpenSettings`，而顶栏应用菜单里本来就有第三处
 * —— 一个动作三个入口。用例判两侧都不再渲染它，同时确认 `onOpenSettings` 仍由
 * 外壳转给顶栏（撤的是入口，不是能力）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";
import { type WorkspaceView } from "./NavItems";

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

function renderShell(active: WorkspaceView = "workshop") {
  const onSelect = vi.fn();
  render(
    <AppShell
      active={active}
      activeProjectId="p1"
      onNewProject={vi.fn()}
      onOpenProject={vi.fn()}
      onOpenSettings={vi.fn()}
      onSelect={onSelect}
      onShowAllProjects={vi.fn()}
      projects={[]}
    >
      <div />
    </AppShell>,
  );
  return onSelect;
}

describe("侧栏的模型适配 / 模式契约入口", () => {
  it("两项都在侧栏里，且是带文字的按钮（不是只留一个图标）", () => {
    renderShell();
    for (const label of ["模型适配", "模式契约"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn.textContent).toContain(label);
    }
  });

  it("点击走 onSelect(视图 id) —— 与别的视图同一条切换路径", () => {
    const onSelect = renderShell();

    fireEvent.click(screen.getByRole("button", { name: "模型适配" }));
    expect(onSelect).toHaveBeenCalledWith("model-adapters");

    fireEvent.click(screen.getByRole("button", { name: "模式契约" }));
    expect(onSelect).toHaveBeenCalledWith("mode-contract");
  });

  it("当前视图就是它时参与高亮（旧形态下它们不是视图，这条判据方向正相反）", () => {
    renderShell("model-adapters");
    const adapters = screen.getByRole("button", { name: "模型适配" });
    const contract = screen.getByRole("button", { name: "模式契约" });
    /* `ui/sidebar` 只在 active 为真时挂 `data-active` —— 缺席即「不在这」。
       两条一起判还反证了「两项被同一份状态一起点亮」：只点亮当前那一个。 */
    expect(adapters.hasAttribute("data-active")).toBe(true);
    expect(contract.hasAttribute("data-active")).toBe(false);
  });

  it("外壳不再持有这两个视图的渲染路径（渲染只在该视图该在的地方）", () => {
    /* 读源码文本判，而不是只判渲染结果：旧形态是「外壳 lazy 两份弹窗 + 一个 overlay
       状态 + 两处条件渲染」。哪天有人图省事把弹窗壳加回外壳（侧栏点击就在手边），
       侧栏那条路会开弹窗、工坊 / 工作流库那两条路会切页签 —— 同一个功能两种
       「开没开」的真相，正是这一刀要消掉的形状。运行时判据抓不到「外壳里多挂了一份
       当前没点开的弹窗」。 */
    const source = readFileSync(path.resolve(import.meta.dirname, "AppShell.tsx"), "utf8");
    for (const retired of [
      "ModelAdaptersView",
      "ModeContractView",
      "WorkshopModelAdapterModal",
      "ModeContractDialog",
    ]) {
      expect(source, `AppShell 里不该再出现 ${retired}`).not.toContain(retired);
    }
  });
});

describe("设置不在侧栏（ISSUE #1784：入口收归顶栏应用菜单）", () => {
  it("侧栏列表里没有「设置」这一项（它只在顶栏菜单里）", () => {
    renderShell();
    /* 侧栏那几项都是带文字的按钮；撤掉之后按名字查应该一个都查不到。
       注意不能用 `onOpenSettings` 的回调次数代替 —— 那是顶栏菜单的路径，
       与侧栏无关（下面那条正是要把它分开判）。 */
    expect(screen.queryByRole("button", { name: "设置" })).toBeNull();
  });

  it("侧栏底部那枚「设置」也不在了（三处入口收成一处）", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "AppShell.tsx"), "utf8");
    /* 运行时判据抓不到「这里原本有个按钮、现在只是没渲染」——判源码文本更贴题：
       `SidebarFooter` 一旦回来，八成也会把底部那颗按钮带回来。 */
    expect(source).not.toContain("SidebarFooter");
  });

  it("撤的是入口不是能力：`onOpenSettings` 仍然传给顶栏", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "AppShell.tsx"), "utf8");
    expect(source).toContain("onOpenSettings={onOpenSettings}");
  });
});
