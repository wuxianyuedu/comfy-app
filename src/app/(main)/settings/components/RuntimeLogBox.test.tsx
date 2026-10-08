/**
 * `RuntimeLogBox` 的交互契约（设置页「启动日志」框）。
 *
 * 对应三条用户反馈：
 *   1. 小窗口某些时候看着麻烦 → 要有**全屏查看**（且全屏里同样能切换启动）；
 *   2. 多次启动的日志混在一起 → 右上角下拉按「每次启动」切换；
 *   3. 服务在应用还开着的时候被重启过几次，日志全堆在同一个文件里（ISSUE
 *      #1326）→ 那四份 runtime 日志改成**一次启动一份文件**，下拉列的就是这些
 *      份，文案由服务端给（时刻）；列表被上限截断时要说明还有更早的。
 *
 * 断言对齐可见行为（下拉存不存在 / 选项文案 / 回调参数 / 全屏层出现与消失 /
 * 空态与各种截断提示），不锁样式类。
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
    sessions: [
      {
        id: "comfyui-runtime-20260930-100741.log",
        title: "09-30 10:07:41",
        startedAt: new Date(2026, 8, 30, 10, 7, 41).getTime(),
      },
    ],
    sessionId: "comfyui-runtime-20260930-100741.log",
    truncated: false,
    windowed: false,
    total: 1,
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

/**
 * 两次运行的可选项（**文案形态与端点 `formatRunLabel` 的输出逐字一致**）。
 *
 * 视图直接渲染服务端给的 `title`，因此夹具必须按服务端那套写 —— 手写一个
 * 「长得像」的字符串，改口径时用例会一起漂过去。
 */
function twoSessions(): RuntimeLogController["sessions"] {
  return [
    {
      id: "comfyui-runtime-20260930-100103.log",
      title: "09-30 10:01:03",
      startedAt: new Date(2026, 8, 30, 10, 1, 3).getTime(),
    },
    {
      id: "comfyui-runtime-20260930-100741.log",
      title: "09-30 10:07:41",
      startedAt: new Date(2026, 8, 30, 10, 7, 41).getTime(),
    },
  ];
}

afterEach(cleanup);

describe("RuntimeLogBox", () => {
  it("只有一次运行时不给下拉（选不出别的东西的下拉只是噪声）", () => {
    renderBox(controller());
    expect(screen.queryByLabelText("切换要查看的启动")).toBeNull();
  });

  it("多次启动时下拉列出每份的时刻，切换回传那一份的文件名", async () => {
    const user = userEvent.setup();
    const log = controller({
      sessions: twoSessions(),
      sessionId: "comfyui-runtime-20260930-100741.log",
    });
    renderBox(log);

    /* P76 之后这里不再是原生 `<select>`（裸 `<select>` 已被判据拦下），而是
     * `ui/select-menu` 的 combobox：当前值在触发器的可见文字里，选项要**点开**
     * 才存在于 DOM。所以定位从 `value` + `<option>` 改成 combobox 的可见文字 +
     * 弹层里的 `role="option"` —— 用例锁的口径没变（列出每份的时刻、切换回传
     * 那一份的文件名），只是换成新控件的读法。
     * 选项要点**完整指针序列**（Base UI 的提交挂在指针抬起上，裸
     * `fireEvent.click` 只发 click、提交不了）。 */
    const trigger = screen.getByLabelText("切换要查看的启动");
    expect(trigger.textContent).toContain("09-30 10:07:41");

    /* 选项是**异步挂载**的：Base UI 的弹层走 portal，`user.click` 落下时它还没
     * 进 DOM。同步 `getAllByRole` 在空载的事件循环里恰好来得及，CPU 被并行用例
     * 抢满时就查不到（实测红在 `Unable to find an accessible element with the
     * role "option"`）—— 这里要的是「等到它出现」，不是「再快一点」。 */
    await user.click(trigger);
    const labels = (await screen.findAllByRole("option")).map(
      (option) => option.textContent,
    );
    expect(labels).toEqual(["09-30 10:01:03", "09-30 10:07:41"]);

    const first = (await screen.findAllByRole("option")).find((option) =>
      option.textContent?.startsWith("09-30 10:01:03"),
    );
    if (!first) throw new Error("弹层里没有 10:01:03 那一档启动");
    await user.click(first);
    expect(log.selectSession).toHaveBeenCalledWith(
      "comfyui-runtime-20260930-100103.log",
    );
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

  it("正文被截断时给出可见说明（不让用户以为日志本来就长这样）", () => {
    renderBox(controller({ truncated: true, windowed: true }));
    expect(
      screen.getByText("该次启动的输出过长，只显示最近一段。"),
    ).toBeTruthy();
  });

  it("列表被上限截断时说明「还有更早的几次」", () => {
    /* 一次启动一份文件之后同一天可能攒几十份（服务被反复重启），下拉列不完。
     * 不说出来的后果是用户以为「这个服务只启动过这些次」—— 而界面上看不出任何
     * 异常（硬规则 4：失败路径必须有用户可见出口）。 */
    renderBox(controller({ sessions: twoSessions(), total: 12 }));
    expect(
      screen.getByText("该服务一共启动过 12 次，下拉只列最近 2 次。"),
    ).toBeTruthy();
  });

  it("全屏查看：铺满内容区的面板里带同一个下拉，退出后回到小窗口", () => {
    const log = controller({
      sessions: twoSessions(),
      sessionId: "comfyui-runtime-20260930-100741.log",
    });
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
    renderBox(
      controller({
        sessions: twoSessions(),
        sessionId: "comfyui-runtime-20260930-100741.log",
      }),
    );
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
