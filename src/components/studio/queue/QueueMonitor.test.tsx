// @vitest-environment jsdom
// 容器渲染单测：锁的都是**只有看屏幕才能发现**的问题。
//   · 位次显示的是不是那一行（顺序错位在读屏时最难发现，用户却据此决定要不要再提交）；
//   · 离线时不许继续铺一套「排队中 / 最近结果」——那会让人以为任务丢了；
//   · 失败行必须把原因写出来（只有一个红色徽标等于没说）；
//   · 屏面上不出现「重试」——后端没有这个端点，画出来就是个会失败的按钮。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueueMonitor } from "./QueueMonitor";
import type { QueueMonitorController } from "./hooks/use-queue-monitor";
import type { QueueRow } from "./queue-monitor-config";

/* 桩替法沿用仓库既有写法（BrowserStatusBar.test 同族）：hoisted 出 mock 函数，
 * 再交给 vi.mock —— 顶层 await import 拿到的已经是被替换过的模块，形同巧合。 */
const monitorMock = vi.hoisted(() => vi.fn());
vi.mock("./hooks/use-queue-monitor", () => ({
  useQueueMonitor: monitorMock,
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
    queued: [],
    recent: [],
    waitingCount: 0,
    loading: false,
    loadError: null,
    isBusy: () => false,
    refresh: vi.fn(),
    cancel: vi.fn(),
    openFolder: vi.fn(),
    copyForReprint: vi.fn(),
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

  it("离线时只说「没连上」并给启动出口，不铺排队与最近结果两套列表", () => {
    monitorMock.mockReturnValue(
      controller({
        online: false,
        waitingCount: 3,
        queued: [{ row: row({ id: "q1", status: "QUEUED" }), position: 1 }],
      }),
    );
    render(<QueueMonitor onOpenSettings={vi.fn()} />);
    /* 空态标题在 ui/empty-state 里是 <p>（全站空态同一形态），因此按文本断言而不是要 heading。 */
    expect(screen.getByText("ComfyUI 未运行")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /启动 ComfyUI/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("第 1 位")).not.toBeInTheDocument();
    expect(screen.queryByText("跑动中")).not.toBeInTheDocument();
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
