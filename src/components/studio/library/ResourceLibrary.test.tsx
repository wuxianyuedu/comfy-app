// 资源库页：作用域档、分类渲染、无项目时的引导态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { setActive } from "~/lib/project-canvas/canvas-store";

import { ResourceLibrary } from "./ResourceLibrary";

afterEach(cleanup);

function mockFetch(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    json: async () => body,
    ok: true,
    status: 200,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BODY = {
  folders: [{ count: 1, id: "ref", name: "参考素材" }],
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
    /* 悬浮「说明」现在由顶栏承载（`viewHelp()` 注册表 → `TopBar`），
       屏内页头里不再出现第二颗问号。 */
    expect(screen.queryByRole("button", { name: "说明" })).toBeNull();
  });

  it("拉到分类后渲染分类卡", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);
    expect(await screen.findByText("参考素材")).toBeTruthy();
  });

  it("两个作用域档都渲染，且初始停在「本项目」", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);
    const project = await screen.findByRole("tab", { name: /^本项目/ });
    expect(project.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /^跨项目/ }).getAttribute("aria-selected")).toBe(
      "false",
    );
  });

  it("作用域档走 ui/tabs 的 line 档：选中态由 data-active 一处驱动（ISSUE #1925 收口）", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);

    const list = await screen.findByRole("tablist", { name: "素材作用域" });
    /* 旧形态是手搓的 `ToggleGroup` + `after:` 下划线：未选中档**不写下划线**、
       靠 `after:bottom-[-13px]` 硬凑对齐 —— 两枚不同高、切来切去基线上下跳；
       语义也错了半格（`aria-pressed` 是「这开关开着吗」，可这一排只能选一个）。
       这一族与 `MaterialLibraryPanel` / `HistoryPanel` 的作用域切换逐字同形。 */
    const tabs = within(list).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab).not.toHaveAttribute("aria-pressed");
    }

    /* 下划线由 `data-active` + `after:opacity-*` 两层驱动，两枚同高同基线：
       选中档与未选中档的 `after:` 契约只在 `opacity` 上有差，没有任何
       「选中才给的边框 / 负偏移」——那正是旧形态让两枚不同高的地方。 */
    for (const tab of tabs) {
      expect(tab.className).toContain("after:h-0.5");
      expect(tab.className).not.toContain("after:bottom-[-13px]");
    }
    expect(tabs[0]?.className).toContain("data-active:after:opacity-100");
  });

  it("显示密度是单选一组，两枚由 value 一处驱动（ISSUE #1925 收口）", async () => {
    mockFetch(BODY);
    render(<ResourceLibrary />);

    const group = await screen.findByRole("radiogroup", { name: "显示密度" });
    /* 旧形态是三处逐字相同的手搓实现（含这一处）：选中只给底色、
       没钉字色悬停 —— `ghost` 的 `hover:text-foreground` 会把已选中那枚
       的字色翻掉。现在走 `ui/display-density-toggle`。 */
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).not.toHaveAttribute("aria-pressed");
    }

    const grid = within(group).getByRole("radio", { name: "网格视图" });
    expect(grid).toHaveAttribute("aria-checked", "true");
    expect(grid.className).toContain("aria-checked:hover:text-primary-strong");

    fireEvent.click(within(group).getByRole("radio", { name: "列表视图" }));
    expect(within(group).getByRole("radio", { name: "列表视图" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
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
