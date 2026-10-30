// @vitest-environment jsdom
// 「打开一个只在服务端的项目」那一跳的装配判据（ISSUE #1874）。
//
// 现场：侧栏与「所有项目」那一屏读的是**并集**，所以「服务端有一行、本机索引里
// 没有」的项目看得见、点得着；而打开它这一跳读的是 `getProject(id)`（本地索引）
// —— 索引里没有它时交回 null，闸门照旧弹「先创建或选择一个项目」：用户对着一个
// 已经存在的项目，被要求**再建一个**。
//
// 判据是**顺序**：先 `hydrateProjectFromServer(id)` 落本机，再设为活跃并跳转。
// 反向验证过：把那一句删掉，第一条必红（`setActive` / 跳转照旧发生，而本机仍然
// 没有这一行 —— 跳过去还是空手）。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

import { useOpenServerProject } from "./use-open-server-project";

const calls: Array<string> = [];
const { hydrateProjectFromServer } = vi.hoisted(() => ({
  hydrateProjectFromServer: vi.fn(),
}));
vi.mock("~/lib/project-canvas/canvas-store", () => ({
  hydrateProjectFromServer,
  setActive: (id: string) => calls.push(`setActive:${id}`),
}));

afterEach(() => {
  cleanup();
  calls.length = 0;
  vi.clearAllMocks();
});

describe("useOpenServerProject", () => {
  it("先把服务端那一行落进本机，再设为活跃并跳到项目主页", async () => {
    hydrateProjectFromServer.mockImplementation(async (id: string) => {
      calls.push(`hydrate:${id}`);
      return { id, name: "只在服务端的项目" };
    });
    const navigate = vi.fn((view: string) => calls.push(`navigate:${view}`));

    const { result } = renderHook(() => useOpenServerProject(navigate));
    await result.current("proj_server");

    /* 等的是「这一跳落定」这个条件变成真 ⇒ `expect.poll`（§11.14.3）。 */
    await expect.poll(() => navigate.mock.calls.length).toBe(1);
    expect(calls).toEqual(["hydrate:proj_server", "setActive:proj_server", "navigate:project"]);
  });

  it("服务端拉不到这一行（离线 / 服务端也没有）→ 仍然落到闸门，不抛", async () => {
    hydrateProjectFromServer.mockResolvedValue(null);
    const navigate = vi.fn();

    const { result } = renderHook(() => useOpenServerProject(navigate));
    /* 不 reject 就够了 —— 这一跳在 `onClick` 里，抛出去就是一句没人接的
     * unhandled rejection，用户看到的是「点了没反应」。 */
    await expect(result.current("proj_gone")).resolves.toBeUndefined();
    await expect.poll(() => navigate.mock.calls.length).toBe(1);
  });
});
