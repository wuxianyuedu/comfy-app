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

  it("页头显示可见标题且帮助问号挂在标题右侧；那句解释收进悬浮「说明」", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);
    /* 屏名现在可见：帮助问号需要挂在标题右侧，因此标题必须显示。 */
    const heading = screen.getByRole("heading", { name: "资源库" });
    expect(heading.className).toContain("u-title-page");
    expect(heading.className).not.toContain("sr-only");
    /* 那句「能拿这些素材做什么」仍收成一颗悬浮按钮，不常驻显示。 */
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
