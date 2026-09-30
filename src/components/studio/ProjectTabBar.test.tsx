// @vitest-environment jsdom
// ProjectTabBar 渲染测试：项目界面顶部切换器渲染四个页签、高亮当前项、点击回抛对应视图。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ProjectTabBar } from "./ProjectTabBar";

afterEach(cleanup);

describe("ProjectTabBar", () => {
  it("渲染 画布/工坊/资源库/产出/成片 五个页签", () => {
    render(<ProjectTabBar active="canvas" onSelect={vi.fn()} />);
    for (const label of ["画布", "工坊", "资源库", "产出", "成片"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it("当前视图对应页签为选中态", () => {
    render(<ProjectTabBar active="workshop" onSelect={vi.fn()} />);
    const workshop = screen.getByRole("tab", { name: /工坊/ });
    expect(workshop.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("tab", { name: /画布/ }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("点击某页签 → onSelect 回抛该视图 id", () => {
    const onSelect = vi.fn();
    render(<ProjectTabBar active="canvas" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: /成片/ }));
    expect(onSelect).toHaveBeenCalledWith("film");
  });

  it("projectName 存在时显示在切换器上", () => {
    render(
      <ProjectTabBar active="canvas" onSelect={vi.fn()} projectName="夜班车" />,
    );
    expect(screen.getByText("夜班车")).toBeTruthy();
  });
});
