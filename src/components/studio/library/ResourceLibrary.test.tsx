// 资源库页：作用域档、分类渲染、无项目时的引导态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

  it("页头不再重复一次可见标题；那句解释收进悬浮「说明」（屏名取自导航注册表）", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);
    /* 屏名仍在 DOM 里（`sr-only`，读屏与 `h1` 判据都靠它），只是不占视觉空间 ——
       页签写「资源库」、屏内再写一遍就是同一件事占两行（ISSUE #1693）。 */
    const heading = screen.getByRole("heading", { name: "资源库" });
    expect(heading.className).toContain("sr-only");
    /* 那句「能拿这些素材做什么」不再常驻：它收成一颗悬浮按钮，
       展开才显示（同一条 ISSUE：说明的直接显示也占空间）。 */
    expect(screen.queryByText(/可直接拖进画布或工坊/)).toBeNull();
    expect(screen.getByRole("button", { name: "说明" })).toBeTruthy();
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

    await expect
      .poll(() => fetchMock.mock.calls.map((call) => String(call[0])).join(" "))
      .toContain("scope=cross");
  });
});
