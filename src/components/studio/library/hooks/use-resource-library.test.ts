// 资源库逻辑层：作用域切换、分类计数汇总、跟随活跃项目。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

import { useResourceLibrary } from "./use-resource-library";

function mockFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BODY = {
  folders: [
    { id: "ref", name: "参考素材", count: 2 },
    { id: "audio", name: "音效", count: 3 },
  ],
  items: [],
};

describe("useResourceLibrary", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("分类计数汇总为总数", async () => {
    mockFetch(BODY);
    const { result } = renderHook(() => useResourceLibrary());
    await waitFor(() => expect(result.current.totalCount).toBe(5));
  });

  it("默认停在「本项目」档，切到「跨项目」后查询串带上 scope=cross", async () => {
    const fetchMock = mockFetch(BODY);
    const { result } = renderHook(() => useResourceLibrary());
    expect(result.current.library.scope).toBe("project");

    act(() => result.current.setScope("cross"));
    await waitFor(() => expect(result.current.library.scope).toBe("cross"));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("scope=cross"))).toBe(true);
    });
  });

  it("没有活跃项目时 projectId 为 null（页面据此给引导）", async () => {
    mockFetch(BODY);
    const { result } = renderHook(() => useResourceLibrary());
    expect(result.current.projectId).toBeNull();
  });
});
