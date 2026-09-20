// @vitest-environment jsdom
/**
 * `~/components/ui/tree-rows` 的契约（ISSUE #672 / 规范 16 §16.2.4.39）。
 *
 * 这条账的实质是「**缩进档 + 子行集合容器**」这组语义各层各写一遍，
 * 且同一棵树的三层可能用不同档（`NodesTab` 此前父级只有 `border-t`、
 * 子包有 `ml-3 + border-l-2`）。用例钉住：缩进与引导线是一组、`depth` 决定
 * 有没有档、「这一行 + 它的子行」绑成一对。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  TREE_INDENT_RAIL,
  TREE_INDENT_STEP,
  TreeChildren,
  TreeRow,
  indentClass,
} from "./tree-rows";

afterEach(cleanup);

describe("indentClass", () => {
  it("第 0 层没有缩进档（由父行自己承载）", () => {
    expect(indentClass(0)).toBe("");
    expect(indentClass()).toBe("");
  });

  it("第一层起同时给出缩进与引导线（一组语义）", () => {
    const cls = indentClass(1);
    expect(cls).toContain(TREE_INDENT_STEP);
    expect(cls).toContain(TREE_INDENT_RAIL);
  });

  it("再深一层仍是同一档（树的阶梯只有一个值）", () => {
    expect(indentClass(3)).toBe(indentClass(1));
  });
});

describe("TreeChildren", () => {
  it("渲染子行集合，并把缩进档放在 data-slot 容器上", () => {
    render(
      <TreeChildren>
        <span>子行</span>
      </TreeChildren>,
    );
    const el = document.querySelector('[data-slot="tree-children"]');
    expect(el).not.toBeNull();
    expect(el!.className).toContain("ml-3");
    expect(el!.className).toContain("border-l-2");
    expect(screen.getByText("子行")).toBeInTheDocument();
  });

  it("depth=0 不带缩进档（第一层子行由父行承载）", () => {
    render(
      <TreeChildren depth={0}>
        <span>第一层</span>
      </TreeChildren>,
    );
    const el = document.querySelector('[data-slot="tree-children"]');
    expect(el!.className).not.toContain("border-l-2");
  });

  it("railClassName 覆盖引导线颜色（状态色是调用处的域判据）", () => {
    render(
      <TreeChildren railClassName="border-warning/20">
        <span>x</span>
      </TreeChildren>,
    );
    const el = document.querySelector('[data-slot="tree-children"]');
    expect(el!.className).toContain("border-warning/20");
  });

  it("className 承载调用处特有的间隔与底色", () => {
    render(
      <TreeChildren className="bg-surface/50 space-y-1.5">
        <span>x</span>
      </TreeChildren>,
    );
    const el = document.querySelector('[data-slot="tree-children"]');
    expect(el!.className).toContain("space-y-1.5");
    expect(el!.className).toContain("bg-surface/50");
  });
});

describe("TreeRow", () => {
  it("行与它的子行绑成一对（子容器嵌在行里）", () => {
    render(
      <TreeRow row={<span>父行</span>}>
        <span>子行</span>
      </TreeRow>,
    );
    const row = document.querySelector('[data-slot="tree-row"]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-slot="tree-children"]')).not.toBeNull();
    expect(screen.getByText("父行")).toBeInTheDocument();
    expect(screen.getByText("子行")).toBeInTheDocument();
  });

  it("没有子行时不渲染子容器（折叠态不该留下空档）", () => {
    render(<TreeRow row={<span>只有行</span>} />);
    expect(document.querySelector('[data-slot="tree-children"]')).toBeNull();
  });
});
