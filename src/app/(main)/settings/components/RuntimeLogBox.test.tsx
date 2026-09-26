// @vitest-environment jsdom
/**
 * `RuntimeLogBox` 的交互契约（设置页「启动日志」框）。
 *
 * 对应两条用户反馈：
 *   1. 小窗口某些时候看着麻烦 → 要有**全屏查看**（且全屏里同样能切换启动）；
 *   2. 多次启动的日志混在一起 → 右上角下拉按「每次启动」切换。
 *
 * 断言对齐可见行为（下拉存不存在 / 选项文案 / 回调参数 / 全屏层出现与消失 /
 * 空态与截断提示），不锁样式类。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeLogController } from "../hooks/use-runtime-log-source";
import { RuntimeLogBox } from "./RuntimeLogBox";

const FILE_NAME = "comfyui-runtime.log";
const TITLE = `启动日志（${FILE_NAME}）`;

function controller(
  over: Partial<RuntimeLogController> = {},
): RuntimeLogController {
  return {
    text: "[spawn] pid=1\n",
    segments: [{ text: "[spawn] pid=1\n" }],
    sessions: [{ id: "12", title: "▶ ComfyUI 启动会话", startedAt: null }],
    sessionId: "12",
    truncated: false,
    windowed: false,
    active: false,
    selectSession: vi.fn(),
    refresh: vi.fn(async () => undefined),
    ...over,
  };
}

function renderBox(log: RuntimeLogController) {
  return render(
    <RuntimeLogBox
      fileName={FILE_NAME}
      log={log}
      emptyHint="暂无日志 —— 点「启动 ComfyUI」后这里会实时输出"
    />,
  );
}

function twoSessions(): RuntimeLogController["sessions"] {
  return [
    {
      id: "12",
      title: "▶ ComfyUI 启动会话",
      startedAt: new Date(2026, 8, 18, 10, 1, 3).getTime(),
    },
    {
      id: "40",
      title: "▶ ComfyUI 启动会话",
      startedAt: new Date(2026, 8, 18, 10, 7, 41).getTime(),
    },
  ];
}

afterEach(cleanup);

describe("RuntimeLogBox", () => {
  it("只有一次启动时不显示下拉（选不出别的东西的下拉只是噪声）", () => {
    renderBox(controller());
    expect(screen.queryByLabelText("切换要查看的启动")).toBeNull();
  });

  it("多次启动时下拉按「时刻 · 标题」列出，切换回传会话 id", async () => {
    const user = userEvent.setup();
    const log = controller({ sessions: twoSessions(), sessionId: "40" });
    renderBox(log);

    /* P76 之后这里不再是原生 `<select>`（裸 `<select>` 已被判据拦下），而是
     * `ui/select-menu` 的 combobox：当前值在触发器的可见文字里，选项要**点开**
     * 才存在于 DOM。所以定位从 `value` + `<option>` 改成 combobox 的可见文字 +
     * 弹层里的 `role="option"` —— 用例锁的口径没变（列出「时刻 · 标题」、切换
     * 回传会话 id），只是换成新控件的读法。
     * 选项要点**完整指针序列**（Base UI 的提交挂在指针抬起上，裸
     * `fireEvent.click` 只发 click、提交不了）。 */
    const trigger = screen.getByLabelText("切换要查看的启动");
    expect(trigger.textContent).toContain("10:07:41 · ▶ ComfyUI 启动会话");

    await user.click(trigger);
    const labels = screen
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(labels).toEqual([
      "10:01:03 · ▶ ComfyUI 启动会话",
      "10:07:41 · ▶ ComfyUI 启动会话",
    ]);

    const first = screen
      .getAllByRole("option")
      .find((option) => option.textContent?.startsWith("10:01:03"));
    if (!first) throw new Error("弹层里没有 10:01:03 那一档会话");
    await user.click(first);
    expect(log.selectSession).toHaveBeenCalledWith("12");
  });

  it("刷新按钮触发 refresh", () => {
    const log = controller();
    renderBox(log);
    fireEvent.click(screen.getByText("刷新"));
    expect(log.refresh).toHaveBeenCalledTimes(1);
  });

  it("正文为空时显示分区自己的空态引导", () => {
    renderBox(controller({ text: "", segments: [] }));
    expect(
      screen.getByText("暂无日志 —— 点「启动 ComfyUI」后这里会实时输出"),
    ).toBeTruthy();
  });

  it("截断 / 尾窗时给出可见说明（不让用户以为日志本来就长这样）", () => {
    renderBox(controller({ truncated: true, windowed: true }));
    expect(
      screen.getByText(
        "该次启动的输出过长，只显示最近一段。日志文件较大，更早的启动不在下拉列表里。",
      ),
    ).toBeTruthy();
  });

  it("全屏查看：铺满内容区的面板里带同一个下拉，退出后回到小窗口", () => {
    const log = controller({ sessions: twoSessions(), sessionId: "40" });
    renderBox(log);

    fireEvent.click(screen.getByLabelText("全屏查看"));
    const panel = screen.getByRole("dialog");
    expect(panel.getAttribute("aria-labelledby")).toBeTruthy();
    /* 全屏里仍有会话下拉（用户反馈第 2 条的落点）与小窗口的正文 */
    expect(screen.getAllByLabelText("切换要查看的启动")).toHaveLength(1);
    expect(screen.getByText("[spawn] pid=1")).toBeTruthy();
    /* 小窗口整块被替换掉，因此不再有「全屏查看」按钮 */
    expect(screen.queryByLabelText("全屏查看")).toBeNull();

    fireEvent.click(screen.getByLabelText("退出全屏"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("全屏查看")).toBeTruthy();
  });

  it("点击弹窗外（窗口标题栏）不关闭全屏视图：只能由退出按钮或 Esc 关", () => {
    // 全屏视图铺满标题行下方后，弹窗外唯一可点的就是标题栏；用户点标题栏
    // （想拖动窗口）把全屏视图整个关掉是用户实测反馈，这里钉住不回归。
    renderBox(controller({ sessions: twoSessions(), sessionId: "40" }));
    fireEvent.click(screen.getByLabelText("全屏查看"));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.pointerDown(document.body);
    fireEvent.pointerUp(document.body);
    fireEvent.click(document.body);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("启动进行中显示「跟随中」徽标", () => {
    renderBox(controller({ active: true }));
    expect(screen.getByText("跟随中")).toBeTruthy();
    expect(screen.getByText(TITLE)).toBeTruthy();
  });
});
