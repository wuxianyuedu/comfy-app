// 容器渲染单测：锁的都是**只有看屏幕才能发现**的问题。
//   · 位次显示的是不是那一行（顺序错位在读屏时最难发现，用户却据此决定要不要再提交）；
//   · 离线且还有任务时列表不许消失——任务记录在本地库，整页被「未连接」空态替换
//     会让人以为任务丢了（横幅只负责说「不会开始」，列表照常铺开）；
//   · 失败行必须把原因写出来（只有一个红色徽标等于没说）；
//   · 屏面上不出现「重试」——后端没有这个端点，画出来就是个会失败的按钮。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueueMonitor } from "./QueueMonitor";
import type { QueueMonitorController } from "./hooks/use-queue-monitor";
import type { QueueRow } from "./queue-monitor-config";
import type { TaskWatchHandlers } from "~/lib/workshop/generation-client";

/* 桩替法沿用仓库既有写法（BrowserStatusBar.test 同族）：hoisted 出 mock 函数，
 * 再交给 vi.mock —— 顶层 await import 拿到的已经是被替换过的模块，形同巧合。 */
const monitorMock = vi.hoisted(() => vi.fn());
vi.mock("./hooks/use-queue-monitor", () => ({
  useQueueMonitor: monitorMock,
}));
/* 弹窗里的 watchTask 会真开 EventSource（jsdom 没有）——日志弹窗的行为由它
 * 自己的 hook 测试覆盖，这里只锁「容器把它挂上 / 传对任务」。mock 刻意带上
 * 完整签名：从 mock.calls 取 handlers 时才有类型，不必写 any 断言。 */
const watchTaskMock = vi.hoisted(() =>
  vi.fn<(taskId: string, handlers: TaskWatchHandlers) => () => void>(
    () => () => undefined,
  ),
);
vi.mock("~/lib/workshop/generation-client", () => ({
  watchTask: watchTaskMock,
}));

function row(
  over: Partial<QueueRow> & Pick<QueueRow, "id" | "status">,
): QueueRow {
  return {
    type: "IMAGE",
    workflowName: `工作流 ${over.id}`,
    prompt: `提示词 ${over.id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    cover: null,
    checkpoint: null,
    mediaType: "image",
    projectId: null,
    progress: 0,
    error: null,
    ...over,
  };
}

function controller(
  over: Partial<QueueMonitorController> = {},
): QueueMonitorController {
  return {
    online: true,
    running: null,
    runningRows: [],
    queued: [],
    recent: [],
    waitingCount: 0,
    loading: false,
    loadError: null,
    logRow: null,
    isBusy: () => false,
    refresh: vi.fn(),
    cancel: vi.fn(),
    openFolder: vi.fn(),
    copyForReprint: vi.fn(),
    openLog: vi.fn(),
    closeLog: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("QueueMonitor", () => {
  it("位次写在对应的那一行上：提交早的显示第 1 位", () => {
    monitorMock.mockReturnValue(
      controller({
        queued: [
          { row: row({ id: "early", status: "QUEUED" }), position: 1 },
          { row: row({ id: "late", status: "QUEUED" }), position: 2 },
        ],
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    const lines = screen.getAllByText(/^工作流 (early|late)$/);
    expect(lines.map((el) => el.textContent)).toEqual([
      "工作流 early",
      "工作流 late",
    ]);
    expect(screen.getByText("第 1 位")).toBeInTheDocument();
    expect(screen.getByText("第 2 位")).toBeInTheDocument();
  });

  it("离线且还有任务：横幅说「不会开始」，列表照常铺开（数据来自本地库）", () => {
    monitorMock.mockReturnValue(
      controller({
        online: false,
        waitingCount: 1,
        queued: [{ row: row({ id: "q1", status: "QUEUED" }), position: 1 }],
        recent: [row({ id: "done1", status: "SUCCEEDED" })],
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    /* 横幅与启动出口都在，但不是整页空态那套「ComfyUI 未运行」标题。 */
    expect(screen.getByText("ComfyUI 未连接")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /启动 ComfyUI/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ComfyUI 未运行")).not.toBeInTheDocument();
    /* 三段列表都在：排队位次、跑动中段标题、最近结果行。 */
    expect(screen.getByText("第 1 位")).toBeInTheDocument();
    expect(screen.getByText("跑动中")).toBeInTheDocument();
    expect(screen.getByText(/^工作流 done1$/)).toBeInTheDocument();
  });

  it("离线且一条任务都没有：退回整页空态并给启动出口", () => {
    monitorMock.mockReturnValue(controller({ online: false, waitingCount: 0 }));
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    expect(screen.getByText("ComfyUI 未运行")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /启动 ComfyUI/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("排队中")).not.toBeInTheDocument();
  });

  it("离线但库里有 RUNNING 行：跑动中段渲染兜底卡并说明缺哪些明细", () => {
    monitorMock.mockReturnValue(
      controller({
        online: false,
        waitingCount: 1,
        runningRows: [row({ id: "r1", status: "RUNNING", progress: 42 })],
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/^工作流 r1$/)).toBeInTheDocument();
    expect(screen.getByText(/连接后显示耗时与节点明细/)).toBeInTheDocument();
  });

  it("每一行都有「日志」入口，点击把该行交给 controller 打开弹窗", () => {
    const openLog = vi.fn();
    monitorMock.mockReturnValue(
      controller({
        recent: [row({ id: "bad", status: "FAILED" })],
        queued: [{ row: row({ id: "q1", status: "QUEUED" }), position: 1 }],
        openLog,
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    const logButtons = screen.getAllByRole("button", {
      name: /查看这一条的执行日志/,
    });
    expect(logButtons).toHaveLength(2);
    /* 读屏顺序：排队段在前、最近结果在后 —— 每个按钮各归属那一行。 */
    logButtons[0]!.click();
    expect(openLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: "q1", status: "QUEUED" }),
    );
    logButtons[1]!.click();
    expect(openLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: "bad", status: "FAILED" }),
    );
  });

  it("logRow 非空时挂载执行日志弹窗，关闭回调交还 controller", () => {
    const closeLog = vi.fn();
    monitorMock.mockReturnValue(
      controller({
        logRow: { id: "t-1", workflowName: "工作流 t-1", status: "RUNNING" },
        closeLog,
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    expect(screen.getByTestId("queue-log-modal")).toBeInTheDocument();
    expect(watchTaskMock).toHaveBeenCalledTimes(1);
    expect(watchTaskMock).toHaveBeenCalledWith("t-1", expect.anything());
    /* 订阅要带落定回调（没有它弹窗徽标永远停在打开那一刻的状态）。 */
    expect(watchTaskMock.mock.calls[0]?.[1]?.onSettled).toBeTypeOf("function");
    screen.getByRole("button", { name: "关闭" }).click();
    expect(closeLog).toHaveBeenCalledTimes(1);
  });

  it("失败行把原因写出来，动作是「复制去重投」而不是不存在的重试按钮", () => {
    monitorMock.mockReturnValue(
      controller({
        recent: [
          row({
            id: "bad",
            status: "FAILED",
            error: "CUDA out of memory",
          }),
        ],
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    expect(screen.getByText("CUDA out of memory")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /复制这一条的提交内容/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /重试/ }),
    ).not.toBeInTheDocument();
  });

  it("进度未回报时剩余时间写「估算中」，不给一个看起来像数的值", () => {
    monitorMock.mockReturnValue(
      controller({
        running: {
          id: "r1",
          workflowName: "正在跑的工作流",
          modelText: "sd.safetensors",
          nodeText: "尚未回报节点",
          elapsedText: "00:30",
          remainingText: "估算中",
          progressPct: 0,
        },
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    expect(screen.getByText("估算中")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /正在跑的工作流/ }),
    ).toBeInTheDocument();
  });

  it("读不到任务记录时说明读不到，而不是显示一套空的列表当作准数", () => {
    monitorMock.mockReturnValue(
      controller({ loadError: "读不到任务记录，后端可能刚重启" }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    expect(screen.getByText(/^读不到任务记录/)).toBeInTheDocument();
  });
});
