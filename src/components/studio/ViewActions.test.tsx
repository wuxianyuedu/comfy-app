/**
 * 视图动作槽的形状判据（ISSUE #1871：每屏最上面那一大片空白）。
 *
 * 这一笔要守的是**三件事**，每一件失效都会静默出现在界面上：
 *   ① 有宿主时动作**传送**到宿主里、屏内不再留那一行（省下的正是那行空气）；
 *   ② 没有宿主时就地渲染，且形状与从前那一行一致（右对齐 + 下边距）——
 *      `/models` 独立路由页、Storybook、组件用例都走这条；
 *   ③ **非当前页签不渲染**：页签是「切走不卸载」，不按页签过滤就会把兄弟屏的
 *      按钮一起塞进同一条顶栏。
 *
 * 判的是 DOM 上的去留与归属，不判内部实现（规范 11.2）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  ViewActions,
  ViewActionsHost,
  ViewActionsProvider,
  ViewTabActiveProvider,
} from "./ViewActions";

afterEach(() => {
  cleanup();
});

/** 挂「宿主 + 一次动作」，返回宿主节点。 */
function renderWithHost(actions: React.ReactNode, active = true) {
  const { container } = render(
    <ViewActionsProvider>
      <div data-testid="topbar">
        <ViewActionsHost />
      </div>
      <div data-testid="view">
        <ViewTabActiveProvider active={active}>
          <ViewActions>{actions}</ViewActions>
        </ViewTabActiveProvider>
      </div>
    </ViewActionsProvider>,
  );
  const host = container.querySelector('[data-slot="slot-outlet"]');
  if (!host) {
    throw new Error("没渲染出动作槽宿主");
  }
  return { container, host };
}

describe("视图动作槽", () => {
  it("有宿主时动作落在宿主里，屏内不再就地渲染那一行", () => {
    const { container, host } = renderWithHost(<button>刷新</button>);
    expect(host.textContent).toContain("刷新");
    /* 屏内那一条**不许**留着 —— 留着就等于那一行空气还在（正是本笔要治的）。 */
    expect(container.querySelector('[data-slot="view-actions-inline"]')).toBeNull();
  });

  it("没有宿主时就地渲染，形状是「右对齐 + 下边距」（/models 与一切不挂壳的路径）", () => {
    const { container } = render(
      <ViewActionsProvider>
        <ViewActions>
          <button>刷新</button>
        </ViewActions>
      </ViewActionsProvider>,
    );
    const inline = container.querySelector('[data-slot="view-actions-inline"]');
    if (!inline) {
      throw new Error("没有宿主时应在原地渲染");
    }
    expect(inline.className).toContain("justify-end");
    expect(inline.className).toContain("mb-6");
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
  });

  it("非当前页签的动作一个都不进顶栏（页签切走不卸载的另一半）", () => {
    const { host } = renderWithHost(<button>刷新</button>, false);
    expect(host.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "刷新" })).toBeNull();
  });

  it("不挂提供者时按「就是当前屏」处理（组件用例与 Storybook 没有壳）", () => {
    render(
      <ViewActions>
        <button>刷新</button>
      </ViewActions>,
    );
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
  });
});
