// @vitest-environment jsdom
// 侧栏「项目」分组取数的装配判据（ISSUE #1874）。
//
// 现场：用户对着「所有项目」屏里明摆着三条项目，侧栏「项目」分组下一条都没有
// —— 因为侧栏此前读的是**本地索引**（`listProjects()`），而那一屏读的是
// 「本地索引 ∪ 服务端」的并集（ISSUE #1522）。画布页没打开过就没有
// `hydrateFromServer` 那次对账，于是「服务端有一行、索引里没有」的项目
// 在侧栏彻底不可见。
//
// 这里判的就是那条分叉：**服务端独有的一行必须出现在侧栏列表里**。
// 反向验证过：把并集换回「只列本地索引」，第一条必红。
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SIDEBAR_PROJECT_LIMIT, useSidebarProjects } from "./use-sidebar-projects";

const { listProjectsWithServer } = vi.hoisted(() => ({
  listProjectsWithServer: vi.fn(),
}));
vi.mock("~/lib/project-canvas/canvas-store", () => ({
  listProjectsWithServer,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useSidebarProjects", () => {
  it("服务端独有的项目也列出来（不只是本地索引那一份）", async () => {
    listProjectsWithServer.mockResolvedValue({
      ok: true,
      entries: [
        { id: "proj_server", name: "只在服务端的项目", origin: "server" },
        { id: "proj_local", name: "本地那一份", origin: "local" },
      ],
    });

    const { result } = renderHook(() => useSidebarProjects());

    await expect.poll(() => result.current.map((p) => p.id)).toEqual(["proj_server", "proj_local"]);
  });

  it("拉取失败（离线）时仍交回本地那一份，不清空", async () => {
    listProjectsWithServer.mockResolvedValue({
      ok: false,
      entries: [{ id: "proj_local", name: "本地那一份", origin: "local" }],
    });

    const { result } = renderHook(() => useSidebarProjects());

    await expect.poll(() => result.current.map((p) => p.id)).toEqual(["proj_local"]);
  });

  it("列表长度收在 SIDEBAR_PROJECT_LIMIT 以内", async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `proj_${i}`,
      name: `项目 ${i}`,
      origin: /* SAFETY: 类型断言已复核 */ "both" as const,
    }));
    listProjectsWithServer.mockResolvedValue({ ok: true, entries: many });

    const { result } = renderHook(() => useSidebarProjects());

    await expect.poll(() => result.current).toHaveLength(SIDEBAR_PROJECT_LIMIT);
  });
});
