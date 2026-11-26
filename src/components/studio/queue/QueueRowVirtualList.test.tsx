import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { QueueRowVirtualList } from "./QueueRowVirtualList";
import type { QueueRow } from "./queue-monitor-config";

afterEach(cleanup);

function row(id: string): QueueRow {
  return {
    id,
    type: "IMAGE",
    workflowName: `工作流-${id}`,
    modelName: null,
    status: "QUEUED",
    prompt: `提示词 ${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    finishedAt: null,
    claimedAt: null,
    cover: null,
    checkpoint: null,
    videoPath: null,
    mediaType: "image",
    projectId: null,
    progress: 0,
    error: null,
  };
}

function renderList(onCancel: (row: QueueRow) => void) {
  const noop = vi.fn();
  return render(
    <QueueRowVirtualList
      expandedId={null}
      isBusy={() => false}
      onCancel={onCancel}
      onCopy={noop}
      onMoveUp={noop}
      onOpenFolder={noop}
      onOpenLog={noop}
      onToggleParams={noop}
      paramRows={[]}
      paramsLoading={false}
      rows={[row("a"), row("b"), row("c")].map((item, index) => ({
        leading: `第 ${index + 1} 位`,
        row: item,
      }))}
    />,
  );
}

describe("QueueRowVirtualList（窗口化与稳定回调）", () => {
  it("未量测时全量渲染兜底，位次与每行工作流名都在", () => {
    renderList(vi.fn());
    expect(screen.getByText("第 1 位")).toBeTruthy();
    expect(screen.getByText("工作流-a")).toBeTruthy();
    expect(screen.getByText("工作流-c")).toBeTruthy();
  });

  it("行动作把被点的那一行交给稳定 handler，而不是父级现造的闭包", () => {
    const onCancel = vi.fn<(row: QueueRow) => void>();
    renderList(onCancel);
    const buttons = screen.getAllByRole("button", { name: "取消这一条" });
    fireEvent.click(buttons[1]!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0]?.[0]?.id).toBe("b");
  });
});
