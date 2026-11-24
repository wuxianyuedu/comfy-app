import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToastProvider } from "~/components/studio/ToastProvider";

import type { AssetLibraryController } from "./hooks/use-asset-library";
import type { AssetFoldersController } from "./hooks/use-asset-folders";

afterEach(cleanup);

/* 取数层是 tRPC，本文件判的是「目录树版式」的形态与编排 —— 两个 controller
 * hook 都给最小快照（与 HistoryList.test.tsx 同一口径：不测数据流）。 */
let libraryController: AssetLibraryController;
vi.mock("./hooks/use-asset-library", () => ({
  useAssetLibrary: () => libraryController,
  assetGridStyle: () => ({}),
}));

let foldersController: AssetFoldersController;
vi.mock("./hooks/use-asset-folders", () => ({
  useAssetFolders: () => foldersController,
}));

const { AssetLibrary } = await import("./AssetLibrary");

const assetRow = {
  category: "character",
  createdAt: "2026-01-01T00:00:00.000Z",
  hasParams: true,
  height: 1024,
  id: "asset-1",
  localPath: "/api/generated/assets/asset-1/out.png",
  mediaType: "image",
  name: "雨夜少女",
  projectId: null,
  prompt: "雨夜",
  scope: "public",
  subdir: "少女",
  width: 1024,
};

function baseLibraryController(): AssetLibraryController {
  return {
    cancelRemove: vi.fn(),
    category: "character",
    closeDetail: vi.fn(),
    confirmRemove: vi.fn(() => Promise.resolve(undefined)),
    deleting: false,
    detail: null,
    detailId: null,
    detailLoading: false,
    empty: { title: "资产库还是空的", hint: "先去加入" },
    items: [],
    loading: false,
    openDetail: vi.fn(),
    openRemove: vi.fn(),
    q: "",
    refresh: vi.fn(),
    removeTarget: null,
    scope: "public",
    selectFolder: vi.fn(),
    setQ: vi.fn(),
    setScope: vi.fn(),
    setSize: vi.fn(),
    size: "standard",
    subdirPath: null,
    switchCategory: vi.fn(),
  };
}

function baseFoldersController(): AssetFoldersController {
  return {
    categoryTotals: { character: 1 },
    createFolder: vi.fn(() => "新建目录"),
    deleteFolder: vi.fn(() => true),
    loading: false,
    moveAsset: vi.fn(() => Promise.resolve(true)),
    pending: false,
    renameFolder: vi.fn(() => Promise.resolve("少女2")),
    treesByCategory: {
      character: [{ children: [], count: 1, depth: 0, name: "少女", path: "少女" }],
    },
  };
}

function libraryView() {
  return (
    <ToastProvider>
      <AssetLibrary />
    </ToastProvider>
  );
}

describe("AssetLibrary —— 目录树版式（ISSUE #4943）", () => {
  it("归属筛选只剩公共 / 项目两档，不再出现「全部」", () => {
    libraryController = baseLibraryController();
    foldersController = baseFoldersController();
    render(libraryView());
    const group = screen.getByRole("radiogroup", { name: "按归属筛选" });
    const radios = group.querySelectorAll("[role='radio'], [aria-checked]");
    expect(radios.length).toBe(2);
    expect(group.textContent).toContain("公共资产");
    expect(group.textContent).toContain("项目资产");
    expect(group.textContent).not.toContain("全部");
  });

  it("左栏是目录树（分类根 + 子目录），右栏是搜索与资产网格", () => {
    libraryController = { ...baseLibraryController(), items: [assetRow] };
    foldersController = baseFoldersController();
    render(libraryView());
    /* 分类根在左栏（aria-label 的 nav 里） */
    expect(screen.getByRole("navigation", { name: "资产目录树" })).toBeTruthy();
    expect(document.querySelector('[data-folder-path="少女"]')).not.toBeNull();
    /* 右栏搜索框与资产卡 */
    expect(screen.getByRole("textbox", { name: "搜索资产" })).toBeTruthy();
    expect(document.querySelector("[data-asset-id='asset-1']")).not.toBeNull();
  });

  it("资产卡挂了移动入口（onMove 打开选择弹窗）", () => {
    libraryController = { ...baseLibraryController(), items: [assetRow] };
    foldersController = baseFoldersController();
    render(libraryView());
    expect(screen.getByRole("button", { name: "移动 雨夜少女 到其他目录" })).toBeTruthy();
  });

  it("空态区分「还没加过资产」与「当前筛选下没有」", () => {
    libraryController = baseLibraryController();
    foldersController = baseFoldersController();
    render(libraryView());
    expect(screen.getByText("资产库还是空的")).toBeTruthy();
  });
});

describe("资产库页面宽度契约（ISSUE #5002）", () => {
  it("内容区用 full 档，目录树贴齐左边距，不再被居中窄栏推到中间", () => {
    const code = readFileSync(
      path.join(process.cwd(), "src/components/studio/assets/AssetLibrary.tsx"),
      "utf8",
    );
    expect(code).toMatch(/<DocumentFrame[\s\S]*?width="full"/);
    expect(code).not.toMatch(/width="wide"/);
  });
});
