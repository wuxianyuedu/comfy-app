import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { StepLogEntry } from "./stepLogCache";

afterEach(cleanup);

/**
 * 画布「执行日志」弹窗里级别筛选栏的形态回归（ISSUE #1925 第三批收口）。
 *
 * 这一排此前是手搓的 `Button variant="ghost"` + 选中三元（选中 →
 * `bg-surface-2 text-ink-bright`），与应用日志 / 任务日志时间线是同一族的
 * 两份手抄。坏在同一个接缝：选中档没钉悬停值，`ghost` 自带的
 * `hover:bg-muted hover:text-foreground` 会把「已选中」在悬停期间改写成
 * 「未选中」的样子（ISSUE #1423）。
 *
 * 现在整排交给 `ui/select-chip`。这里钉单选语义 + 选中档四层俱在 + 悬停回钉。
 */
const stepLogs: Array<StepLogEntry> = [
  { t: 1, level: "info", msg: "开始" },
  { t: 2, level: "error", msg: "炸了" },
];

vi.mock("./activeTask", () => ({ useActiveTaskId: () => "task-1" }));
vi.mock("./hooks/use-task-step-log-stream", () => ({
  useTaskStepLogStream: () => ({
    logs: stepLogs,
    validationErrors: null,
    status: null,
    progress: 0,
    error: null,
    connected: false,
    setError: vi.fn(),
    clear: vi.fn(),
  }),
}));
vi.mock("./hooks/use-cancel-task", () => ({
  useCancelTask: () => ({ cancelling: false, cancel: vi.fn() }),
}));
vi.mock("../canvas/hooks/use-canvas-settings", () => ({
  useCanvasSettings: () => ({ settings: { debugMode: true } }),
}));

const { GlobalStepLogPanel } = await import("./GlobalStepLogPanel");

describe("画布执行日志的级别筛选 chip（ISSUE #1925）", () => {
  it("是单选语义的 radiogroup，默认勾选「全部」且只有一枚", async () => {
    render(<GlobalStepLogPanel />);
    /* 开关按钮先打开弹窗。 */
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText("执行日志"));
    expect(screen.getByRole("radiogroup", { name: "日志级别筛选" })).toBeTruthy();
    const chips = screen.getAllByRole("radio");
    expect(chips.length).toBeGreaterThan(1);
    expect(chips.filter((c) => c.getAttribute("aria-checked") === "true")).toHaveLength(1);
  });

  it("选中档四层俱在，且手搓时代那个同值底色已不再出现", async () => {
    render(<GlobalStepLogPanel />);
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(screen.getByText("执行日志"));
    const checked = screen
      .getAllByRole("radio")
      .find((c) => c.getAttribute("aria-checked") === "true")!;
    for (const layer of [
      "aria-checked:bg-primary-soft",
      "aria-checked:text-primary-strong",
      "aria-checked:border-primary",
      "aria-checked:font-semibold",
      "aria-checked:hover:bg-primary-soft",
    ]) {
      expect(checked.className).toContain(layer);
    }
    expect(checked.className).not.toContain("bg-surface-2");
  });
});
