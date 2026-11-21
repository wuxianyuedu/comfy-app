// @vitest-environment jsdom
// 侧栏「项目」分组取数的装配判据（ISSUE #1874）。
// 侧栏此前只读本地索引，而「所有项目」屏读并集（ISSUE #1522）；画布页没打开过
// 就没有 hydrate 对账，服务端独有的项目在侧栏彻底不可见。这里判那条分叉。
// 反向验证过：把并集换回「只列本地索引」，第一条必红。
// ISSUE #4600：自动保存（save 事件）就地改那一行，不再每拍全量重拉并集。
// ISSUE #4765：只列服务端已有的行（origin ≠ local），与「所有项目」屏同一口径。
import { cleanup, renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emitAppEvent } from "~/lib/app-events";
import { SIDEBAR_PROJECT_LIMIT, useSidebarProjects } from "./use-sidebar-projects";

const { getProject, listProjectsWithServer } = vi.hoisted(() => ({
  getProject: vi.fn(),
  listProjectsWithServer: vi.fn(),
}));
vi.mock("~/lib/project-canvas/canvas-store", () => ({
  getProject,
  listProjectsWithServer,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function entriesOf(count: number): Array<Record<string, string>> {
  return Array.from({ length: count }, (_, i) => ({
    id: `proj_${i}`,
    name: `项目 ${i}`,
    origin: "both",
  }));
}

describe("useSidebarProjects", () => {
  it("服务端独有的项目也列出来；本地还没推上去的行不列（ISSUE #4765）", async () => {
    listProjectsWithServer.mockResolvedValue({
      ok: true,
      entries: [
        { id: "proj_server", name: "只在服务端的项目", origin: "server" },
        { id: "proj_local", name: "本地那一份", origin: "local" },
        { id: "proj_both", name: "两侧都有", origin: "both" },
      ],
    });

    const { result } = renderHook(() => useSidebarProjects());

    await expect.poll(() => result.current.map((p) => p.id)).toEqual(["proj_server", "proj_both"]);
  });

  it("拉取失败（离线）时本地独有的行也不再列出（只列服务端已有的）", async () => {
    listProjectsWithServer.mockResolvedValue({
      ok: false,
      entries: [{ id: "proj_local", name: "本地那一份", origin: "local" }],
    });

    const { result } = renderHook(() => useSidebarProjects());

    await expect.poll(() => result.current).toEqual([]);
  });

  it("列表长度收在 SIDEBAR_PROJECT_LIMIT 以内", async () => {
    listProjectsWithServer.mockResolvedValue({ ok: true, entries: entriesOf(20) });

    const { result } = renderHook(() => useSidebarProjects());

    await expect.poll(() => result.current).toHaveLength(SIDEBAR_PROJECT_LIMIT);
  });

  it("save 事件：列表内那一行就地改名，不重拉并集（ISSUE #4600）", async () => {
    listProjectsWithServer.mockResolvedValue({ ok: true, entries: entriesOf(2) });
    getProject.mockReturnValue({ id: "proj_1", name: "新名字" });

    const { result } = renderHook(() => useSidebarProjects());
    await expect.poll(() => result.current).toHaveLength(2);
    expect(listProjectsWithServer).toHaveBeenCalledTimes(1);

    act(() => {
      emitAppEvent("comfyapp:canvas-store-changed", { reason: "save", projectId: "proj_1" });
    });

    expect(listProjectsWithServer, "自动保存不触发并集重拉").toHaveBeenCalledTimes(1);
    await expect.poll(() => result.current.find((p) => p.id === "proj_1")?.name).toBe("新名字");
  });

  it("save 事件：名字没变就复用旧引用，也不重拉（编辑期每拍零渲染税）", async () => {
    listProjectsWithServer.mockResolvedValue({ ok: true, entries: entriesOf(2) });
    getProject.mockReturnValue({ id: "proj_0", name: "项目 0" });

    const { result } = renderHook(() => useSidebarProjects());
    await expect.poll(() => result.current).toHaveLength(2);
    const before = result.current;

    act(() => {
      emitAppEvent("comfyapp:canvas-store-changed", { reason: "save", projectId: "proj_0" });
    });

    expect(listProjectsWithServer).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(before);
  });

  it("结构性变化（delete / hydrate / draft）仍整表重取", async () => {
    listProjectsWithServer.mockResolvedValue({ ok: true, entries: entriesOf(2) });

    const { result } = renderHook(() => useSidebarProjects());
    await expect.poll(() => result.current).toHaveLength(2);

    listProjectsWithServer.mockResolvedValue({ ok: true, entries: entriesOf(1) });
    act(() => {
      emitAppEvent("comfyapp:canvas-store-changed", { reason: "delete", projectId: "proj_1" });
    });

    await expect.poll(() => result.current).toHaveLength(1);
    expect(listProjectsWithServer).toHaveBeenCalledTimes(2);
    /* 事件触发的那一跳带合并标记（ISSUE #4678）：与作品库共享短 TTL 在飞请求，
     * 同一拍的结构性事件不再两路各发一次 project.list。 */
    expect(listProjectsWithServer).toHaveBeenLastCalledWith({ coalesce: true });
  });
});
