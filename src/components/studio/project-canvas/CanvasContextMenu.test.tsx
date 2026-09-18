// @vitest-environment jsdom
//
// 画布右键菜单走 `ui/dropdown-menu` 的契约（ISSUE #672 / 规范 16 §16.2.4.6 第一档）。
//
// 此前是自绘外壳：`fixed` 手定位面板 + 自绘遮罩负责关闭，没有 `role="menu"`、
// 没有 Esc、没有方向键。换基元后这些语义由 base-ui 给；本文件钉住「菜单真的
// 是菜单」以及「调用处那份手写定位 / 关闭语义已删除」。

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CanvasContextMenu } from "./CanvasContextMenu";
import { NODE_META, type NodeKind } from "~/lib/project-canvas/canvas-types";

afterEach(cleanup);

const SOURCE = readFileSync(
  path.resolve(__dirname, "CanvasContextMenu.tsx"),
  "utf8",
);

function renderMenu(
  over: Partial<Parameters<typeof CanvasContextMenu>[0]> = {},
) {
  return render(
    <CanvasContextMenu
      x={40}
      y={50}
      onPick={() => undefined}
      onPickTest={() => undefined}
      onClose={() => undefined}
      {...over}
    />,
  );
}

describe("CanvasContextMenu 走 ui/dropdown-menu", () => {
  it("渲染成 role=menu，每个节点一项 role=menuitem", () => {
    renderMenu();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(
      Object.keys(NODE_META).length + 1,
    );
  });

  it("点一个节点项会把对应的 kind 交给 onPick", () => {
    const onPick = vi.fn();
    renderMenu({ onPick });
    const kinds = Object.keys(NODE_META) as NodeKind[];
    const firstKind = kinds[0]!;
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: new RegExp(NODE_META[firstKind].label),
      }),
    );
    expect(onPick).toHaveBeenCalledWith(firstKind);
  });

  it("点「测试自定义工作流」走 onPickTest", () => {
    const onPickTest = vi.fn();
    renderMenu({ onPickTest });
    fireEvent.click(screen.getByRole("menuitem", { name: /测试自定义工作流/ }));
    expect(onPickTest).toHaveBeenCalled();
  });

  it("不再自绘遮罩 / 手写关闭语义（避免两套关闭路径同时生效）", () => {
    expect(SOURCE).not.toMatch(/overlayClass/);
    expect(SOURCE).not.toMatch(/onContextMenu=/);
    expect(SOURCE).not.toMatch(/<Button/);
  });

  it("菜单仍开在右键那个点上（零尺寸锚点带 left/top）", () => {
    expect(SOURCE).toMatch(/left: x, top: y/);
  });
});
