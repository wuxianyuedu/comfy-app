import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ToastProvider } from "~/components/studio/ToastProvider";

import { FILTERS } from "./history-types";

afterEach(cleanup);

/* 取数层是 tRPC + 轮询，本文件判的是**筛选那一排的形态**，
 * 不是数据流 —— 所以 controller hook 直接给一份最小快照。 */
vi.mock("./hooks/use-history-list", () => ({
  useHistoryList: () => ({
    filter: "ALL",
    counts: { ALL: 3, SUCCEEDED: 1 },
    sort: "newest",
    loading: false,
    filteredCount: 0,
    visibleTotal: 0,
    visibleGroups: [],
    progressMap: {},
    canLoadMore: false,
    empty: { title: "暂无任务", hint: "" },
    isRetrying: () => false,
    switchFilter: vi.fn(),
    setSort: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    openDetail: vi.fn(),
    closeDetail: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    removeTarget: null,
    confirmRemove: vi.fn(),
    cancelRemove: vi.fn(),
    detailId: null,
    detail: null,
    detailLoading: false,
    workflowIO: null,
    modeContracts: [],
  }),
}));

const { HistoryList } = await import("./HistoryList");

/* 用**真** `ToastProvider` 包一层（与 `FilmStudio.test.tsx` /
 * `WorksGallery.test.tsx` 同口径）：本屏常挂 `HistoryDetailModal`，
 * 它的详情动作走提示通道 —— mock 掉 provider 就等于不测这条链路了。 */
function renderList() {
  return (
    <ToastProvider>
      <HistoryList />
    </ToastProvider>
  );
}

/** 历史页状态筛选那排的回归判据（ISSUE #1925）。用户截图里五枚筛选在深浅两套主题下都读不出选中态：
 * 选中档写的 `bg-primary-solid` 是 Button 的 variant 轴取值、不是 className 类，样式表无此规则，
 * 于是无底色、白字压页面底色；计数徽标 `bg-subtle5` 同源不存在。
 * 钉三件事：① 不再出现这两个幽灵类名；② 筛选项走 ui/select-chip 的 aria-checked 选中态；
 * ③ 状态圆点颜色来自语义 tone，不是 FilterDef 里写死的类名字面量。 */
describe("HistoryList 状态筛选（ISSUE #1925）", () => {
  it("不再使用那两个不存在的类名", () => {
    render(renderList());
    const html = document.body.innerHTML;
    expect(html).not.toContain("bg-primary-solid");
    expect(html).not.toContain("bg-subtle5");
  });

  it("筛选项是单选语义的 radiogroup，选中项经 aria-checked 表达", () => {
    render(renderList());
    const group = screen.getByRole("radiogroup", { name: "按状态筛选任务" });
    expect(group).toBeTruthy();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(FILTERS.length);
    // 当前筛选是 ALL —— 恰好一枚被勾选。
    const checked = radios.filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain("全部");
  });

  it("选中档自带四层（底色 / 字色 / 描边 / 字重），不靠单一底色", () => {
    render(renderList());
    const checked = screen
      .getAllByRole("radio")
      .find((el) => el.getAttribute("aria-checked") === "true")!;
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
    ]) {
      expect(checked.className).toContain(layer);
    }
    /* 悬停值必须钉回常态 —— 否则 Button 的默认悬停档会在划过时
     * 把「已选中」改写成别的东西（select-chip 存在的理由）。 */
    expect(checked.className).toContain("aria-checked:hover:bg-primary-soft");
  });
});

describe("FILTERS 的配色只给语义键", () => {
  it("不给 Tailwind 类名字面量（配色归 ui/status-dot）", () => {
    for (const f of FILTERS) {
      expect(f).not.toHaveProperty("dotCls");
      // 语义键只能是 status-dot 认识的那几档；可缺省分支收进合取式（断言无条件跑）。
      expect(f.tone === undefined || ["up", "busy", "probing", "down"].includes(f.tone)).toBe(true);
    }
  });

  it("ALL 不给圆点（没有「全部」这个状态），其余四枚各给一枚", () => {
    expect(FILTERS.find((f) => f.key === "ALL")?.tone).toBeUndefined();
    expect(FILTERS.filter((f) => f.tone)).toHaveLength(4);
  });
});
