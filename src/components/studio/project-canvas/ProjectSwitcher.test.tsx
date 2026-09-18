// @vitest-environment jsdom
//
// 项目切换器走 `ui/dropdown-menu` 的契约（ISSUE #672 / 规范 16 §16.2.4.6 第一档）。
//
// 此前是自绘外壳：`absolute top-10` 手定位面板 + 自绘遮罩负责关闭 + 手写
// 分组标签与分隔线，没有 `role="menu"` / Esc / 方向键 / 外点关闭语义。
// 换基元后由 base-ui 的 `Menu` 给；本文件钉住「触发器没变、菜单真的是菜单、
// 点击行为原样」。

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ProjectSwitcher } from "./ProjectSwitcher";

afterEach(cleanup);

const SOURCE = readFileSync(
  path.resolve(__dirname, "ProjectSwitcher.tsx"),
  "utf8",
);

const base = {
  projectName: "演示项目",
  projectId: "p1",
  projects: [
    { id: "p1", name: "演示项目" },
    { id: "p2", name: "第二个" },
  ],
  renaming: false,
  renameVal: "",
  onToggleMenu: () => undefined,
  onCloseMenu: () => undefined,
  onSwitch: () => undefined,
  onNew: () => undefined,
  onStartRename: () => undefined,
  onRenameValChange: () => undefined,
  onCommitRename: () => undefined,
  onCancelRename: () => undefined,
  onDelete: () => undefined,
};

describe("ProjectSwitcher 走 ui/dropdown-menu", () => {
  it("关闭时只有触发器（项目名可见），没有菜单", () => {
    render(<ProjectSwitcher {...base} menuOpen={false} />);
    expect(
      screen.getByRole("button", { name: /演示项目/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("打开时渲染 role=menu，项目都是 role=menuitem", () => {
    render(<ProjectSwitcher {...base} menuOpen />);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    expect(
      screen.getByRole("menuitem", { name: /第二个/ }),
    ).toBeInTheDocument();
  });

  it("点项目项走 onSwitch；点「新建项目」走 onNew", () => {
    const onSwitch = vi.fn();
    const onNew = vi.fn();
    render(
      <ProjectSwitcher {...base} menuOpen onSwitch={onSwitch} onNew={onNew} />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /第二个/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /新建项目/ }));
    expect(onSwitch).toHaveBeenCalledWith("p2");
    expect(onNew).toHaveBeenCalled();
  });

  it("renaming 时给出输入框与保存 / 取消，不再给三项动作", () => {
    render(<ProjectSwitcher {...base} menuOpen renaming />);
    expect(screen.getByPlaceholderText("项目名称")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /新建项目/ })).toBeNull();
  });

  it("不再自绘遮罩 / 手写关闭语义（避免两套关闭路径同时生效）", () => {
    expect(SOURCE).not.toMatch(/overlayClass/);
    expect(SOURCE).not.toMatch(/<div\{\s*$/);
    expect(SOURCE).not.toMatch(/\{menuOpen && \(/);
  });
});
