// @vitest-environment jsdom
// 资源库页：作用域档、分类渲染、无项目时的引导态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { setActive } from "~/lib/project-canvas/canvas-store";

import { ResourceLibrary } from "./ResourceLibrary";

afterEach(cleanup);

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
  folders: [{ id: "ref", name: "参考素材", count: 1 }],
  items: [],
};

describe("ResourceLibrary", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // 页面读取 canvas-store 的活跃项目；不设的话会落到「还没有打开的项目」
    // 引导态（那一档另有专门用例）。
    setActive("proj-test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("页头渲染标题与说明", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);
    expect(screen.getByRole("heading", { name: "资源库" })).toBeTruthy();
    expect(screen.getByText(/本项目的全部素材/)).toBeTruthy();
  });

  it("拉到分类后渲染分类卡", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);
    expect(await screen.findByText("参考素材")).toBeTruthy();
  });

  it("两个作用域档都渲染，且初始停在「本项目」", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);
    const project = await screen.findByRole("button", { name: /^本项目/ });
    expect(project.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /^跨项目/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("没有活跃项目时给出引导，并可一键切到「跨项目」", async () => {
    window.localStorage.clear();
    const fetchMock = mockFetch(BODY);
    render(<ResourceLibrary />);

    expect(await screen.findByText("还没有打开的项目")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "看跨项目素材" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.map((call) => String(call[0])).join(" "),
      ).toContain("scope=cross"),
    );
  });
});
