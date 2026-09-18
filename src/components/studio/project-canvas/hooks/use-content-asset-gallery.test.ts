// @vitest-environment jsdom
// 图片资产节点的相册逻辑单测。两条关键规则：
//   1. 只有 >1 张图才启用相册（单图仍走节点主体的常规预览）；
//   2. 拉取失败**静默** —— 单图模式必须照常显示，不能整节点变错误态。

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTaskImages } from "~/lib/media/task-images-client";

import { useContentAssetGallery } from "./use-content-asset-gallery";

vi.mock("~/lib/media/task-images-client", () => ({ fetchTaskImages: vi.fn() }));

const mockedFetch = vi.mocked(fetchTaskImages);

beforeEach(() => {
  mockedFetch.mockReset();
});

afterEach(cleanup);

describe("useContentAssetGallery", () => {
  it("两图以上才启用相册", async () => {
    mockedFetch.mockResolvedValue([
      { id: "i1", localPath: "/a.png", isCover: true },
      { id: "i2", localPath: "/b.png", isCover: false },
    ]);
    const { result } = renderHook(() =>
      useContentAssetGallery({ taskId: "t-1", enabled: true }),
    );
    await waitFor(() => expect(result.current.images).toHaveLength(2));
    expect(mockedFetch).toHaveBeenCalledWith("t-1");
  });

  it("单图不启用（images 为 null，视图走常规预览）", async () => {
    mockedFetch.mockResolvedValue([
      { id: "i1", localPath: "/a.png", isCover: true },
    ]);
    const { result } = renderHook(() =>
      useContentAssetGallery({ taskId: "t-1", enabled: true }),
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(result.current.images).toBeNull();
  });

  it("enabled=false（movie / text 节点）完全不发请求", async () => {
    renderHook(() => useContentAssetGallery({ taskId: "t-1", enabled: false }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("无 taskId 不发请求", async () => {
    renderHook(() => useContentAssetGallery({ taskId: null, enabled: true }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("拉取失败静默：images 保持 null，不抛错（单图模式照常显示）", async () => {
    mockedFetch.mockRejectedValue(new Error("任务不存在"));
    const { result } = renderHook(() =>
      useContentAssetGallery({ taskId: "t-1", enabled: true }),
    );
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(result.current.images).toBeNull();
  });

  it("换任务时在渲染期清掉旧图（首帧不闪上一张任务的缩略图）", async () => {
    mockedFetch.mockResolvedValue([
      { id: "i1", localPath: "/a.png", isCover: true },
      { id: "i2", localPath: "/b.png", isCover: false },
    ]);
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) =>
        useContentAssetGallery({ taskId, enabled: true }),
      { initialProps: { taskId: "t-1" } },
    );
    await waitFor(() => expect(result.current.images).toHaveLength(2));

    mockedFetch.mockResolvedValue([]);
    rerender({ taskId: "t-2" });
    expect(result.current.images).toBeNull();
  });

  it("开关与下标可由视图驱动，支持函数式更新（翻页基于上一张）", async () => {
    mockedFetch.mockResolvedValue([
      { id: "i1", localPath: "/a.png", isCover: true },
      { id: "i2", localPath: "/b.png", isCover: false },
    ]);
    const { result } = renderHook(() =>
      useContentAssetGallery({ taskId: "t-1", enabled: true }),
    );
    await waitFor(() => expect(result.current.images).toHaveLength(2));

    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
    act(() => result.current.setIndex((index) => index + 1));
    expect(result.current.index).toBe(1);
    act(() => result.current.setOpen(false));
    expect(result.current.open).toBe(false);
  });
});
