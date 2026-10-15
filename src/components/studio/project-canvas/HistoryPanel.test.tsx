import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { FILTER_TABS } from "~/lib/project-canvas/history-panel-types";
import type { HistoryPanelController } from "./hooks/use-history-panel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* 取数层是 tRPC + 轮询，本文件判的是**两排切换的形态**，不是数据流 ——
 * 所以 controller hook 直接给一份最小快照。 */
const controllerMock = vi.hoisted(() =>
  vi.fn<() => HistoryPanelController>(() => ({
    tasks: [],
    loading: false,
    error: null,
    scope: "project",
    filter: "all",
    display: "list",
    activeCount: 0,
    globalCount: null,
    setScope: vi.fn(),
    setFilter: vi.fn(),
    setDisplay: vi.fn(),
    refresh: vi.fn(),
  })),
);

vi.mock("./hooks/use-history-panel", () => ({
  useHistoryPanel: (): HistoryPanelController => controllerMock(),
}));

const { HistoryPanel } = await import("./HistoryPanel");

/**
 * 画布历史面板两排「一排里选一个」的回归判据（ISSUE #1925 收口）。
 *
 * 这一屏本来有两处手搓：类型筛选（`Button variant="ghost"` + 选中三元）与
 * 作用域切换（同上，选中给 `border-b-2`、未选中**不给** → 两枚不同高）。
 * 现在分别交给 `ui/select-chip`（选中态四层 + 悬停回钉）与 `ui/tabs` 的
 * `line` 档（`data-active` 驱动，两枚同高）。
 *
 * 这里钉三件事：
 *   ① 类型筛选走单选语义（`radiogroup` + `aria-checked`），不残留旧的
 *      `aria-pressed` 按钮形态；
 *   ② 类型筛选的选中档四层俱在、悬停值回钉常态（幽灵类名 / 悬停改写那两族
 *      问题不会再从这一处回来）；
 *   ③ 作用域切换两枚**同构**（都是 `ui/tabs` 的 tab），不再一高一矮。
 */
describe("HistoryPanel 类型筛选（ISSUE #1925）", () => {
  it("是单选语义的 radiogroup，枚数与 FILTER_TABS 一致", () => {
    render(<HistoryPanel onClose={vi.fn()} projectId="p1" />);
    const group = screen.getByRole("radiogroup", {
      name: "按类型筛选生成记录",
    });
    expect(group).toBeTruthy();
    /* 作用域里查 —— 同一屏还有「显示密度」那一组 radio（ISSUE #1925 复查
       收口），全局查会把它一起算进来。 */
    expect(within(group).getAllByRole("radio")).toHaveLength(
      FILTER_TABS.length,
    );
  });

  it("选中项经 aria-checked 表达，且只有一枚被勾选", () => {
    render(<HistoryPanel onClose={vi.fn()} projectId="p1" />);
    // 快照里 filter = "all" —— 恰好「全部」这一枚被勾上。
    const group = screen.getByRole("radiogroup", {
      name: "按类型筛选生成记录",
    });
    const checked = within(group)
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toBe("全部");
  });

  it("选中档四层俱在且悬停值回钉常态（不再被默认悬停档改写）", () => {
    render(<HistoryPanel onClose={vi.fn()} projectId="p1" />);
    const checked = screen
      .getAllByRole("radio")
      .find((el) => el.getAttribute("aria-checked") === "true")!;
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
      "aria-checked:hover:bg-primary-soft",
    ]) {
      expect(checked.className).toContain(layer);
    }
  });
});

describe("HistoryPanel 作用域切换（ISSUE #1925）", () => {
  it("两枚作用域是同一形态的 tab（不再一高一矮）", () => {
    render(<HistoryPanel onClose={vi.fn()} projectId="p1" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.textContent)).toEqual(["本项目", "全部"]);
    // 两枚的形态类必须一致 —— 差别只在 `data-active`（由 ui/tabs 给）。
    const shape = (el: HTMLElement) =>
      el.className
        .split(" ")
        .filter((c) => !c.startsWith("data-") && c !== "aria-selected:bg-muted")
        .sort()
        .join(" ");
    expect(shape(tabs[0]!)).toBe(shape(tabs[1]!));
  });

  it("当前作用域经 aria-selected 表达（不再靠「有没有那条下划线」）", () => {
    render(<HistoryPanel onClose={vi.fn()} projectId="p1" />);
    const [projectTab, allTab] = screen.getAllByRole("tab");
    expect(projectTab?.getAttribute("aria-selected")).toBe("true");
    expect(allTab?.getAttribute("aria-selected")).toBe("false");
  });
});

describe("HistoryPanel 显示密度（ISSUE #1925）", () => {
  it("走共享基元（三处逐字相同的孪生对已收口），选中档钉住悬停", () => {
    render(<HistoryPanel onClose={vi.fn()} projectId="p1" />);

    const group = screen.getByRole("radiogroup", { name: "显示密度" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).not.toHaveAttribute("aria-pressed");
    }
    const list = within(group).getByRole("radio", { name: "列表视图" });
    /* 这一屏的初始档是 `list`（见 use-history-panel 的初值）。 */
    expect(list).toHaveAttribute("aria-checked", "true");
    expect(list.className).toContain("aria-checked:hover:text-primary-strong");
    expect(list.className).toContain("aria-checked:hover:bg-primary-soft");
  });
});
