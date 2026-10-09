/**
 * 历史任务卡的键盘可达性（规范 06 §6.11）。
 *
 * 钉的是收口前后的差别：主体信息块此前是 `div + onClick`（打开详情）——
 * 左侧缩略图是同一个动作的 `<Button>`，而这一块只是鼠标专属，
 * 同一件事的两条路径里有一条键盘不通。收口改成原生 `<Button>` 后，
 * Enter/Space 与焦点语义是免费给的。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryTaskCard } from "./HistoryTaskCard";
import type { TaskItem } from "./history-types";

// vitest globals: false 下 RTL 不会自动 cleanup，需手动注册
afterEach(cleanup);

const task: TaskItem = {
  id: "t-1",
  type: "txt2img",
  workflowName: "测试工作流",
  status: "SUCCEEDED",
  prompt: "一只猫",
  createdAt: new Date().toISOString(),
  cover: null,
};

function renderCard(
  overrides: Partial<Parameters<typeof HistoryTaskCard>[0]> = {},
) {
  const onOpenDetail = vi.fn();
  render(
    <HistoryTaskCard
      task={task}
      progress={0}
      retrying={false}
      onOpenDetail={onOpenDetail}
      onCancel={vi.fn()}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      {...overrides}
    />,
  );
  return { onOpenDetail };
}

describe("HistoryTaskCard 键盘可达性", () => {
  it("主体信息块是原生按钮：Enter 也能打开详情", async () => {
    const { onOpenDetail } = renderCard();
    /* 两个落点（缩略图 + 主体块）都打开同一个详情 —— 都是按钮、都可聚焦。 */
    const buttons = screen.getAllByRole("button", {
      name: /查看任务详情|测试工作流/,
    });
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    const body = buttons.find((b) => b.textContent?.includes("测试工作流"))!;
    body.focus();
    expect(body).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    expect(onOpenDetail).toHaveBeenCalledWith("t-1");
  });

  it("鼠标点击主体块仍然打开详情（收口没改行为）", async () => {
    const { onOpenDetail } = renderCard();
    const body = screen
      .getAllByRole("button", { name: /测试工作流/ })
      .find((b) => b.textContent?.includes("测试工作流"))!;

    await userEvent.click(body);

    expect(onOpenDetail).toHaveBeenCalledWith("t-1");
  });
});
