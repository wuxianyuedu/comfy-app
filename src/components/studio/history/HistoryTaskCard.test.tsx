/**
 * 历史任务卡的键盘可达性（规范 06 §6.11）：详情入口是缩略图上的原生 Button，
 * Enter/Space 与焦点语义免费。另覆盖 ISSUE #4619 的条目形态：模式 / 模型名取代
 * 工作流名，底部补 队列同款动作按钮。另覆盖 ISSUE #4630 的视觉收口：错误内嵌
 * 卡底警示条。另覆盖 ISSUE #4665 的定高与折叠。另覆盖用户反馈 #4710：
 * 提示词背景框定高滚动 + 右上角展开按钮弹大窗看全文、模式/模型固定一排、
 * 状态只由左缘色条表达（角标圆点撤掉、读屏文本保留）。
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
      onAddToLibrary={vi.fn()}
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

describe("HistoryTaskCard 产物预览与详情入口（用户反馈：点图看大图、详情走按钮）", () => {
  it("详情按钮是原生按钮：Enter 也能打开任务详情", async () => {
    const { onOpenDetail } = renderCard();
    const detail = screen.getByRole("button", { name: "查看这一条的任务详情" });
    detail.focus();
    expect(detail).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    expect(onOpenDetail).toHaveBeenCalledWith("t-1");
  });

  it("鼠标点击详情按钮打开任务详情", async () => {
    const { onOpenDetail } = renderCard();
    await userEvent.click(screen.getByRole("button", { name: "查看这一条的任务详情" }));
    expect(onOpenDetail).toHaveBeenCalledWith("t-1");
  });

  it("点缩略图打开图片查看器，而不是任务详情", async () => {
    const { onOpenDetail } = renderCard({
      task: { ...task, cover: "/api/generated/t1/a.png" },
    });
    await userEvent.click(screen.getByRole("button", { name: "查看大图：任务产物" }));
    expect(document.querySelector('[data-slot="image-viewer"]')).not.toBeNull();
    expect(onOpenDetail).not.toHaveBeenCalled();
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

  it("终态卡有「加入资产库」按钮，点击带整行任务打开弹窗（ISSUE #4868）", async () => {
    const onAddToLibrary = vi.fn();
    renderCard({ onAddToLibrary });
    await userEvent.click(screen.getByRole("button", { name: "把这一条的产物加入资产库" }));
    expect(onAddToLibrary).toHaveBeenCalledWith(task);
  });

  it("进行中（RUNNING）没有「加入资产库」——没有产物可言", () => {
    renderCard({ task: { ...task, status: "RUNNING" } });
    expect(screen.queryByRole("button", { name: "把这一条的产物加入资产库" })).toBeNull();
  });

  it("动作进行中（busy）时禁用 输出目录 与 复制去重投，日志仍可点", () => {
    renderCard({ busy: true });
    expect(screen.getByRole("button", { name: "打开这一条的输出目录" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "复制这一条的提交内容，回画布改完再投一次" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "查看这一条的执行日志" })).toBeEnabled();
  });

  it("重试对成功卡也给（成功 = 再跑一次），点击走 onRetry（用户反馈 #4710）", async () => {
    const onRetry = vi.fn();
    renderCard({ onRetry });
    await userEvent.click(screen.getByRole("button", { name: "↻ 重试" }));
    expect(onRetry).toHaveBeenCalledWith(task);
  });

  it("失败卡同样有重试；进行中（RUNNING）没有", () => {
    renderCard({ task: { ...task, status: "FAILED", error: "boom" } });
    expect(screen.getByRole("button", { name: "↻ 重试" })).toBeInTheDocument();
    cleanup();
    renderCard({ task: { ...task, status: "RUNNING" } });
    expect(screen.queryByRole("button", { name: "↻ 重试" })).toBeNull();
  });

  it("取消 / 重试 / 删除在卡底动作区（右下角），不在右上角时间列里", () => {
    renderCard({ task: { ...task, status: "FAILED", error: "boom" } });
    const retry = screen.getByRole("button", { name: "↻ 重试" });
    const remove = screen.getByRole("button", { name: "删除" });
    /* 两颗按钮的最近共同容器是底部动作区那一条（带 border-t），不是主行。 */
    expect(retry.closest("div.border-t")).not.toBeNull();
    expect(remove.closest("div.border-t")).not.toBeNull();
    expect(retry.closest("div.border-t")).toBe(remove.closest("div.border-t"));
  });
});

describe("HistoryTaskCard 错误提示条（ISSUE #4630 / #4665）", () => {
  const failedTask: TaskItem = {
    ...task,
    status: "FAILED",
    error: "e2e 假 comfy-cli 按哨兵判定失败：E2E_FAKE_CLI_FAIL_SENTINEL",
  };

  it("失败卡的错误信息内嵌为卡片底部警示条（role=alert）", () => {
    renderCard({ task: failedTask });
    const alert = screen.getByRole("alert");
    /* 错误正文在警示条内（折叠态也可见 —— line-clamp 只裁视觉、不裁 DOM）。 */
    expect(alert.textContent).toContain("错误：");
    expect(alert.textContent).toContain(failedTask.error!);
  });

  it("错误默认单行钳制（truncate），点展开图标看完整错误与建议（ISSUE #4665 / #4710）", async () => {
    renderCard({ task: failedTask });
    /* 折叠态：单行钳制（truncate），完整错误仍在 DOM 里；「建议」不出现。 */
    const p = screen.getByRole("alert").querySelector("p");
    expect(p?.className).toContain("truncate");
    expect(screen.getByRole("alert").textContent).toContain(failedTask.error!);
    expect(screen.queryByText(/建议/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "展开错误详情" }));
    expect(screen.getByRole("alert").textContent).toContain("建议：");
    /* 展开态解除单行钳制。 */
    expect(screen.getByRole("alert").querySelector("p")?.className).not.toContain("truncate");

    await userEvent.click(screen.getByRole("button", { name: "收起错误详情" }));
    expect(screen.queryByText(/建议/)).toBeNull();
  });

  it("展开 / 收起开关用图标表达（无文字），带 aria-expanded 随状态翻转", async () => {
    renderCard({ task: failedTask });
    const toggle = screen.getByRole("button", { name: "展开错误详情" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    /* 图标化（用户反馈 #4710）：按钮里不再有「展开 / 收起」文字。 */
    expect(toggle.textContent).not.toContain("展开");
    await userEvent.click(toggle);
    expect(screen.getByRole("button", { name: "收起错误详情" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("结构化校验错误清单只在展开态显示（折叠态不占高）", async () => {
    renderCard({
      task: {
        ...failedTask,
        validationErrors: [
          { classType: "KSampler", field: "steps", message: "步数不能为空", nodeId: "3" },
        ],
      },
    });
    expect(screen.queryByText(/节点配置校验/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "展开错误详情" }));
    expect(screen.getByText(/节点配置校验/)).toBeInTheDocument();
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

describe("HistoryTaskCard 提示词背景框（用户反馈 #4710 / ISSUE #4665）", () => {
  it("提示词在背景框里定高、超出部分块内滚动（长提示词不撑开卡片）", () => {
    renderCard({ task: { ...task, prompt: "一段非常长的提示词。".repeat(80) } });
    const promptEl = screen.getByText(/一段非常长的提示词/);
    /* 文本自身在块内纵向滚动。 */
    expect(promptEl.className).toContain("overflow-y-auto");
    expect(promptEl.className).toContain("text-xs");
    /* 背景框定高（h-24）、有底色，字号从 sm 降到 xs。 */
    const box = promptEl.parentElement;
    expect(box?.className).toContain("h-24");
    expect(box?.className).toContain("bg-canvas");
  });

  it("无提示词时显示占位文案，仍是同一个定高块", () => {
    renderCard({ task: { ...task, prompt: "" } });
    const placeholder = screen.getByText("（无提示词）");
    expect(placeholder.className).toContain("overflow-y-auto");
    expect(placeholder.parentElement?.className).toContain("h-24");
  });

  it("提示词右上角有展开按钮，点开大弹窗看全文", async () => {
    const long = "一段非常长的提示词。".repeat(80);
    renderCard({ task: { ...task, prompt: long } });
    /* 弹窗默认关着：全文虽在 DOM（卡片里滚动可见），但大窗未开。 */
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "展开查看完整提示词" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(long);
  });

  it("模式 + 模型名固定一排不换行（whitespace-nowrap + truncate）", () => {
    renderCard();
    const model = screen.getByText("minimax_h3");
    expect(model.className).toContain("truncate");
    /* 行容器不许 flex-wrap：此前有时一行有时两行就是它。 */
    expect(model.parentElement?.className).toContain("whitespace-nowrap");
    expect(model.parentElement?.className).not.toContain("flex-wrap");
  });
});

describe("HistoryTaskCard 状态表达（用户反馈 #4710）", () => {
  it("状态名以读屏文本保留在卡内（视觉改由左缘色条表达）", () => {
    renderCard();
    expect(screen.getByText("已完成", { selector: ".sr-only" })).toBeInTheDocument();
  });

  it("失败卡读「失败」，且缩略图右上角的圆点角标已撤掉", () => {
    renderCard({ task: { ...task, status: "FAILED", error: "boom" } });
    const sr = screen.getByText("失败", { selector: ".sr-only" });
    /* 旧形态是「绝对定位在缩略图右上角的圆点徽标」；撤掉后读屏文本不再坐在
       任何绝对定位徽标里。 */
    expect(sr.closest("span.absolute")).toBeNull();
  });
});
