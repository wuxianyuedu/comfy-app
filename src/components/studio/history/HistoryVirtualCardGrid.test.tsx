import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import type { TaskItem } from "./history-types";

/* 大列表不接 FLIP 观察器（trace 里 100 张卡每次轮询触发 342ms Layout 的主因）。
 * 用假的 auto-animate ref 判「有没有把 ref 挂到列表上」，比断言内部结构更贴近行为。 */
const { animateRef } = vi.hoisted(() => ({ animateRef: vi.fn() }));
vi.mock("@formkit/auto-animate/react", () => ({
  useAutoAnimate: () => [animateRef, vi.fn()],
}));

const { HistoryVirtualCardGrid } = await import("./HistoryVirtualCardGrid");

afterEach(() => {
  cleanup();
  animateRef.mockClear();
});

function tasks(count: number): Array<TaskItem> {
  return Array.from({ length: count }, (_, index) => ({
    id: `task-${index}`,
    cover: null,
    createdAt: "2026-01-01T00:00:00Z",
    prompt: "一只猫",
    status: "SUCCEEDED",
    type: "image",
    workflowName: "t2i",
  }));
}

function renderGrid(count: number) {
  const noop = vi.fn();
  return render(
    <HistoryVirtualCardGrid
      isRetrying={() => false}
      isRowBusy={() => false}
      items={tasks(count)}
      onAddToLibrary={noop}
      onCancel={noop}
      onCopyForReprint={noop}
      onOpenDetail={noop}
      onOpenFolder={noop}
      onOpenLog={noop}
      onRemove={noop}
      onRetry={noop}
      progressMap={{}}
    />,
  );
}

function mountedRefCalls(): number {
  return animateRef.mock.calls.filter(([el]) => el !== null).length;
}

describe("HistoryVirtualCardGrid（大列表不挂 FLIP）", () => {
  it("超过 30 张卡时不把 animate ref 挂到列表上", () => {
    renderGrid(40);
    expect(mountedRefCalls()).toBe(0);
  });

  it("小列表仍保留条目级过渡动画", () => {
    renderGrid(3);
    expect(mountedRefCalls()).toBeGreaterThan(0);
  });

  it("未量测时（jsdom 尺寸为 0）全量渲染兜底，不把列表渲染成空白", () => {
    const view = renderGrid(12);
    expect(view.container.querySelectorAll('[class*="grid-cols"]').length).toBeGreaterThan(0);
  });
});
