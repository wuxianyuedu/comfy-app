// @vitest-environment jsdom
/**
 * 侧栏两个**全局浮层入口**（模型适配 / 模式契约）的接线判据。
 *
 * 这两件事是**项目无关**的（模式契约 = 每种模式有哪些统一输入 / 输出；模型适配 =
 * 每个远端模型 × 每个模式的字段映射），所以入口留在应用侧栏、不挂在工坊那个
 * **项目内**视图的顶栏上 —— 挂项目里会让人以为换项目就得重配一遍。
 *
 * 用例锁三件事：
 *   1. 入口在侧栏、且说得出自己的名字（不是只靠图标）；
 *   2. 点开挂的是**同一个**弹窗组件（与工坊 / 工作流库那份同源），关掉后卸载；
 *   3. 同一时刻只开一个 —— 两项都是「配置全局注册表」，两层弹窗只会互遮。
 *
 * 弹窗本体在这里被替换成哨兵：它们各自要 tRPC / QueryClient 才能挂起来，而那些是
 * 弹窗自己的接线（另有其域）。本文件判的是外壳 → 弹窗这一段。
 *
 * 外壳按 `next/dynamic` 懒加载这两个弹窗（外壳在每个工作区视图里都挂着，不该为它们
 * 摊上首屏代价），所以断言一律走 `findBy*` —— 点开到挂载之间隔着一跳 import。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AppShell } from "./AppShell";

vi.mock("~/components/workshop/mode-contract/ModeContractDialog", () => ({
  ModeContractDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mode-contract-dialog">
      <button onClick={onClose}>收起契约</button>
    </div>
  ),
}));

vi.mock("~/components/workshop/WorkshopModelAdapterModal", () => ({
  WorkshopModelAdapterModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="model-adapter-modal">
      <button onClick={onClose}>收起适配</button>
    </div>
  ),
}));

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

function renderShell() {
  return render(
    <AppShell
      active="workshop"
      onSelect={vi.fn()}
      onOpenSettings={vi.fn()}
      projects={[]}
      activeProjectId="p1"
      onOpenProject={vi.fn()}
      onShowAllProjects={vi.fn()}
      onNewProject={vi.fn()}
    >
      <div />
    </AppShell>,
  );
}

describe("侧栏的全局浮层入口", () => {
  it("两个入口都在侧栏里，且是带文字的按钮（不是只留一个图标）", () => {
    renderShell();
    for (const label of ["模型适配", "模式契约"]) {
      const btn = screen.getByRole("button", { name: label });
      expect(btn.textContent).toContain(label);
    }
  });

  it("点「模型适配」挂的是模型适配弹窗，关掉后卸载", async () => {
    renderShell();
    expect(screen.queryByTestId("model-adapter-modal")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "模型适配" }));
    await screen.findByTestId("model-adapter-modal");

    fireEvent.click(screen.getByText("收起适配"));
    expect(screen.queryByTestId("model-adapter-modal")).toBeNull();
  });

  it("点「模式契约」挂的是模式契约弹窗（与工坊 / 工作流库同一个组件）", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "模式契约" }));
    await screen.findByTestId("mode-contract-dialog");
  });

  it("同一时刻只开一个：先点契约再点适配，契约被让位", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "模式契约" }));
    await screen.findByTestId("mode-contract-dialog");

    fireEvent.click(screen.getByRole("button", { name: "模型适配" }));
    await screen.findByTestId("model-adapter-modal");
    expect(screen.queryByTestId("mode-contract-dialog")).toBeNull();
  });

  it("浮层入口不参与视图高亮（它不切视图，只开弹窗）", () => {
    renderShell();
    /* 当前视图是工坊；两个浮层入口不该出现「你现在在这」的态 —— 它们根本不是视图。 */
    for (const label of ["模型适配", "模式契约"]) {
      const btn = screen.getByRole("button", { name: label });
      /* `ui/sidebar` 只在 active 为真时挂 `data-active` —— 缺席即「不在这」。 */
      expect(btn.hasAttribute("data-active")).toBe(false);
    }
  });
});
