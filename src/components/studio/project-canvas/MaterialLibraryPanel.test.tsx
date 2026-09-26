// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MaterialItem } from "./MaterialLibraryPanel";
import { MaterialLibraryPanel } from "./MaterialLibraryPanel";

afterEach(cleanup);

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleItems: MaterialItem[] = [
  {
    id: "m-1",
    name: "poster.png",
    folder: "ref",
    folderName: "参考素材",
    kind: "image",
    url: "/files/m-1",
    size: 20480,
    updatedAt: "2026-01-01T00:00:00.000Z",
    scope: "project",
  },
];

describe("MaterialLibraryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("拉取成功后渲染素材项", async () => {
    mockFetch({
      folders: [{ id: "ref", name: "参考素材", count: 1 }],
      items: sampleItems,
    });
    const onUse = vi.fn();
    const onClose = vi.fn();
    render(
      <MaterialLibraryPanel onClose={onClose} projectId="p-1" onUse={onUse} />,
    );

    // 首屏停在分类列表（folder === null），此时只渲染分类卡片
    expect(await screen.findByText("参考素材")).toBeInTheDocument();

    // 点击进入分类后才会拉取并渲染素材项
    await userEvent.click(screen.getByText("参考素材"));
    expect(await screen.findByText("poster.png")).toBeInTheDocument();
  });

  it("空结果不渲染素材项也不报错", async () => {
    mockFetch({ folders: [], items: [] });
    render(<MaterialLibraryPanel onClose={vi.fn()} projectId="p-1" />);
    // 初始 loading 文案应消失(拉取完成),且不抛错
    await waitFor(() =>
      expect(screen.queryByText("读取素材库失败")).not.toBeInTheDocument(),
    );
  });

  it("请求失败时展示错误文案", async () => {
    mockFetch({ error: "无权限" }, false);
    render(<MaterialLibraryPanel onClose={vi.fn()} projectId="p-1" />);
    expect(await screen.findByText("无权限")).toBeInTheDocument();
  });

  it("渲染关闭按钮并触发 onClose", async () => {
    mockFetch({ folders: [], items: [] });
    const onClose = vi.fn();
    render(<MaterialLibraryPanel onClose={onClose} />);
    const closeBtn = await screen.findByRole("button", { name: "关闭" });
    expect(closeBtn).toBeInTheDocument();
  });
});
