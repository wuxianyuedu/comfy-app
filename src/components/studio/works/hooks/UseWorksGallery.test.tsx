/* 「所有项目」屏逻辑层单测（ISSUE #1522）。守两句新承诺：列表是并集（服务端独有行也看得见并标出处）；
 * 删除对「索引里没有、只在服务端」的行也有行为（此前缺的口子）。
 * 取数与删除在 ~/lib/project-canvas/canvas-store，这里整体替换该模块 —— 断言编排
 *（何时重取、失败降级说什么、确认流两步）；并集口径与两侧一起删由 canvas-store.test.ts 守。 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitAppEvent } from "~/lib/app-events";

type EntryRow = {
  edges: Array<unknown>;
  id: string;
  name: string;
  nodes: Array<unknown>;
  origin: "server" | "local" | "both";
  updatedAt: number;
};

const listProjectsWithServerMock = vi.hoisted(() =>
  vi.fn<(options?: { coalesce?: boolean }) => Promise<{ entries: Array<EntryRow>; ok: boolean }>>(),
);
const deleteProjectEverywhereMock = vi.hoisted(() => vi.fn<(id: string, name?: string) => void>());
const reapAllEmptyDraftsMock = vi.hoisted(() => vi.fn(() => 0));
const getProjectMock = vi.hoisted(() =>
  vi.fn<
    (id: string) => {
      edges: Array<unknown>;
      id: string;
      name: string;
      nodes: Array<unknown>;
      updatedAt: number;
    } | null
  >(),
);

/* 拒收出口（`useSyncRefusalNotice`）要 `useToast` —— 这里替换掉，本文件断言的
 * 是列表与删除的编排，不是提示通道（提示通道由 use-project-persistence 那边守）。 */
vi.mock("../../project-canvas/hooks/use-sync-refusal-notice", () => ({
  useSyncRefusalNotice: () => undefined,
}));

vi.mock("~/lib/project-canvas/canvas-store", () => ({
  /* 参数必须原样转发：事件触发那一跳的 `{ coalesce: true }` 标记要能被断言到
   * （ISSUE #4678 的接线判据 —— 丢了它两路合并就静默失效）。 */
  listProjectsWithServer: (options?: { coalesce?: boolean }) => listProjectsWithServerMock(options),
  deleteProjectEverywhere: (id: string, name?: string) => {
    deleteProjectEverywhereMock(id, name);
  },
  reapAllEmptyDrafts: () => reapAllEmptyDraftsMock(),
  getProject: (id: string) => getProjectMock(id),
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
  getProjectMock.mockReset();
});

afterEach(cleanup);

describe("useWorksGallery", () => {
  it("挂载时先清空草稿再取并集", async () => {
    listProjectsWithServerMock.mockResolvedValue({
      entries: [entry()],
      ok: true,
    });
    const { result } = renderHook(() => useWorksGallery());
    await expect.poll(() => result.current.loading).toBe(false);
    expect(reapAllEmptyDraftsMock).toHaveBeenCalledTimes(1);
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.serverOk).toBe(true);
  });

  it("本地还没同步上去的行不再列出；服务端拉不到 → serverOk=false + 空列表（ISSUE #4765）", async () => {
    listProjectsWithServerMock.mockResolvedValue({
      entries: [
        entry({ id: "proj_local", origin: "local" }),
        entry({ id: "proj_both", origin: "both" }),
      ],
      ok: false,
    });
    const { result } = renderHook(() => useWorksGallery());
    await expect.poll(() => result.current.loading).toBe(false);
    expect(result.current.serverOk).toBe(false);
    expect(result.current.projects.map((p) => p.id)).toEqual(["proj_both"]);
  });

  it("确认删除走 deleteProjectEverywhere（索引里没有的行也删得掉）", async () => {
    listProjectsWithServerMock.mockResolvedValue({
      entries: [entry({ id: "proj_orphan", name: "未命名", origin: "server" })],
      ok: true,
    });
    const { result } = renderHook(() => useWorksGallery());
    await expect.poll(() => result.current.loading).toBe(false);

    act(() => {
      result.current.requestDelete("proj_orphan");
    });
    expect(result.current.pendingDelete?.id).toBe("proj_orphan");

    let name: string | null = null;
    await act(async () => {
      name = await result.current.confirmDelete();
    });

    expect(deleteProjectEverywhereMock).toHaveBeenCalledWith("proj_orphan", "未命名");
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
    await expect.poll(() => result.current.loading).toBe(false);

    act(() => {
      result.current.requestDelete("proj_a");
    });
    act(() => {
      result.current.cancelDelete();
    });
    expect(result.current.pendingDelete).toBeNull();
    expect(deleteProjectEverywhereMock).not.toHaveBeenCalled();
  });

  it("refresh 重取一次", async () => {
    listProjectsWithServerMock.mockResolvedValue({ entries: [], ok: true });
    const { result } = renderHook(() => useWorksGallery());
    await expect.poll(() => result.current.loading).toBe(false);
    expect(listProjectsWithServerMock).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.refresh();
    });
    await expect.poll(() => listProjectsWithServerMock).toHaveBeenCalledTimes(2);
  });

  it("save 事件：那一行就地更新，不重拉并集（ISSUE #4600）", async () => {
    listProjectsWithServerMock.mockResolvedValue({ entries: [entry()], ok: true });
    getProjectMock.mockReturnValue({
      id: "proj_a",
      name: "改了名",
      updatedAt: 3,
      nodes: [],
      edges: [],
    });
    const { result } = renderHook(() => useWorksGallery());
    await expect.poll(() => result.current.loading).toBe(false);
    expect(listProjectsWithServerMock).toHaveBeenCalledTimes(1);

    act(() => {
      emitAppEvent("comfyapp:canvas-store-changed", { reason: "save", projectId: "proj_a" });
    });

    expect(listProjectsWithServerMock, "自动保存不触发并集重拉").toHaveBeenCalledTimes(1);
    await expect.poll(() => result.current.projects[0]?.name).toBe("改了名");
    expect(result.current.projects[0]?.origin).toBe("both");
  });

  it("save 事件但该行不在列表里（可能刚挤进窗口）→ 重取一次", async () => {
    listProjectsWithServerMock.mockResolvedValue({ entries: [entry()], ok: true });
    getProjectMock.mockReturnValue(null);
    const { result } = renderHook(() => useWorksGallery());
    await expect.poll(() => result.current.loading).toBe(false);

    act(() => {
      emitAppEvent("comfyapp:canvas-store-changed", { reason: "save", projectId: "proj_new" });
    });

    await expect.poll(() => listProjectsWithServerMock).toHaveBeenCalledTimes(2);
    expect(result.current.projects).toHaveLength(1);
  });

  it("结构性事件（delete）：重取并集，且带事件合并标记（ISSUE #4678）", async () => {
    listProjectsWithServerMock.mockResolvedValue({ entries: [entry()], ok: true });
    const { result } = renderHook(() => useWorksGallery());
    await expect.poll(() => result.current.loading).toBe(false);

    listProjectsWithServerMock.mockResolvedValue({ entries: [], ok: true });
    act(() => {
      emitAppEvent("comfyapp:canvas-store-changed", { reason: "delete", projectId: "proj_a" });
    });

    await expect.poll(() => listProjectsWithServerMock).toHaveBeenCalledTimes(2);
    /* 事件触发的那一跳带合并标记：与侧栏共享短 TTL 在飞请求，同一拍的结构性
     * 事件不再两路各发一次 project.list。 */
    expect(listProjectsWithServerMock).toHaveBeenLastCalledWith({ coalesce: true });
    await expect.poll(() => result.current.projects).toHaveLength(0);
  });
});

describe("useWorksGallery 的卸载守卫（#4239）", () => {
  it("卸载后回包不落地：projects 保持空、loading 不翻转", async () => {
    let release!: (value: { entries: Array<EntryRow>; ok: boolean }) => void;
    const gated = new Promise<{ entries: Array<EntryRow>; ok: boolean }>((resolve) => {
      release = resolve;
    });
    listProjectsWithServerMock.mockReturnValue(gated);

    const { result, unmount } = renderHook(() => useWorksGallery());
    unmount();
    release({ entries: [entry()], ok: true });
    await act(async () => {
      await gated;
    });

    expect(result.current.projects).toEqual([]);
    expect(result.current.loading).toBe(true);
  });
});

describe("useWorksGallery 的 StrictMode 双挂载（#4781）", () => {
  it("重挂载后判活标记要复活：第二次挂载的回包必须落地，否则列表永久停在读取中", async () => {
    let release!: (value: { entries: Array<EntryRow>; ok: boolean }) => void;
    const gated = new Promise<{ entries: Array<EntryRow>; ok: boolean }>((resolve) => {
      release = resolve;
    });
    listProjectsWithServerMock.mockReturnValue(gated);

    const { result } = renderHook(() => useWorksGallery(), { wrapper: StrictMode });
    /* 双挂载完成（两次 load 都已发出、第一次的卸载守卫已把 aliveRef 置 false）
     * 之后再放行：第一次的回包按 #4239 丢弃没错，但第二次挂载是**活着**的实例，
     * 它的回包必须落地 —— 不然这一屏就永久停在「正在读取项目列表…」
     * （网络 200、无报错，纯状态不落定）。 */
    await act(async () => {
      release({ entries: [entry()], ok: true });
      await gated;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.projects).toHaveLength(1);
    expect(result.current.serverOk).toBe(true);
  });
});
