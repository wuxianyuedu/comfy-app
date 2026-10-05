// 首页「模型概览」卡的可见行为。
//
// 重点是那三种「没有内容可展示」的状态各说各的话：加载中给骨架、取数失败给一句
// 说明、真的没模型给一句能照着做的指引。三者混成一句，用户就分不出「等一会儿」
// 「去设置里看看」和「先放文件再同步」这三种完全不同的处置。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { HomeModelOverview } from "./HomeModelOverview";
import type { ModelOverviewState } from "./model-overview-derive";

const overviewMock = vi.hoisted(() => vi.fn<() => ModelOverviewState>());

vi.mock("./hooks/use-model-overview", () => ({
  useModelOverview: (): ModelOverviewState => overviewMock(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function state(over: Partial<ModelOverviewState> = {}): ModelOverviewState {
  return {
    groups: [
      { folder: "checkpoints", label: "Checkpoint", count: 34 },
      { folder: "loras", label: "LoRA", count: 12 },
    ],
    total: 46,
    emptyFolderCount: 0,
    loading: false,
    error: null,
    ...over,
  };
}

describe("HomeModelOverview", () => {
  it("列出分组计数与总数，并给出进模型库的出口", () => {
    overviewMock.mockReturnValue(state());
    render(<HomeModelOverview />);
    expect(screen.getByText("模型概览")).toBeTruthy();
    expect(screen.getByText("Checkpoint")).toBeTruthy();
    expect(screen.getByText("34 个")).toBeTruthy();
    expect(screen.getByText("共 46 个")).toBeTruthy();
    expect(screen.getByRole("link", { name: "去模型库" })).toBeTruthy();
  });

  it("超过 5 类时折成一句「另有 N 类未列出」，不把首页撑长", () => {
    overviewMock.mockReturnValue(
      state({
        groups: Array.from({ length: 7 }, (_, i) => ({
          folder: `f${i}`,
          label: `F${i}`,
          count: 10 - i,
        })),
        total: 60,
      }),
    );
    render(<HomeModelOverview />);
    expect(screen.getByText("F0")).toBeTruthy();
    expect(screen.queryByText("F6")).toBeNull();
    expect(screen.getByText(/另有 2 类未列出/)).toBeTruthy();
  });

  it("有空目录时交代一句，而不是不声不响地少列", () => {
    overviewMock.mockReturnValue(state({ emptyFolderCount: 3 }));
    render(<HomeModelOverview />);
    expect(screen.getByText(/3 个目录为空/)).toBeTruthy();
  });

  it("加载中给骨架，不写「读不到」也不写「没有模型」", () => {
    overviewMock.mockReturnValue(
      state({ groups: [], total: 0, emptyFolderCount: 0, loading: true }),
    );
    const { container } = render(<HomeModelOverview />);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      3,
    );
    expect(screen.queryByText(/读不到|还没有同步到/)).toBeNull();
  });

  it("取数失败给一句说明，并保留去模型库这个出口（用户还能自己去重试）", () => {
    overviewMock.mockReturnValue(
      state({ groups: [], total: 0, error: "模型计数暂时读不到" }),
    );
    render(<HomeModelOverview />);
    expect(screen.getByText("模型计数暂时读不到")).toBeTruthy();
    expect(screen.getByRole("link", { name: "去模型库" })).toBeTruthy();
  });

  it("真的一个模型都没有：说清放哪儿、下一步点什么", () => {
    overviewMock.mockReturnValue(state({ groups: [], total: 0 }));
    render(<HomeModelOverview />);
    const hint = screen.getByText(/还没有同步到可用模型/);
    expect(hint.textContent).toContain("models");
    expect(hint.textContent).toContain("同步模型");
  });
});
