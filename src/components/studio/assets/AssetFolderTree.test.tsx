import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { FolderNode } from "~/lib/media/asset-folders";

import { AssetFolderTree } from "./AssetFolderTree";

afterEach(cleanup);

const callbacks = {
  onCreateFolder: vi.fn(),
  onDeleteFolder: vi.fn(),
  onRenameFolder: vi.fn(),
  onSelectCategory: vi.fn(),
  onSelectFolder: vi.fn(),
};

/** 两级目录 + 一个空叶子目录：判删除按钮的开放条件、计数与选中态。 */
const tree: Array<FolderNode> = [
  {
    children: [{ children: [], count: 1, depth: 1, name: "活泼", path: "少女/活泼" }],
    count: 2,
    depth: 0,
    name: "少女",
    path: "少女",
  },
  { children: [], count: 0, depth: 0, name: "御姐", path: "御姐" },
];

function renderTree(overrides: Partial<Parameters<typeof AssetFolderTree>[0]> = {}) {
  return render(
    <AssetFolderTree
      category="character"
      categoryTotals={{ character: 2, reference: 0 }}
      loading={false}
      subdirPath={null}
      treesByCategory={{ character: tree, reference: [] }}
      {...callbacks}
      {...overrides}
    />,
  );
}

describe("AssetFolderTree —— 目录树视图", () => {
  it("七个固定分类作根节点，带资产总数角标", () => {
    renderTree();
    for (const label of ["参考素材", "场景", "分镜", "风格", "角色", "文档", "音乐"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    const characterRoot = document.querySelector('[data-category="character"]');
    expect(characterRoot?.textContent).toContain("2");
  });

  it("选中的分类根带 aria-current；点击分类根回调 onSelectCategory", () => {
    renderTree();
    const characterRoot = document.querySelector('[data-category="character"]');
    expect(characterRoot?.getAttribute("aria-current")).toBe("true");
    const referenceRoot = document.querySelector('[data-category="reference"]');
    expect(referenceRoot?.getAttribute("aria-current")).toBeNull();
    fireEvent.click(referenceRoot!);
    expect(callbacks.onSelectCategory).toHaveBeenCalledWith("reference");
  });

  it("目录行渲染名称与子树计数；点击目录回调 onSelectFolder（路径）", () => {
    renderTree();
    const shaoNv = document.querySelector('[data-folder-path="少女"]');
    expect(shaoNv?.textContent).toContain("少女");
    expect(shaoNv?.textContent).toContain("2"); // 子树和（含 活泼 的 1）
    fireEvent.click(shaoNv!);
    expect(callbacks.onSelectFolder).toHaveBeenCalledWith("少女");
    const huoPo = document.querySelector('[data-folder-path="少女/活泼"]');
    expect(huoPo?.textContent).toContain("1");
  });

  it("删除按钮只对「空且无下级」的目录开放；新建 / 重命名每级都有", () => {
    renderTree();
    expect(screen.getByRole("button", { name: "删除空目录 御姐" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "删除空目录 少女" })).toBeNull();
    expect(screen.getByRole("button", { name: "在 少女 下新建子目录" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重命名目录 少女" })).toBeTruthy();
    /* 分类根下也有新建入口（每个分类的目录列表末尾一行）。 */
    expect(screen.getAllByRole("button", { name: /新建子目录/ }).length).toBeGreaterThanOrEqual(7);
  });

  it("选中目录带高亮（bg-primary-soft）；选中分类根时目录不高亮", () => {
    const { unmount } = renderTree({ subdirPath: "少女" });
    const shaoNv = document.querySelector('[data-folder-path="少女"]');
    expect(shaoNv?.parentElement?.className).toContain("bg-primary-soft");
    unmount();
    renderTree({ subdirPath: null });
    const characterRoot = document.querySelector('[data-category="character"]');
    expect(characterRoot?.className).toContain("bg-primary-soft");
  });

  it("加载中给骨架（role=status），不出目录行", () => {
    renderTree({ loading: true });
    expect(screen.getByRole("status")).toBeTruthy();
    expect(document.querySelector('[data-folder-path="少女"]')).toBeNull();
  });
});
