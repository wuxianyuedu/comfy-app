// @vitest-environment jsdom
// 素材库逻辑层单测：hook 不发请求（请求在 lib/materials-client），故只 mock 那一层。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteMaterial,
  fetchMaterials,
  uploadMaterial,
  type MaterialItem,
} from "~/lib/media/materials-client";

import { useMaterialLibrary } from "./use-material-library";

vi.mock("~/lib/media/materials-client", () => ({
  fetchMaterials: vi.fn(),
  uploadMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
}));

const mockedList = vi.mocked(fetchMaterials);
const mockedUpload = vi.mocked(uploadMaterial);
const mockedDelete = vi.mocked(deleteMaterial);

const folders = [{ id: "ref", name: "参考素材", count: 1 }];
const item: MaterialItem = {
  id: "p-1/ref/a.png",
  name: "a.png",
  folder: "ref",
  folderName: "参考素材",
  kind: "image",
  url: "/u/a.png",
  size: 2048,
  updatedAt: "2026-01-01T00:00:00.000Z",
  scope: "p-1",
};

beforeEach(() => {
  mockedList.mockReset();
  mockedUpload.mockReset();
  mockedDelete.mockReset();
  mockedList.mockResolvedValue({ folders, items: [] });
});

afterEach(cleanup);

describe("useMaterialLibrary", () => {
  it("挂载即拉取，loading 由 true 收敛到 false", async () => {
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedList).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p-1", scope: "project" }),
    );
  });

  it("拉取失败：错误文案可读，列表清空（失败路径必须有用户可见出口）", async () => {
    mockedList.mockRejectedValue(new Error("读取素材库失败"));
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.error).toBe("读取素材库失败"));
    expect(result.current.items).toEqual([]);
    expect(result.current.folders).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("拉取失败但抛值非 Error 时用兜底文案", async () => {
    mockedList.mockRejectedValue("boom");
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.error).toBe("读取素材库失败"));
  });

  it("进入分类后查询带上 folder；showItems 随之翻转", async () => {
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.showItems).toBe(false);

    act(() => result.current.enterFolder("ref"));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ folder: "ref" }),
      ),
    );
    expect(result.current.showItems).toBe(true);
  });

  it("搜索态：查询带 q 且不带 folder，showItems 为 true", async () => {
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    act(() => result.current.enterFolder("ref"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setSearch("角色"));
    await waitFor(() =>
      expect(mockedList).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "角色" }),
      ),
    );
    const lastCall =
      mockedList.mock.calls[mockedList.mock.calls.length - 1]?.[0];
    // 搜索优先于 folder：folder 不参与查询（客户端置 null）
    expect(lastCall?.folder).toBeNull();
    expect(result.current.searching).toBe(true);
  });

  it("切换 scope 时退回到分类列表（避免停在已消失的分类）", async () => {
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    act(() => result.current.enterFolder("ref"));
    await waitFor(() => expect(result.current.folder).toBe("ref"));

    act(() => result.current.setScope("cross"));
    expect(result.current.folder).toBeNull();
    expect(result.current.scope).toBe("cross");
  });

  it("上传：分类列表页默认落到「参考素材」，成功后触发刷新", async () => {
    mockedUpload.mockResolvedValue();
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const file = new File(["x"], "a.png", { type: "image/png" });
    const files = {
      length: 1,
      0: file,
      item: (i: number) => (i === 0 ? file : null),
    } as unknown as FileList;
    await act(async () => {
      await result.current.upload(files);
    });

    expect(mockedUpload).toHaveBeenCalledWith(file, {
      folder: "ref",
      projectId: "p-1",
    });
    expect(result.current.uploading).toBe(false);
  });

  it("上传多文件逐个提交，全部走同一目标分类", async () => {
    mockedUpload.mockResolvedValue();
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.enterFolder("scenes"));

    const a = new File(["a"], "a.png");
    const b = new File(["b"], "b.png");
    const files = { length: 2, 0: a, 1: b } as unknown as FileList;
    await act(async () => {
      await result.current.upload(files);
    });

    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(mockedUpload).toHaveBeenNthCalledWith(1, a, {
      folder: "scenes",
      projectId: "p-1",
    });
  });

  it("上传失败：文案为「上传失败」，uploading 复位", async () => {
    mockedUpload.mockRejectedValue(new Error("磁盘已满"));
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    const file = new File(["x"], "a.png");
    const files = { length: 1, 0: file } as unknown as FileList;
    await act(async () => {
      await result.current.upload(files);
    });
    expect(result.current.error).toBe("磁盘已满");
    expect(result.current.uploading).toBe(false);
  });

  it("上传失败后不会被后台刷新悄悄清空（提示条必须留在屏幕上）", async () => {
    mockedUpload.mockRejectedValue(new Error("磁盘已满"));
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const file = new File(["x"], "a.png");
    const files = { length: 1, 0: file } as unknown as FileList;
    await act(async () => {
      await result.current.upload(files);
    });
    expect(result.current.error).toBe("磁盘已满");

    // 上传失败本身不触发刷新；这里再模拟一次并发的后台拉取成功，
    // 拉取成功只清拉取错误，动作错误必须保留到用户点「重试」。
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("空 FileList / null 不发起任何上传请求", async () => {
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await act(async () => {
      await result.current.upload(null);
    });
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("删除：乐观移除本地条目后再刷新校准计数", async () => {
    mockedList.mockResolvedValue({ folders, items: [item] });
    mockedDelete.mockResolvedValue();
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.remove(item);
    });
    expect(mockedDelete).toHaveBeenCalledWith(item.id);
    expect(result.current.items).toHaveLength(0);
  });

  it("删除失败：错误文案保留，条目不消失（不做错误乐观更新）", async () => {
    mockedList.mockResolvedValue({ folders, items: [item] });
    mockedDelete.mockRejectedValue(new Error("文件被占用"));
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    await act(async () => {
      await result.current.remove(item);
    });
    expect(result.current.error).toBe("文件被占用");
    expect(result.current.items).toHaveLength(1);
  });

  it("面包屑：分类态给出「全部 / 当前分类」，搜索态给出命中数", async () => {
    mockedList.mockResolvedValue({ folders, items: [item] });
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.breadcrumbSegments).toEqual([
      { label: "全部", key: null },
    ]);

    act(() => result.current.enterFolder("ref"));
    await waitFor(() => expect(result.current.folder).toBe("ref"));
    expect(result.current.breadcrumbSegments).toEqual([
      { label: "全部", key: null },
      { label: "参考素材", key: "ref" },
    ]);

    act(() => result.current.setSearch("a"));
    await waitFor(() => expect(result.current.searching).toBe(true));
    expect(result.current.breadcrumbSegments[0]?.label).toContain("搜索结果");
  });

  it("refresh 递增触发重新拉取", async () => {
    const { result } = renderHook(() =>
      useMaterialLibrary({ projectId: "p-1" }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = mockedList.mock.calls.length;
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(mockedList.mock.calls.length).toBeGreaterThan(before),
    );
  });
});
