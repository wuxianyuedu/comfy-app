// 「生成队列」总览卡渲染单测：与 QueueMonitor.test 同一族桩替法 —— mock 掉
// useModelTestQueue（它内部再包队列页的 useQueueMonitor，请求行为由那边的
// 测试覆盖），这里只锁看屏幕才能发现的问题：指标读数、排队位次与模型徽标、
// 展开参数表、跑动中富卡、离线兜底、失败原因、日志上抛、长列表截断提示。
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModelTestQueuePanel } from "./ModelTestQueuePanel";
import type { ModelTestQueueController } from "./hooks/use-model-test-queue";
import type { QueueRow } from "~/components/studio/queue/queue-monitor-config";

const queueMock = vi.hoisted(() => vi.fn());
vi.mock("./hooks/use-model-test-queue", () => ({
  useModelTestQueue: queueMock,
}));

function row(over: Partial<QueueRow> & Pick<QueueRow, "id" | "status">): QueueRow {
  return {
    type: "IMAGE",
    workflowName: `工作流 ${over.id}`,
    modelName: "MiniMax H3",
    prompt: `提示词 ${over.id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    cover: null,
    checkpoint: null,
    videoPath: null,
    mediaType: "image",
    projectId: null,
    progress: 0,
    error: null,
    ...over,
  };
}

function controller(over: Partial<ModelTestQueueController> = {}): ModelTestQueueController {
  return {
    online: true,
    running: null,
    runningRows: [],
    queued: [],
    recent: [],
    stats: { failedToday: 0, queued: 0, running: 0, succeededToday: 0 },
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
    expandedId: null,
    toggleExpanded: vi.fn(),
    detail: null,
    detailLoading: false,
    paramRows: [],
    ...over,
  };
}

function renderPanel(over: Partial<ModelTestQueueController> = {}) {
  const c = controller(over);
  const onOpenLog = vi.fn();
  render(<ModelTestQueuePanel c={c} onOpenLog={onOpenLog} />);
  return { c, onOpenLog };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("ModelTestQueuePanel（#5010 生成队列总览）", () => {
  it("指标条四格读数来自 controller（与队列页同一份 stats）", () => {
    renderPanel({ stats: { failedToday: 2, queued: 3, running: 1, succeededToday: 24 } });
    const metrics = within(screen.getByLabelText("队列概览"));
    expect(metrics.getByText("运行中")).toBeInTheDocument();
    expect(metrics.getByText("排队中")).toBeInTheDocument();
    expect(metrics.getByText("今日完成")).toBeInTheDocument();
    expect(metrics.getByText("24")).toBeInTheDocument();
    expect(metrics.getByText("失败")).toBeInTheDocument();
    expect(metrics.getByText("2")).toBeInTheDocument();
  });

  it("排队行：位次 + 工作流名 + 模型徽标 + 提示词副行；参数按钮上抛 toggleExpanded", async () => {
    const user = userEvent.setup();
    const { c } = renderPanel({
      queued: [{ position: 1, row: row({ id: "q1", status: "QUEUED" }) }],
      waitingCount: 1,
    });
    expect(screen.getByText("第 1 位")).toBeInTheDocument();
    expect(screen.getByText("工作流 q1")).toBeInTheDocument();
    expect(screen.getByText("MiniMax H3")).toBeInTheDocument();
    expect(screen.getByText("提示词 q1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看这条的输入参数" }));
    expect(c.toggleExpanded).toHaveBeenCalledWith("q1");
  });

  it("展开行渲染输入参数表（来自 task.detail 的纯派生行）", () => {
    renderPanel({
      expandedId: "q1",
      paramRows: [
        { label: "提示词", value: "未来感电动跑车" },
        { label: "种子", value: "731030653625918" },
      ],
      queued: [{ position: 1, row: row({ id: "q1", status: "QUEUED" }) }],
    });
    expect(screen.getByText("未来感电动跑车")).toBeInTheDocument();
    expect(screen.getByText("731030653625918")).toBeInTheDocument();
  });

  it("跑动中：富卡带进度与耗时读数，日志按钮上抛任务", async () => {
    const user = userEvent.setup();
    const { onOpenLog } = renderPanel({
      running: {
        elapsedText: "1m17s",
        id: "run1",
        modelText: "MiniMax H3",
        nodeText: "KSampler",
        progressPct: 42,
        rateText: "12.58 it/s",
        remainingText: "约 2m",
        stepsText: "553/8196",
        workflowName: "工作流 run1",
      },
    });
    expect(screen.getByText("工作流 run1")).toBeInTheDocument();
    expect(screen.getByText("已跑 1m17s")).toBeInTheDocument();
    expect(screen.getByText("预计剩余 约 2m")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看正在跑这条的执行日志" }));
    expect(onOpenLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run1", status: "RUNNING" }),
    );
  });

  it("离线且库里有 RUNNING 行：横幅说明 + 兜底卡，不整页空态", () => {
    renderPanel({
      online: false,
      runningRows: [row({ id: "r1", progress: 30, status: "RUNNING" })],
    });
    expect(
      screen.getByText("ComfyUI 未连接 —— 队列里的任务暂不会开始；连接恢复后自动接上。"),
    ).toBeInTheDocument();
    expect(screen.getByText("工作流 r1")).toBeInTheDocument();
    expect(screen.getByText("ComfyUI 未连接，连接后显示耗时与节点明细。")).toBeInTheDocument();
  });

  it("最近结果：终态徽标 + 失败原因可见，日志按钮带错误上下文", async () => {
    const user = userEvent.setup();
    const { onOpenLog } = renderPanel({
      recent: [row({ id: "f1", error: "显存不足", status: "FAILED" })],
    });
    /* 徽标与指标条都写「失败」—— 这里只锁「徽标在场」（≥2 处）。 */
    expect(screen.getAllByText("失败").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("显存不足")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看这一条的执行日志" }));
    expect(onOpenLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1", error: "显存不足", status: "FAILED" }),
    );
  });

  it("长列表截断：排队 / 最近各铺前几条，尾数指去「队列」页", () => {
    const queued = Array.from({ length: 7 }, (_, i) => ({
      position: i + 1,
      row: row({ id: `q${String(i)}`, status: "QUEUED" }),
    }));
    const recent = Array.from({ length: 6 }, (_, i) =>
      row({ id: `f${String(i)}`, status: "SUCCEEDED" }),
    );
    renderPanel({ queued, recent });
    expect(screen.getByText("工作流 q0")).toBeInTheDocument();
    expect(screen.queryByText("工作流 q5")).not.toBeInTheDocument();
    expect(screen.getByText(/还有 2 条排队中/)).toBeInTheDocument();
    expect(screen.getByText(/还有 2 条最近结果/)).toBeInTheDocument();
  });
});
