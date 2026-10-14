import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MaterialItem } from "./MaterialLibraryPanel";
import { MaterialLibraryPanel } from "./MaterialLibraryPanel";

afterEach(cleanup);

function mockFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sampleItems: MaterialItem[] = [
  {
    id: "m-1",
    name: "poster.png",
    folder: "ref",
    folderName: "参考素材",
    kind: "image",
    url: "/files/m-1",
    size: 20480,
    updatedAt: "2026-01-01T00:00:00.000Z",
    scope: "project",
  },
];

describe("MaterialLibraryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("拉取成功后渲染素材项", async () => {
    mockFetch({
      folders: [{ id: "ref", name: "参考素材", count: 1 }],
      items: sampleItems,
    });
    const onUse = vi.fn();
    const onClose = vi.fn();
    render(
      <MaterialLibraryPanel onClose={onClose} projectId="p-1" onUse={onUse} />,
    );

    // 首屏停在分类列表（folder === null），此时只渲染分类卡片
    expect(await screen.findByText("参考素材")).toBeInTheDocument();

    // 点击进入分类后才会拉取并渲染素材项
    await userEvent.click(screen.getByText("参考素材"));
    expect(await screen.findByText("poster.png")).toBeInTheDocument();
  });

  it("空结果不渲染素材项也不报错", async () => {
    mockFetch({ folders: [], items: [] });
    render(<MaterialLibraryPanel onClose={vi.fn()} projectId="p-1" />);
    // 初始 loading 文案应消失(拉取完成),且不抛错
    await waitFor(() =>
      expect(screen.queryByText("读取素材库失败")).not.toBeInTheDocument(),
    );
  });

  it("请求失败时展示错误文案", async () => {
    mockFetch({ error: "无权限" }, false);
    render(<MaterialLibraryPanel onClose={vi.fn()} projectId="p-1" />);
    expect(await screen.findByText("无权限")).toBeInTheDocument();
  });

  it("渲染关闭按钮并触发 onClose", async () => {
    mockFetch({ folders: [], items: [] });
    const onClose = vi.fn();
    render(<MaterialLibraryPanel onClose={onClose} />);
    const closeBtn = await screen.findByRole("button", { name: "关闭" });
    expect(closeBtn).toBeInTheDocument();
  });
});

/**
 * 作用域切换（本项目 / 跨项目）的形态回归（ISSUE #1925 第三批收口）。
 *
 * 它此前是手搓的 `Button variant="ghost"` + 下划线三元：选中给
 * `border-b-2 border-accent`、**未选中档根本没写那条边框** —— 未选中的那一枚
 * 整体比选中的矮 2px，切来切去文字基线上下跳。这与
 * `project-canvas/HistoryPanel` 的作用域切换**逐字同形**（同一处缺陷的另一份），
 * 现在同样交给 `ui/tabs` 的 `line` 档：两枚同高，选中由 `data-active` 驱动。
 */
describe("MaterialLibraryPanel 作用域切换（ISSUE #1925）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockFetch({ folders: [], items: [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("两枚作用域是同一形态的 tab（不再一高一矮）", async () => {
    render(<MaterialLibraryPanel onClose={vi.fn()} projectId="p-1" />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["本项目", "跨项目"]);
    /* 形态类必须一致 —— 差别只在 `data-active`（由 ui/tabs 给），
       不再靠「有没有那条 border-b-2」表达选中。 */
    const shape = (el: HTMLElement) =>
      el.className
        .split(" ")
        .filter((c) => !c.startsWith("data-") && c !== "aria-selected:bg-muted")
        .sort()
        .join(" ");
    expect(shape(tabs[0]!)).toBe(shape(tabs[1]!));
    for (const tab of tabs) expect(tab.className).not.toContain("border-b-2");
  });
});

describe("MaterialLibraryPanel 显示密度（ISSUE #1925）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockFetch({ folders: [], items: [] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("走共享基元（三处逐字相同的孪生对已收口），选中档钉住悬停", async () => {
    render(<MaterialLibraryPanel onClose={vi.fn()} projectId="p-1" />);

    const group = await screen.findByRole("radiogroup", { name: "显示密度" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).not.toHaveAttribute("aria-pressed");
    }
    const grid = within(group).getByRole("radio", { name: "网格视图" });
    expect(grid).toHaveAttribute("aria-checked", "true");
    /* 旧形态只钉底色不钉字色 —— 这一条正是那个接缝的判据。 */
    expect(grid.className).toContain("aria-checked:hover:text-primary-strong");
    expect(grid.className).toContain("aria-checked:hover:bg-primary-soft");
  });
});
