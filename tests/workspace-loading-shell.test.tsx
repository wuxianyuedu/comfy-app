/**
 * 工作区路由级加载壳（ISSUE #4511）：左侧导航侧栏必须渲染**真实的固定项**
 * （`sidebarNavItems()` 注册表），不再把导航骨架化 —— 导航不依赖请求，加载
 * 只发生在内容区。同时钉住两个路由级 loading（根 / workspace）都走这一形态，
 * 不再出现整屏转圈的 `PageLoading`。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RootLoading from "~/app/loading";
import WorkspaceLoading from "~/app/workspace/loading";
import { PROJECTS_ENTRY, sidebarNavItems } from "~/components/studio/NavItems";
import { WorkspaceLoadingShell } from "~/components/studio/WorkspaceLoadingShell";

afterEach(cleanup);

describe("WorkspaceLoadingShell：路由级加载壳（ISSUE #4511）", () => {
  it("左侧导航渲染真实固定项：注册表里每一项（含侧栏隐藏项之外的全部全局项）都在", () => {
    render(
      <WorkspaceLoadingShell>
        <div>内容区</div>
      </WorkspaceLoadingShell>,
    );
    const nav = screen.getByRole("navigation", { name: "主导航" });
    for (const item of sidebarNavItems()) {
      expect(nav.textContent).toContain(item.label);
    }
    /* 侧栏底部的「项目」分组入口同样来自固定注册表。 */
    expect(nav.textContent).toContain(PROJECTS_ENTRY.label);
    /* 内容区照常渲染（骨架由调用方给）。 */
    expect(screen.getByText("内容区")).toBeTruthy();
  });

  it("「资产」项在加载态与真壳同形（#4868 转正：不再置灰），切到真壳时侧栏不跳变", () => {
    render(
      <WorkspaceLoadingShell>
        <div>内容区</div>
      </WorkspaceLoadingShell>,
    );
    const nav = screen.getByRole("navigation", { name: "主导航" });
    const row = [...nav.querySelectorAll("li")].find((li) => li.textContent?.includes("资产"));
    expect(row).toBeTruthy();
    expect(row?.firstElementChild?.className).not.toContain("opacity-50");
  });

  it("导航侧栏里没有骨架占位条：加载态的骨架只允许落在内容区", () => {
    render(
      <WorkspaceLoadingShell>
        <div className="bg-surface-2">内容骨架</div>
      </WorkspaceLoadingShell>,
    );
    const nav = screen.getByRole("navigation", { name: "主导航" });
    expect(nav.querySelectorAll(".bg-surface-2")).toHaveLength(0);
    expect(nav.querySelectorAll(".bg-subtle")).toHaveLength(0);
  });

  it("workspace 路由加载态：真实导航 + 工作流库内容骨架（加载中语义仍在）", () => {
    render(<WorkspaceLoading />);
    expect(screen.getByLabelText("工作区加载中")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "主导航" }).textContent).toContain("首页");
    /* 工作流库形状的内容骨架在场（列表列与详情列的占位块）。 */
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(1);
  });

  it("根路由加载态：同一形态（真实导航 + 内容骨架），不再是整屏转圈", () => {
    render(<RootLoading />);
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    /* 旧形态的转圈文案不再出现。 */
    expect(screen.queryByText("加载中…")).toBeNull();
  });

  /* ISSUE #4968：加载壳真被卡住时（实测某 webview 里页面流停住）不许把用户
     无声地按在骨架上 —— 停留超过 30s 给可行动提示；正常加载触达不到它。
     推进假时钟要包进 act：React 的重渲染走调度器，同步推进后 DOM 还没刷出来。 */
  it("停留超过 30s → 给可行动的加载提示；30s 内不出现", async () => {
    vi.useFakeTimers();
    try {
      render(
        <WorkspaceLoadingShell>
          <div>内容区</div>
        </WorkspaceLoadingShell>,
      );
      expect(screen.queryByRole("alert")).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("刷新");
      expect(alert.textContent).toContain("log/current/");
    } finally {
      vi.useRealTimers();
    }
  });
});
