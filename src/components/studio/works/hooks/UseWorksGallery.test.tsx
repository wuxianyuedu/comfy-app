/* 「所有项目」屏逻辑层单测（ISSUE #1522）。
 *
 * 守两句新承诺：
 *   · 列表是**并集**（服务端独有行也看得见，且标出出处）；
 *   · 删除对「索引里没有、只在服务端」的行也有行为（这正是此前缺的那个口子）。
 *
 * 取数与删除都在 `~/lib/project-canvas/canvas-store` 里，这里整体替换该模块 ——
 * 断言的是**编排**（什么时候重取、失败降级说什么、确认流的两步），
 * 以及那一层的实现细节（并集口径、两侧一起删）由 `canvas-store.test.ts` 守。
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface EntryRow {
  id: string;
  name: string;
  updatedAt: number;
  nodes: unknown[];
  edges: unknown[];
  origin: "server" | "local" | "both";
}

const listProjectsWithServerMock = vi.hoisted(() =>
  vi.fn<() => Promise<{ entries: EntryRow[]; ok: boolean }>>(),
);
const deleteProjectEverywhereMock = vi.hoisted(() =>
  vi.fn<(id: string, name?: string) => void>(),
);
const reapAllEmptyDraftsMock = vi.hoisted(() => vi.fn(() => 0));

/* 拒收出口（`useSyncRefusalNotice`）要 `useToast` —— 这里替换掉，本文件断言的
 * 是列表与删除的编排，不是提示通道（提示通道由 use-project-persistence 那边守）。 */
vi.mock("../../project-canvas/hooks/use-sync-refusal-notice", () => ({
  useSyncRefusalNotice: () => undefined,
}));

vi.mock("~/lib/project-canvas/canvas-store", () => ({
  listProjectsWithServer: () => listProjectsWithServerMock(),
  deleteProjectEverywhere: (id: string, name?: string) =>
    deleteProjectEverywhereMock(id, name),
  reapAllEmptyDrafts: () => reapAllEmptyDraftsMock(),
}));

import { useWorksGallery } from "./use-works-gallery";

function entry(over: Partial<EntryRow> = {}): EntryRow {
  return {
    id: "proj_a",
    name: "山与海",
    updatedAt: 2,
    nodes: [],
    edges: [],
    origin: "both",
    ...over,
  };
}

beforeEach(() => {
  listProjectsWithServerMock.mockReset();
  deleteProjectEverywhereMock.mockReset();
  reapAllEmptyDraftsMock.mockClear();
});

afterEach(cleanup);

describe("useWorksGallery", () => {
  it("挂载时先清空草稿再取并集", async () => {
    listProjectsWithServerMock.mockResolvedValue({
      entries: [entry()],
      ok: true,
    });
    const { result } = renderHook(() => useWorksGallery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(reapAllEmptyDraftsMock).toHaveBeenCalledTimes(1);
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.serverOk).toBe(true);
  });

  it("服务端拉不到 → serverOk=false，但本地项目照常列出", async () => {
    listProjectsWithServerMock.mockResolvedValue({
      entries: [entry({ id: "proj_local", origin: "local" })],
      ok: false,
    });
    const { result } = renderHook(() => useWorksGallery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.serverOk).toBe(false);
    expect(result.current.projects.map((p) => p.id)).toEqual(["proj_local"]);
  });

  it("确认删除走 deleteProjectEverywhere（索引里没有的行也删得掉）", async () => {
    listProjectsWithServerMock.mockResolvedValue({
      entries: [entry({ id: "proj_orphan", name: "未命名", origin: "server" })],
      ok: true,
    });
    const { result } = renderHook(() => useWorksGallery());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.requestDelete("proj_orphan"));
    expect(result.current.pendingDelete?.id).toBe("proj_orphan");

    let name: string | null = null;
    await act(async () => {
      name = await result.current.confirmDelete();
    });

    expect(deleteProjectEverywhereMock).toHaveBeenCalledWith(
      "proj_orphan",
      "未命名",
    );
    expect(name).toBe("未命名");
    // 确认框关掉、该行从列表里摘掉（不让用户以为没删掉、又点一次）。
    expect(result.current.pendingDelete).toBeNull();
    expect(result.current.projects).toHaveLength(0);
  });

  it("取消不动任何东西", async () => {
    listProjectsWithServerMock.mockResolvedValue({
      entries: [entry()],
      ok: true,
    });
    const { result } = renderHook(() => useWorksGallery());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.requestDelete("proj_a"));
    act(() => result.current.cancelDelete());
    expect(result.current.pendingDelete).toBeNull();
    expect(deleteProjectEverywhereMock).not.toHaveBeenCalled();
  });

  it("refresh 重取一次", async () => {
    listProjectsWithServerMock.mockResolvedValue({ entries: [], ok: true });
    const { result } = renderHook(() => useWorksGallery());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listProjectsWithServerMock).toHaveBeenCalledTimes(1);
    act(() => result.current.refresh());
    await waitFor(() =>
      expect(listProjectsWithServerMock).toHaveBeenCalledTimes(2),
    );
  });
});
