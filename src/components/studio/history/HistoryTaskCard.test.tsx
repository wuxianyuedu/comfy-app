/**
 * 历史任务卡的键盘可达性（规范 06 §6.11）。收口前主体信息块是 div + onClick（打开详情），
 * 左侧缩略图是 Button，同一动作只有鼠标那条通；改原生 <Button> 后 Enter/Space 与焦点语义免费。
 * 另覆盖 ISSUE #4619 的条目形态：模式 / 模型名取代工作流名，底部补 队列同款动作按钮。
 * 另覆盖 ISSUE #4630 的视觉收口：错误内嵌卡底警示条、状态圆点角标带读屏状态名。
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
  type: "T2I",
  workflowName: "测试工作流",
  modelName: "minimax_h3",
  status: "SUCCEEDED",
  prompt: "一只猫",
  createdAt: new Date().toISOString(),
  cover: null,
};

function renderCard(overrides: Partial<Parameters<typeof HistoryTaskCard>[0]> = {}) {
  const onOpenDetail = vi.fn();
  render(
    <HistoryTaskCard
      busy={false}
      onCancel={vi.fn()}
      onCopyForReprint={vi.fn()}
      onOpenDetail={onOpenDetail}
      onOpenFolder={vi.fn()}
      onOpenLog={vi.fn()}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
      progress={0}
      retrying={false}
      task={task}
      {...overrides}
    />,
  );
  return { onOpenDetail };
}

describe("HistoryTaskCard 键盘可达性", () => {
  it("主体信息块是原生按钮：Enter 也能打开详情", async () => {
    const { onOpenDetail } = renderCard();
    /* 两个落点（缩略图 + 主体块）都打开同一个详情 —— 都是按钮、都可聚焦。
     * 主体块的可达名来自它的文本（提示词在块内），用它定位。 */
    const buttons = screen.getAllByRole("button", {
      name: /查看任务详情|一只猫/,
    });
    expect(buttons.length).toBeGreaterThanOrEqual(2);

    const body = buttons.find((b) => b.textContent?.includes("一只猫"))!;
    body.focus();
    expect(body).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    expect(onOpenDetail).toHaveBeenCalledWith("t-1");
  });

  it("鼠标点击主体块仍然打开详情（收口没改行为）", async () => {
    const { onOpenDetail } = renderCard();
    const body = screen
      .getAllByRole("button", { name: /一只猫/ })
      .find((b) => b.textContent?.includes("一只猫"))!;

    await userEvent.click(body);

    expect(onOpenDetail).toHaveBeenCalledWith("t-1");
  });
});

describe("HistoryTaskCard memo（ISSUE #4559）", () => {
  /* 「静止卡短路」本身是 React.memo 的框架契约；这里锁的是**我们的决定**：
     这张卡必须保持 memo 包裹。摘掉它，配合每 1.5s 换拍的进度源，
     「加载更多」累积的几十上百张静止卡就会整树陪跑（ISSUE #4559 的现场）。 */
  it("卡片保持 memo 包裹（摘掉会让静止卡每拍陪跑）", () => {
    expect(HistoryTaskCard.$$typeof).toBe(Symbol.for("react.memo"));
  });
});

describe("HistoryTaskCard 条目形态（ISSUE #4619）", () => {
  it("显示模式名称与模型名称，不再显示工作流名", () => {
    renderCard();
    /* 模式：任务类型码 → 工作流类型表的中文标签。 */
    expect(screen.getByText("文生图")).toBeInTheDocument();
    /* 模型：工作流上挂的模型标签。 */
    expect(screen.getByText("minimax_h3")).toBeInTheDocument();
    expect(screen.queryByText("测试工作流")).not.toBeInTheDocument();
  });

  it("没挂模型标签的行回落工作流名（行上仍能认出是哪次提交）", () => {
    renderCard({ task: { ...task, modelName: null } });
    expect(screen.getByText("测试工作流")).toBeInTheDocument();
  });

  it("底部动作区：日志 / 输出目录 / 复制去重投，点击走对应回调", async () => {
    const onOpenLog = vi.fn();
    const onOpenFolder = vi.fn();
    const onCopyForReprint = vi.fn();
    renderCard({ onOpenLog, onOpenFolder, onCopyForReprint });

    await userEvent.click(screen.getByRole("button", { name: "查看这一条的执行日志" }));
    await userEvent.click(screen.getByRole("button", { name: "打开这一条的输出目录" }));
    await userEvent.click(
      screen.getByRole("button", { name: "复制这一条的提交内容，回画布改完再投一次" }),
    );

    expect(onOpenLog).toHaveBeenCalledWith(task);
    expect(onOpenFolder).toHaveBeenCalledWith(task);
    expect(onCopyForReprint).toHaveBeenCalledWith(task);
  });

  it("动作进行中（busy）时禁用 输出目录 与 复制去重投，日志仍可点", () => {
    renderCard({ busy: true });
    expect(screen.getByRole("button", { name: "打开这一条的输出目录" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "复制这一条的提交内容，回画布改完再投一次" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看这一条的执行日志" })).toBeEnabled();
  });
});

describe("HistoryTaskCard 错误提示条（ISSUE #4630）", () => {
  const failedTask: TaskItem = {
    ...task,
    status: "FAILED",
    error: "e2e 假 comfy-cli 按哨兵判定失败：E2E_FAKE_CLI_FAIL_SENTINEL",
  };

  it("失败卡的错误信息内嵌为卡片底部警示条（role=alert，错误 + 建议同条）", () => {
    renderCard({ task: failedTask });
    const alert = screen.getByRole("alert");
    /* 错误正文与可行动建议同在警示条内，而不是悬浮在卡片中部的独立色块。 */
    expect(alert.textContent).toContain("错误：");
    expect(alert.textContent).toContain(failedTask.error!);
    expect(alert.textContent).toContain("建议：");
  });

  it("非失败卡不渲染警示条（错误条只属于失败态）", () => {
    renderCard();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("失败但 error 为空串时不渲染空警示条", () => {
    renderCard({ task: { ...task, status: "FAILED", error: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("HistoryTaskCard 状态角标（ISSUE #4630）", () => {
  it("状态名以读屏文本挂在头像角标上（视觉是圆点、语义不丢）", () => {
    renderCard();
    expect(screen.getByText("已完成", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("失败卡角标读「失败」", () => {
    renderCard({ task: { ...task, status: "FAILED", error: "boom" } });
    expect(screen.getByText("失败", { selector: ".sr-only" })).toBeInTheDocument();
  });
});
